const fs = require('fs');
const b = fs.readFileSync('index.html');
const hex = Array.from(b.slice(0, 8)).map(x => x.toString(16).padStart(2, '0')).join(' ');
console.log('Root index.html first bytes:', hex);
const s = b.toString('utf-8', 0, 100);
console.log('First chars:', JSON.stringify(s.slice(0, 50)));
