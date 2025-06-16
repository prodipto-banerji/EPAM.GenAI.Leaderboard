// websocket-server.js - Node.js WebSocket server with REST endpoint for Player data
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const Player = require('../Model/Player');
const Ranker = require('../Model/Ranker');
const nodemailer = require('nodemailer');

// Path for SQLite database
const DB_PATH = path.join(__dirname, 'leaderboard.db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(bodyParser.json());

// Email configuration - update with your email service details
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-specific-password'
    }
});

// Initialize database connection
let db;
const ranker = new Ranker();

async function initializeDatabase() {
    try {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // Create players table if it doesn't exist        // Create slots table
        await db.exec(`
            CREATE TABLE IF NOT EXISTS slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create players table
        await db.exec(`
            CREATE TABLE IF NOT EXISTS players (
                email TEXT NOT NULL,
                name TEXT NOT NULL,
                score INTEGER NOT NULL,
                timetaken INTEGER NOT NULL,
                displaytime TEXT NOT NULL,
                date TEXT NOT NULL,
                location TEXT NOT NULL,
                slot_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (email, slot_id),
                FOREIGN KEY (slot_id) REFERENCES slots(id)
            )
        `);

        // Load existing players into ranker
        await loadPlayersFromDb();
        
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        process.exit(1);
    }
}

async function loadPlayersFromDb() {
    try {
        const players = await db.all('SELECT * FROM players');
        const playerObjects = players.map(p => new Player(
            p.name,
            p.email,
            p.score,
            p.timetaken,
            p.displaytime,
            new Date(p.date),
            p.location
        ));
        
        if (playerObjects.length > 0) {
            ranker.addPlayers(playerObjects);
            console.log(`Loaded ${playerObjects.length} players from database`);
        }
    } catch (error) {
        console.error('Error loading players from database:', error);
    }
}

async function addPlayerToDb(player) {
    try {
        // Ensure all values are properly formatted
        const dateString = player.date instanceof Date ? 
            player.date.toISOString() : 
            new Date().toISOString();

        // Only add player if there's an active slot
        if (!currentSlot) {
            throw new Error('No active slot. Cannot add player.');
        }

        await db.run(`
            INSERT OR REPLACE INTO players 
            (email, name, score, timetaken, displaytime, date, location, slot_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                player.email,
                player.name,
                Number(player.score),
                Number(player.timetaken),
                player.displaytime,
                dateString,
                player.location,
                currentSlot.id
            ]
        );
    } catch (error) {
        console.error('Error adding player to database:', error);
        throw error;
    }
}

// Initialize database when server starts
initializeDatabase();

// Store connected clients with their locations
const clients = new Map(); // Using Map to store client-location pairs

// Broadcast updated rankings to all clients of a specific location
function broadcastRankings(location) {    const rankings = ranker.getRankedPlayers()
        .filter(player => player.location === location);

    const message = JSON.stringify({
        type: 'rankings',
        location: location,
        data: rankings
    });

    // Send to all clients watching this location
    for (const [client, clientLocation] of clients.entries()) {
        if (clientLocation === location && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

wss.on('connection', (ws) => {
    // Wait for client to send their location preference
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'setLocation') {
                // Store client's location preference
                clients.set(ws, data.location);
                // Send initial rankings for their location
                broadcastRankings(data.location);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

// POST endpoint to receive Player data
app.post('/api/player', async (req, res) => {
    try {
        // Check if there's an active game slot
        if (!currentSlot) {
            return res.status(400).json({
                status: 'error',
                message: 'No active game session. Please wait for the next game slot to start.',
                code: 'NO_ACTIVE_SLOT'
            });
        }

        const { name, email, score, timetaken, displaytime, date, location } = req.body;
        
        // Validate required fields
        if (!name || !email || score === undefined || !timetaken || !displaytime || !location) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields',
                required: ['name', 'email', 'score', 'timetaken', 'displaytime', 'location']
            });
        }

        // Use current date if not provided
        const playerDate = date ? new Date(date) : new Date();
        
        // Validate date
        if (isNaN(playerDate.getTime())) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format',
                providedDate: date
            });
        }

        // Create new player with validated data
        const player = new Player(
            name,
            email,
            typeof score === 'string' ? parseInt(score) : score,
            typeof timetaken === 'string' ? parseInt(timetaken) : timetaken,
            displaytime,
            playerDate,
            location
        );
        
        // Add to database (this handles concurrent access)
        await addPlayerToDb(player);
        
        // Add to ranker for in-memory rankings
        ranker.addPlayers(player);
        
        // Broadcast updated rankings for this location
        broadcastRankings(location);
        
        res.json({
            status: 'success',
            message: 'Player added successfully',
            player: player
        });
    } catch (error) {
        console.error('Error adding player:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to add player',
            error: error.message
        });
    }
});

// GET endpoint to retrieve current rankings for a location
app.get('/api/rankings/:location', (req, res) => {
    const location = req.params.location;    const rankings = ranker.getRankedPlayers()
        .filter(player => player.location === location); // Return all players for infinite scroll
    
    res.json({
        status: 'success',
        location: location,
        rankings: rankings
    });
});

// Current active slot
let currentSlot = null;

// Slot management functions
async function startSlot(slotName) {
    try {
        const result = await db.run(
            'INSERT INTO slots (name, status, start_time) VALUES (?, ?, ?)',            [slotName, 'active', new Date().toISOString()]
        );
        currentSlot = {
            id: result.lastID,
            name: slotName,
            startTime: new Date()
        };
        return currentSlot;
    } catch (error) {
        console.error('Error starting slot:', error);
        throw error;
    }
}

async function stopSlot(slotName) {
    try {
        if (!currentSlot || currentSlot.name !== slotName) {
            throw new Error('No matching active slot found');
        }

        // Update slot end time
        await db.run(
            'UPDATE slots SET status = ?, end_time = ? WHERE id = ?',
            ['completed', new Date().toISOString(), currentSlot.id]
        );

        // Get top 3 winners for this slot
        const winners = await db.all(`
            SELECT name, email, score, displaytime
            FROM players
            WHERE slot_id = ?
            ORDER BY score DESC, timetaken ASC
            LIMIT 3
        `, [currentSlot.id]);

        return winners;
    } catch (error) {
        console.error('Error stopping slot:', error);
        throw error;
    }
}

// Start a new game slot
app.post('/api/slot/start', async (req, res) => {
    try {
        const { slotName } = req.body;
        
        if (!slotName) {
            return res.status(400).json({
                status: 'error',
                message: 'Slot name is required'
            });
        }

        if (currentSlot) {
            return res.status(400).json({
                status: 'error',
                message: 'Another slot is currently active'
            });
        }

        const slot = await startSlot(slotName);
        
        res.json({
            status: 'success',
            message: 'Game slot started successfully',
            slot
        });
    } catch (error) {
        console.error('Error starting slot:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to start game slot',
            error: error.message
        });
    }
});

// Stop a game slot and send winner emails
app.post('/api/slot/stop', async (req, res) => {
    try {
        const { slotName } = req.body;
        
        if (!slotName) {
            return res.status(400).json({
                status: 'error',
                message: 'Slot name is required'
            });
        }

        const winners = await stopSlot(slotName);
        
        res.json({
            status: 'success',
            message: 'Game slot stopped successfully',
            winners: winners
        });
    } catch (error) {
        console.error('Error stopping slot:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to stop game slot',
            error: error.message
        });
    }
});

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`WebSocket server and REST API running on http://localhost:${PORT}`);
});
