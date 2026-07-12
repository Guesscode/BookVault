// BookVault - Cloudflare Pages Function: POST /api/submit
// Handles book submission: Turnstile verification, IP rate-limiting, sensitive word filtering, GitHub API commit.

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  };

  let body;
  try { body = await request.json(); } catch { return error("无效的请求数据", 400, corsHeaders); }

  // 1. Turnstile verification
  const turnstileRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: body.turnstileToken, remoteip: ip }),
  });
  if (!(await turnstileRes.json()).success) return error("人机验证失败，请刷新页面重试", 403, corsHeaders);

  // 2. IP rate limiting (3 submissions / 24h via KV with 86400s TTL)
  const key = `rl:${ip}`;
  const count = parseInt((await env.RATE_LIMIT.get(key)) || "0");
  if (count >= 3) return error("该IP今日提交次数已达上限（3次/天），请明天再试", 429, corsHeaders);

  // 3. Sensitive word filter (hard block)
  const SENSITIVE = [
    /\u6cd5\u8f6e\u529f/i, /\u7ffb\u5899/, /\u5206\u88c2\u56fd\u5bb6/, /\u90aa\u6559/,
    /\u81ea\u6740\u6307\u5357/, /\u5236\u6bd2/, /\u5356\u6deb/, /\u67aa\u652f\u4ea4\u6613/,
  ];
  for (const re of SENSITIVE) {
    if (re.test(body.content) || re.test(body.title))
      return error("内容涉及敏感词汇，提交失败", 403, corsHeaders);
  }

  // 4. Field validation
  const title = (body.title || "").trim();
  const category = (body.category || "").trim();
  const content = (body.content || "").trim();
  const contact = (body.contact || "").trim();
  const CATEGORIES = ["数学", "计算机", "物理", "商业", "人文", "历史", "其他"];

  if (!title || title.length > 30) return error("书名不能为空且不超过30字", 400, corsHeaders);
  if (!content || content.length > 500000) return error("内容不能为空且不超过50万字", 400, corsHeaders);
  if (!contact) return error("联系方式不能为空", 400, corsHeaders);
  if (!CATEGORIES.includes(category)) return error("无效的分类", 400, corsHeaders);

  // 5. Build file path and content with metadata header
  const safeName = title.replace(/[\\/:*?"<>|#\[\]]/g, "_");
  const filePath = `books/${category}/${safeName}.md`;
  const metadata = `<!-- 贡献者: ${contact} | 提交IP: ${ip} | 提交时间: ${new Date().toISOString()} -->\n\n`;
  const fileContent = metadata + `# ${title}\n\n` + content;

  // 6. Commit to GitHub via Contents API
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          "Content-Type": "application/json",
          "User-Agent": "BookVault-Worker",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          message: `add: [${category}] ${title}`,
          content: btoa(unescape(encodeURIComponent(fileContent))),
        }),
      }
    );
    const ghData = await ghRes.json();
    if (!ghRes.ok) {
      if ((ghData.message || "").includes("Invalid request") || ghRes.status === 422)
        return error("同名书籍已存在，请使用不同的书名", 409, corsHeaders);
      return error(`存储失败: ${ghData.message || "GitHub API 错误"}`, 500, corsHeaders);
    }

    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 86400 });
    return new Response(JSON.stringify({ success: true, message: "提交成功！书籍已上架。", path: filePath }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return error(`系统繁忙，请稍后重试 (${e.message})`, 500, corsHeaders);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function error(msg, status, extra) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: extra });
}
