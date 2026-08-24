import WebSocket from 'ws';

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const ws = new WebSocket('ws://127.0.0.1:29100');

log('Connecting...');

ws.on('open', () => {
  log('Connected to server!');
  
  ws.send(JSON.stringify({
    type: 'extension_connected',
    data: { version: '1.0.0', capabilities: ['navigate', 'click', 'type', 'hover', 'snapshot'] }
  }));
  
  log('Sent extension_connected message');
});

ws.on('message', (data) => {
  log(`Received message: ${data}`);
});

ws.on('close', (code, reason) => {
  log(`Connection closed. Code: ${code}, Reason: ${reason.toString()}`);
});

ws.on('error', (err) => {
  log(`Connection error: ${err}`);
});

setTimeout(() => {
  log('Closing client...');
  ws.close();
}, 20000);
