const fs = require('fs');

// Read operationalRoles.css as bytes
const b = fs.readFileSync('src/styles/operationalRoles.css');

// Check for invalid UTF-8 sequences
function isValidUTF8(buf) {
  try {
    buf.toString('utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

console.log('Valid UTF-8:', isValidUTF8(b));

// Find Arabic characters and show context
const s = b.toString('utf-8');
const matches = [...s.matchAll(/[\u0600-\u06FF]+/g)];
console.log('Arabic word count:', matches.length);
for (let i = 0; i < Math.min(5, matches.length); i++) {
  const m = matches[i];
  const idx = m.index;
  console.log(`  Match ${i+1} at ${idx}: "${m[0]}"`);
  console.log(`    Context: ${JSON.stringify(s.substring(Math.max(0, idx-20), idx + m[0].length + 20))}`);
}
