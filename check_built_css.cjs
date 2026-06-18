const fs = require('fs');
const b = fs.readFileSync('ui/restaurant/assets/index-S80mmvSc.css', 'utf-8');
const idx = b.indexOf('waiter-tables-owner-pill');
if (idx >= 0) {
  console.log('Found at', idx);
  console.log(b.substring(idx, idx + 200));
} else {
  console.log('NOT FOUND');
}
const hasArabic = /[\u0600-\u06FF]/.test(b);
console.log('Has Arabic:', hasArabic);
