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
  const turnstileData = await turnstileRes.json();
  if (!turnstileData.success) {
    const detail = (turnstileData['error-codes'] || []).join(', ') || '未知错误';
    return error(`人机验证失败: ${detail}，请刷新页面重试`, 403, corsHeaders);
  }

  // 2. IP rate limiting (3 submissions / 24h via KV with 86400s TTL)
  const key = `rl:${ip}`;
  const count = parseInt((await env.RATE_LIMIT.get(key)) || "0");
  if (count >= 3) return error("该IP今日提交次数已达上限（3次/天），请明天再试", 429, corsHeaders);

  // 3. Sensitive word filter (title only — PDF content is binary)
  const SENSITIVE = [
    /法轮功/i, /翻墙/, /分裂国家/, /邪教/,
    /自杀指南/, /制毒/, /卖淫/, /枪支交易/,
  ];
  for (const re of SENSITIVE) {
    if (re.test(body.title))
      return error("内容涉及敏感词汇，提交失败", 403, corsHeaders);
  }

  // 4. Field validation
  const title = (body.title || "").trim();
  const category = (body.category || "").trim();
  const pdfBase64 = (body.pdfBase64 || "").trim();
  const contact = (body.contact || "").trim();
  const fileSize = body.fileSize || 0;
  const CATEGORIES = ["数学", "计算机", "物理", "商业", "人文", "历史", "其他"];

  if (!title || title.length > 30) return error("书名不能为空且不超过30字", 400, corsHeaders);
  if (!pdfBase64 || pdfBase64.length > 70_000_000) return error("PDF内容不能为空且不超过50MB", 400, corsHeaders);
  if (!contact) return error("联系方式不能为空", 400, corsHeaders);
  if (!CATEGORIES.includes(category)) return error("无效的分类", 400, corsHeaders);
  if (!fileSize || fileSize > 50 * 1024 * 1024) return error("文件大小无效", 400, corsHeaders);

  // 5. Build file paths and metadata
  const safeName = title.replace(/[\\/:*?"<>|#\[\]]/g, "_");
  const pdfPath = `books/${category}/${safeName}.pdf`;
  const mdPath = `books/${category}/${safeName}.md`;
  const now = new Date().toISOString();
  const metadata = `<!-- 贡献者: ${contact} | 提交IP: ${ip} | 提交时间: ${now} | 文件大小: ${fileSize} -->\n\n# ${title}\n`;

  // 6. Commit PDF and metadata to GitHub via Contents API
  try {
    // Step 1: Create the PDF file
    const pdfRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURIComponent(pdfPath).replace(/%2F/g, "/")}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          "Content-Type": "application/json",
          "User-Agent": "BookVault-Worker",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          message: `add: [${category}] ${title} (PDF)`,
          content: pdfBase64,
        }),
      }
    );
    if (!pdfRes.ok) {
      const d = await pdfRes.json();
      if ((d.message || "").includes("Invalid request") || pdfRes.status === 422)
        return error("同名书籍已存在，请使用不同的书名", 409, corsHeaders);
      return error(`存储PDF失败: ${d.message || "GitHub API 错误"}`, 500, corsHeaders);
    }

    // Step 2: Create the metadata markdown file (for index generation)
    const mdRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURIComponent(mdPath).replace(/%2F/g, "/")}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          "Content-Type": "application/json",
          "User-Agent": "BookVault-Worker",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          message: `add: [${category}] ${title} (metadata)`,
          content: btoa(unescape(encodeURIComponent(metadata))),
        }),
      }
    );
    if (!mdRes.ok) {
      const d = await mdRes.json();
      return error(`存储元数据失败: ${d.message || "GitHub API 错误"}`, 500, corsHeaders);
    }

    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 86400 });
    return new Response(JSON.stringify({ success: true, message: "提交成功！书籍已上架。", path: pdfPath }), { status: 200, headers: corsHeaders });
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
