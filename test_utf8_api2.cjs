const http = require('http');

http.get('http://localhost:2288/api/restaurant/table-sessions', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Content-Type:', res.headers['content-type']);
    console.log('Body length:', data.length);
    console.log('First 500 chars:', data.substring(0, 500));
  });
}).on('error', err => console.error('Error:', err.message));
