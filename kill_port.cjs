const { execSync } = require('child_process');

try {
  const out = execSync('netstat -ano', { encoding: 'utf-8' });
  const lines = out.split('\n').filter(l => l.includes(':9999') && l.includes('LISTENING'));
  console.log('Listening on 9999:');
  lines.forEach(l => console.log(l.trim()));
  const pids = [...new Set(lines.map(l => l.trim().split(/\s+/).pop()).filter(Boolean))];
  console.log('PIDs:', pids);
  pids.forEach(pid => {
    try {
      execSync(`taskkill /F /PID ${pid}`);
      console.log('Killed PID', pid);
    } catch (e) {
      console.log('Failed to kill PID', pid, e.message);
    }
  });
} catch (e) {
  console.error('Error:', e.message);
}
