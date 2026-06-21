const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  try {
    const r = await fetch('http://localhost:9999/src/styles/operationalRoles.css');
    console.log('Status:', r.status);
    console.log('Content-Type:', r.headers['content-type']);
    const first = r.body.slice(0, 120);
    console.log('First 120 chars:', JSON.stringify(first));
    const hasArabic = /[\u0600-\u06FF]/.test(r.body);
    console.log('Has Arabic:', hasArabic);
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
