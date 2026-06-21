const fs = require('fs');
const files = ['src/styles/appShell.css', 'src/styles/operationalRoles.css', 'src/styles/waiterUiEase.css'];
files.forEach(f => {
  const b = fs.readFileSync(f);
  const hasBOM = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
  const s = b.toString('utf-8', hasBOM ? 3 : 0, 200);
  const m = s.match(/[\u0600-\u06FF]/);
  console.log(f, 'BOM:', hasBOM, 'Arabic:', !!m, m ? JSON.stringify(s.slice(s.indexOf(m[0]), s.indexOf(m[0]) + 25)) : '');
});
