import { WebSocketServer } from 'ws';

const port = 29100;
const wss = new WebSocketServer({ port });

console.log(`Debug WebSocket server started on port ${port}`);

wss.on('connection', (ws) => {
  console.log('Client connected!');
  
  ws.on('message', (message) => {
    console.log(`Received message: ${message}`);
    const data = JSON.parse(message);
    
    if (data.type === 'heartbeat_ping') {
      console.log('Sending heartbeat_pong');
      ws.send(JSON.stringify({ type: 'heartbeat_pong', result: 'pong' }));
    }
  });
  
  ws.on('close', (code, reason) => {
    console.log(`Client disconnected. Code: ${code}, Reason: ${reason}`);
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});
