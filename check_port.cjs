const net = require('net');
const client = new net.Socket();
client.setTimeout(3000);
client.on('connect', () => {
  console.log('Port 9999 is OPEN');
  client.destroy();
});
client.on('error', (err) => {
  console.log('Port 9999 is CLOSED:', err.message);
});
client.on('timeout', () => {
  console.log('Port 9999 TIMEOUT');
  client.destroy();
});
client.connect(9999, '127.0.0.1');
