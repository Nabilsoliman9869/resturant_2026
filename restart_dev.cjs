const { execSync } = require('child_process');

// Kill any process on port 9999
try {
  const out = execSync('netstat -ano', { encoding: 'utf-8' });
  const lines = out.split('\n');
  const pids = new Set();
  for (const line of lines) {
    if (line.includes(':9999') && line.includes('LISTENING')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid) pids.add(pid);
    }
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`);
      console.log('Killed PID', pid);
    } catch (e) {
      console.log('Failed to kill PID', pid);
    }
  }
} catch (e) {
  console.error('Error finding PIDs:', e.message);
}
