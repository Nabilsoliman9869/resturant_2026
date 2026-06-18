const http = require('http');

http.get('http://localhost:2288/__whoami__', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', data.substring(0, 200));
  });
}).on('error', err => console.error('Error:', err.message));
