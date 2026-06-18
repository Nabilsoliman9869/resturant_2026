const http = require('http');

http.get('http://localhost:9999/src/styles/operationalRoles.css', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Content-Type:', res.headers['content-type']);
    const hasArabic = /[\u0600-\u06FF]/.test(data);
    console.log('Has Arabic:', hasArabic);
    if (hasArabic) {
      const idx = data.indexOf('مخصص');
      console.log('Found مخصص at', idx);
    }
  });
}).on('error', err => console.error('Error:', err.message));
