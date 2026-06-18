const { execSync } = require('child_process');
const out = execSync('git show HEAD:src/styles/operationalRoles.css', { encoding: 'utf-8' });
const lines = out.split('\n');
console.log('Total lines in HEAD:', lines.length);
console.log('First 5 lines:');
for (let i = 0; i < 5; i++) console.log(JSON.stringify(lines[i]));
