const fs = require('fs');
const b = fs.readFileSync('ui/restaurant/index.html');
const hasBOM = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
console.log('ui/restaurant/index.html BOM:', hasBOM);
console.log('First bytes:', Array.from(b.slice(0, 8)).map(x => x.toString(16).padStart(2, '0')).join(' '));
const s = b.toString('utf-8', hasBOM ? 3 : 0, 200);
console.log('Has charset meta:', s.includes('charset="UTF-8"'));
