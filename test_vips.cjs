const http = require('http');

http.get('http://localhost:2288/api/restaurant/vip-owners', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Content-Type:', res.headers['content-type']);
    console.log('Has escaped:', data.includes('\\u06'));
    console.log('Has raw Arabic:', /[\u0600-\u06FF]/.test(data));
    console.log('First 300 chars:', data.substring(0, 300));
  });
}).on('error', err => console.error('Error:', err.message));
