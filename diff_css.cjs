const { execSync } = require('child_process');

// Get the diff between HEAD and current for operationalRoles.css
const out = execSync('git diff HEAD -- src/styles/operationalRoles.css', { encoding: 'utf-8' });
const lines = out.split('\n');

// Show only added lines (starting with +) that are not @@ or +++
console.log('Added lines in operationalRoles.css:');
let count = 0;
for (const line of lines) {
  if (line.startsWith('+') && !line.startsWith('+++') && !line.startsWith('+@@')) {
    console.log(line);
    count++;
    if (count > 50) {
      console.log('... (truncated, total added lines too many)');
      break;
    }
  }
}
