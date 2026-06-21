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
    const r = await fetch('http://localhost:9999/');
    console.log('Status:', r.status);
    console.log('Content-Type:', r.headers['content-type']);
    const first = r.body.slice(0, 300);
    console.log('First 300 chars:', JSON.stringify(first));
    const hasMeta = first.includes('charset="UTF-8"') || first.includes('charset=utf-8');
    console.log('Has charset meta:', hasMeta);
    const hasHttpEquiv = first.includes('http-equiv="Content-Type"');
    console.log('Has http-equiv:', hasHttpEquiv);
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
