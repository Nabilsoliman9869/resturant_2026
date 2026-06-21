const fs = require('fs');

// Add UTF-8 BOM to root index.html
const f = 'index.html';
const b = fs.readFileSync(f);
const hasBOM = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
if (!hasBOM) {
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), b]));
  console.log('Added BOM to', f);
} else {
  console.log('Already has BOM');
}
