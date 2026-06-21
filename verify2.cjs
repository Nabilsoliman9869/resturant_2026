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
    console.log('Body length:', r.body.length);
    console.log('First 50 chars:', JSON.stringify(r.body.substring(0, 50)));
    console.log('Has DOCTYPE:', r.body.includes('<!DOCTYPE html>'));
    console.log('Has charset meta:', r.body.includes('charset="UTF-8"'));
    console.log('Has http-equiv:', r.body.includes('http-equiv'));
    const idx = r.body.indexOf('charset="UTF-8"');
    if (idx >= 0) {
      console.log('Context around charset:', JSON.stringify(r.body.substring(idx - 20, idx + 30)));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
