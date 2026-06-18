const { spawn } = require('child_process');

const py = 'C:\\Users\\NabilSirconsult\\env\\Scripts\\python.exe';
const proc = spawn(py, ['backend/api_server.py'], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

proc.on('error', (err) => {
  console.error('Failed to start backend:', err.message);
});
