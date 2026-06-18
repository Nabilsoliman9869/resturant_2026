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
    
    // Look for Arabic text in the module
    const idx = r.body.indexOf('\u0645\u062E\u0635\u0635'); // "مخصص"
    const idx2 = r.body.indexOf('waiter-tables-owner-pill');
    console.log('Has Arabic chars directly:', idx >= 0);
    console.log('Has owner-pill class:', idx2 >= 0);
    
    if (idx >= 0) {
      console.log('Context around Arabic:', JSON.stringify(r.body.substring(Math.max(0, idx-30), idx+30)));
    }
    
    // Check for Unicode escapes
    const hasEscapes = /\\u[0-9a-fA-F]{4}/.test(r.body);
    console.log('Has Unicode escapes:', hasEscapes);
    
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
