const fs = require('fs');
const b = fs.readFileSync('ui/restaurant/assets/index-CgVtqJnM.js', 'utf-8');
const hasArabic = /[\u0600-\u06FF]/.test(b);
console.log('Built JS Has Arabic:', hasArabic);
const idx = b.indexOf('waiter-tables-owner-pill');
if (idx >= 0) {
  console.log('Found owner-pill at', idx);
  console.log('Context:', JSON.stringify(b.substring(idx - 50, idx + 200)));
} else {
  console.log('owner-pill NOT FOUND');
}
const idx2 = b.indexOf('ضيف');
console.log('Has ضيف:', idx2 >= 0);
const idx3 = b.indexOf('مخصص');
console.log('Has مخصص:', idx3 >= 0);
