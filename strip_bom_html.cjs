const fs = require('fs');
const f = 'ui/restaurant/index.html';
const b = fs.readFileSync(f);
if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
  fs.writeFileSync(f, b.slice(3));
  console.log('Removed BOM from', f);
} else {
  console.log('No BOM in', f);
}
