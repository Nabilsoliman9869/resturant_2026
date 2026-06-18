const { execSync } = require('child_process');

// Find Python process running api_server.py
const tasklist = execSync('tasklist /FI "IMAGENAME eq python.exe" /FO CSV', { encoding: 'utf-8' });
console.log('Python processes:', tasklist);

// Find PID listening on port 2288
const netstat = execSync('netstat -ano', { encoding: 'utf-8' });
const lines = netstat.split('\n');
const pids = new Set();
for (const line of lines) {
  if (line.includes(':2288') && line.includes('LISTENING')) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid) pids.add(pid);
  }
}
console.log('Port 2288 PIDs:', [...pids]);
for (const pid of pids) {
  try {
    execSync(`taskkill /F /PID ${pid}`);
    console.log('Killed PID', pid);
  } catch (e) {
    console.log('Failed to kill PID', pid, e.message);
  }
}
