const http = require('http');

http.get('http://localhost:9999/', (res) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const b = Buffer.concat(chunks);
    const hasBOM = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    console.log('Served HTML BOM:', hasBOM);
    console.log('First bytes:', Array.from(b.slice(0, 8)).map(x => x.toString(16).padStart(2, '0')).join(' '));
    const s = b.toString('utf-8', hasBOM ? 3 : 0, 100);
    console.log('First chars:', JSON.stringify(s));
  });
}).on('error', err => console.error('Error:', err.message));
