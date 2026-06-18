const { execSync } = require('child_process');
const out = execSync('git show HEAD:src/styles/operationalRoles.css', { encoding: 'utf-8' });
const lines = out.split('\n');
const idx = lines.findIndex(l => l.includes('waiter-tables-owner-pill'));
if (idx >= 0) {
  console.log('Found at line', idx + 1);
  for (let i = idx; i < Math.min(idx + 15, lines.length); i++) {
    console.log(i + 1, JSON.stringify(lines[i]));
  }
} else {
  console.log('waiter-tables-owner-pill NOT found in HEAD');
}
