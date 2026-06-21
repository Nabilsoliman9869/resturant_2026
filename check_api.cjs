const http = require('http');

function fetchJson(url) {
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
    // Check the backend API for table sessions
    const r = await fetchJson('http://localhost:2288/api/restaurant/table-sessions');
    console.log('API Status:', r.status);
    console.log('API Content-Type:', r.headers['content-type']);
    
    if (r.status === 200) {
      const obj = JSON.parse(r.body);
      console.log('Response type:', Array.isArray(obj) ? 'array' : typeof obj);
      
      // Look for billingProfile with Arabic text
      const items = Array.isArray(obj) ? obj : (obj.items || []);
      let found = false;
      for (const item of items.slice(0, 10)) {
        const bp = item?.billingProfile;
        if (bp && bp.vipOwnerLabel) {
          const label = String(bp.vipOwnerLabel);
          const hasArabic = /[\u0600-\u06FF]/.test(label);
          console.log('Found vipOwnerLabel:', JSON.stringify(label), 'Arabic:', hasArabic);
          found = true;
          break;
        }
      }
      if (!found) console.log('No vipOwnerLabel with Arabic found in first 10 items');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
