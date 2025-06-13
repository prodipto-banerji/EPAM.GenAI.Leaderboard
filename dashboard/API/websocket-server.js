// websocket-server.js - Node.js WebSocket server with REST endpoint for Player data
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const Player = require('../Model/Player');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(bodyParser.json());

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
});

// POST endpoint to receive Player data
app.post('/api/player', (req, res) => {
    const { name, email, score, durationTime, date, location } = req.body;
    const player = new Player(name, email, score, durationTime, date, location);
    // Broadcast to all connected WebSocket clients
    const message = JSON.stringify({ type: 'player', data: player });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
    res.json(player);
});

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`WebSocket server and REST API running on http://localhost:${PORT}`);
});
