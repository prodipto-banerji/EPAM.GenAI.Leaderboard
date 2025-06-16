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

// Path for SQLite database
const DB_PATH = path.join(__dirname, 'leaderboard.db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(bodyParser.json());

// Initialize database connection
let db;
let ranker = new Ranker();

async function initializeDatabase() {
    try {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // Create players table if it doesn't exist        // Create slots table
        await db.exec(`
            DROP TABLE IF EXISTS slots;
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
            DROP TABLE IF EXISTS players;
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
async function broadcastRankings(location) {
    const rankings = ranker.getRankedPlayers()
        .filter(player => player.location === location);    // Get last completed slot information if no active slot
    const lastSlot = !currentSlot ? await getLastCompletedSlot() : null;
    
    const message = JSON.stringify({
        type: 'rankings',
        location: location,
        data: rankings,
        gameStatus: {
            active: !!currentSlot,
            slotName: currentSlot ? currentSlot.name : (lastSlot ? lastSlot.name : null),
            message: currentSlot 
                ? `Game Session "${currentSlot.name}" is active!` 
                : 'No active game session. Please wait for the next game to start.',
            lastSlotInfo: lastSlot ? {
                name: lastSlot.name,
                startTime: lastSlot.start_time,
                endTime: lastSlot.end_time,
                duration: lastSlot.duration
            } : null
        }
    });

    // Send to all clients watching this location
    for (const [client, clientLocation] of clients.entries()) {
        if (clientLocation === location && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

// Broadcast game status to all clients
function broadcastGameStatus(isActive, slotInfo = null) {
    const message = JSON.stringify({
        type: 'gameStatus',
        status: {
            active: isActive,
            slotName: slotInfo ? slotInfo.name : null,
            message: isActive 
                ? `Game Session "${slotInfo.name}" is active!` 
                : 'No active game session. Please wait for the next game to start.',
            lastSlotInfo: !isActive && slotInfo ? {
                name: slotInfo.name,
                startTime: slotInfo.startTime,
                endTime: slotInfo.endTime || new Date().toISOString(),
                duration: slotInfo.duration
            } : null
        }
    });

    // Send to all connected clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Broadcast to all WebSocket clients
function broadcastToAll(message) {
    console.log('Broadcasting to all clients:', message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Broadcast game state change
async function broadcastGameStateChange(status, slotInfo = null) {
    console.log('Broadcasting game state change:', { status, slotInfo });
    
    // Get last completed slot if game is stopping
    const lastSlot = !status.active ? await getLastCompletedSlot() : null;
    
    const gameStatus = {
        type: 'gameStatus',
        status: {
            active: status.active,
            slotName: status.slotName,
            message: status.message,
            lastSlotInfo: lastSlot
        }
    };

    // First broadcast game status
    broadcastToAll(gameStatus);

    // Then broadcast empty rankings for all locations if game is starting
    if (status.active) {
        const locations = new Set([...clients.values()]);
        for (const location of locations) {
            const rankings = {
                type: 'rankings',
                location: location,
                data: [],
                gameStatus: gameStatus.status
            };
            broadcastToAll(rankings);
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
        // First check if there are any active slots in the database
        const activeSlot = await db.get('SELECT * FROM slots WHERE status = ?', ['active']);
        if (activeSlot) {
            throw new Error('Another slot is currently active in the database');
        }

        // Begin transaction
        await db.run('BEGIN TRANSACTION');
        
        try {
            const result = await db.run(
                'INSERT INTO slots (name, status, start_time) VALUES (?, ?, ?)',
                [slotName, 'active', new Date().toISOString()]
            );
            
            currentSlot = {
                id: result.lastID,
                name: slotName,
                startTime: new Date()
            };

            // Clear previous rankings
            ranker = new Ranker();

            // Broadcast the game state change
            await broadcastGameStateChange({
                active: true,
                slotName: slotName,
                message: `Game Session "${slotName}" is active!`
            }, currentSlot);

            await db.run('COMMIT');
            return currentSlot;
        } catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
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

        const endTime = new Date();
        
        // Begin transaction
        await db.run('BEGIN TRANSACTION');
        
        try {
            // Update slot end time and status
            await db.run(
                'UPDATE slots SET status = ?, end_time = ? WHERE id = ? AND status = ?',
                ['completed', endTime.toISOString(), currentSlot.id, 'active']
            );            // Get slot duration with proper date formatting
            const slotInfo = await db.get(`
                SELECT 
                    name,
                    datetime(start_time) as start_time,
                    datetime(end_time) as end_time,
                    strftime('%M:%S', (julianday(end_time) - julianday(start_time)) * 86400.0) as duration
                FROM slots 
                WHERE id = ?
            `, [currentSlot.id]);

            // Get top 3 winners
            const winners = await db.all(`
                SELECT name, email, score, displaytime
                FROM players
                WHERE slot_id = ?
                ORDER BY score DESC, timetaken ASC
                LIMIT 3
            `, [currentSlot.id]);

            // Store slot info before clearing currentSlot
            const stoppedSlotInfo = {
                ...slotInfo,
                id: currentSlot.id
            };

            // Clear current slot
            currentSlot = null;

            // Broadcast the game state change
            await broadcastGameStateChange({
                active: false,
                slotName: slotName,
                message: 'No active game session. Please wait for the next game to start.'
            }, stoppedSlotInfo);

            await db.run('COMMIT');
            return winners;
        } catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('Error stopping slot:', error);
        throw error;
    }
}

// Get the last completed slot information
async function getLastCompletedSlot() {
    try {
        const lastSlot = await db.get(`
            SELECT 
                name,
                start_time,
                end_time,
                strftime('%M:%S', (julianday(end_time) - julianday(start_time)) * 86400.0) as duration
            FROM slots 
            WHERE status = 'completed' 
            ORDER BY end_time DESC 
            LIMIT 1
        `);
        return lastSlot;
    } catch (error) {
        console.error('Error getting last completed slot:', error);
        return null;
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

        console.log('Starting new slot:', slotName);
        const slot = await startSlot(slotName);
        
        console.log('Slot started successfully:', slot);
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

// Stop a game slot
app.post('/api/slot/stop', async (req, res) => {
    try {
        const { slotName } = req.body;
        
        if (!slotName) {
            return res.status(400).json({
                status: 'error',
                message: 'Slot name is required'
            });
        }

        console.log('Stopping slot:', slotName);
        const winners = await stopSlot(slotName);
        
        console.log('Slot stopped successfully, winners:', winners);
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
