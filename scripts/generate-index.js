#!/usr/bin/env node
// generate-index.js - Scans /books directory and generates books.json index file.
// Run: node scripts/generate-index.js
// Output: public/books.json

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'books');
const OUTPUT = path.join(ROOT, 'public', 'books.json');

const CATEGORIES = ['数学', '计算机', '物理', '商业', '人文', '历史', '其他'];
const books = [];

for (const cat of CATEGORIES) {
  const catDir = path.join(BOOKS_DIR, cat);
  if (!fs.existsSync(catDir)) continue;

  for (const file of fs.readdirSync(catDir)) {
    if (!file.endsWith('.md')) continue;

    const content = fs.readFileSync(path.join(catDir, file), 'utf-8');
    const titleMatch = content.match(/^# (.+)$/m);
    const metaMatch = content.match(/^<!-- (.+?) -->/);

    let contributor = '', date = '', fileSize = 0;
    if (metaMatch) {
      const fields = metaMatch[1].split('|').map(s => s.trim());
      for (const f of fields) {
        if (f.startsWith('贡献者: ')) contributor = f.slice(5);
        else if (f.startsWith('提交时间: ')) date = f.slice(6);
        else if (f.startsWith('文件大小: ')) fileSize = parseInt(f.slice(6));
      }
    }

    // Extract first 200 chars of body as preview (skip metadata + title)
    const bodyStart = content.indexOf('\n\n# ') !== -1 ? content.indexOf('\n\n# ') + 4 : 0;
    const bodyText = content.slice(bodyStart).replace(/^# .+\n+/, '').replace(/[#*_`>\-]/g, '').trim();
    const preview = bodyText.slice(0, 200);

    const pdfFile = file.replace(/\.md$/, '.pdf');
    const hasPdf = fs.existsSync(path.join(catDir, pdfFile));
    books.push({
      title: titleMatch ? titleMatch[1] : path.basename(file, '.md'),
      category: cat,
      path: `books/${cat}/${hasPdf ? pdfFile : file}`,
      contributor,
      date,
      fileSize,
      preview,
    });
  }
}

// Sort by date descending (newest first)
books.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(books, null, 2), 'utf-8');
console.log(`Generated index: ${books.length} books → ${OUTPUT}`);
