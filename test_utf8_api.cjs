const http = require('http');

http.get('http://localhost:2288/api/restaurant/table-sessions', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Content-Type:', res.headers['content-type']);
    const hasEscaped = data.includes('\\u06');
    const hasRawArabic = /[\u0600-\u06FF]/.test(data);
    console.log('Has escaped Arabic:', hasEscaped);
    console.log('Has raw Arabic:', hasRawArabic);
    const match = data.match(/vipOwnerLabel":"([^"]+)"/);
    if (match) {
      console.log('vipOwnerLabel:', match[1]);
    } else {
      console.log('No vipOwnerLabel found in first response');
    }
  });
}).on('error', err => console.error('Error:', err.message));
