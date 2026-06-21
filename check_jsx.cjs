const fs = require('fs');
const path = require('path');

function scan(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const p = path.join(dir, f);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      if (!f.startsWith('.') && f !== 'node_modules') scan(p);
    } else if (f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.jsx') || f.endsWith('.js')) {
      const b = fs.readFileSync(p);
      const hasBOM = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
      const s = b.toString('utf-8', hasBOM ? 3 : 0, Math.min(b.length, 500));
      const hasArabic = /[\u0600-\u06FF]/.test(s);
      if (hasArabic || hasBOM) {
        console.log(p, 'BOM:', hasBOM, 'Arabic:', hasArabic);
      }
    }
  }
}

scan('src');
