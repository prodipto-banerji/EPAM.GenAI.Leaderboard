// websocket-server.js - Main server file that initializes all components
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const Ranker = require('./Model/Ranker');
const DatabaseService = require('./services/DatabaseService');
const WebSocketService = require('./services/WebSocketService');
const ApiRouter = require('./routes/ApiRouter');

// Constants for paths
const DB_PATH = path.join(__dirname, 'leaderboard.db');
const UI_PATH = path.join(__dirname, './UI');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Configure CORS and middleware
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// Add CORS headers to all responses
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', true);
    
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

// Initialize services
const databaseService = new DatabaseService(DB_PATH);
let wss; // <-- Expose wss for use in this file

// Create an async function to initialize the server
async function initializeServer() {
    try {
        // Initialize database first
        await databaseService.initialize();
        
        // Then initialize other services that depend on the database
        const ranker = new Ranker();
        const webSocketService = new WebSocketService(server, databaseService, ranker);
        wss = webSocketService.wss; // <-- Expose wss for use in this file
        const apiRouter = new ApiRouter(databaseService, webSocketService);

        // Set up routes
        app.use('/api', apiRouter.getRouter());
        app.use(express.static(UI_PATH));
app.get('/', (req, res) => {
    res.sendFile(path.join(UI_PATH, 'dashboard.html'));
});

    } catch (error) {
        console.error('Error initializing server:', error);
        throw error;
    }
}

// Database helper functions
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
let db; // <-- Add this line to define db globally
let currentSlot = null; // <-- Add this line to define currentSlot globally

// Client management for WebSocket connections
const clients = new Map(); // <-- Track WebSocket clients and their locations

// Ensure database is initialized before any db access
async function ensureDbInitialized() {
    if (!db) {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
    }
}

// Create database tables
async function createTables() {
    try {
        // Create slots table
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
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                score INTEGER NOT NULL,
                timetaken INTEGER NOT NULL,
                displaytime TEXT NOT NULL,
                date TIMESTAMP NOT NULL,
                location TEXT NOT NULL,
                slot_id INTEGER NOT NULL,
                FOREIGN KEY (slot_id) REFERENCES slots(id)
            )
        `);
    } catch (error) {
        console.error('Error creating tables:', error);
        throw error;
    }
}

// Get all slots with their status
async function getAllSlots() {
    try {
        await ensureDbInitialized();
        return await db.all(`
            SELECT 
                id,
                name,
                status,
                datetime(start_time) as start_time,
                datetime(end_time) as end_time,
                CASE 
                    WHEN (strftime('%s', COALESCE(end_time, datetime('now'))) - strftime('%s', start_time)) / 3600 >= 1 
                    THEN strftime('%H:%M:%S', julianday(COALESCE(end_time, datetime('now'))) - julianday(start_time)) 
                    ELSE strftime('%M:%S', julianday(COALESCE(end_time, datetime('now'))) - julianday(start_time)) 
                END as duration
            FROM slots 
            ORDER BY start_time DESC
        `);
    } catch (error) {
        console.error('Error getting all slots:', error);
        throw error;
    }
}

// Get current active slot
async function getActiveSlot() {
    try {
        await ensureDbInitialized();
        return await db.get(`
            SELECT id, name, datetime(start_time) as start_time
            FROM slots 
            WHERE status = 'active' 
            ORDER BY start_time DESC 
            LIMIT 1
        `);
    } catch (error) {
        console.error('Error getting active slot:', error);
        throw error;
    }
}

// Function to get players for a specific slot
async function getPlayersForSlot(slotId, location = null) {
    try {
        await ensureDbInitialized();
        const params = [slotId];
        let query = 'SELECT p.*, s.name as slot_name, s.status as slot_status ' +
                   'FROM players p ' +
                   'JOIN slots s ON p.slot_id = s.id ' +
                   'WHERE p.slot_id = ?';

        if (location) {
            query += ' AND p.location = ?';
            params.push(location);
        }

        query += ' ORDER BY p.score DESC, p.timetaken ASC';

        return await db.all(query, params);
    } catch (error) {
        console.error('Error getting players for slot:', error);
        throw error;
    }
}

// Function to get top players across all slots
async function getTopPlayersAcrossSlots() {
    try {
        await ensureDbInitialized();
        // Get the best score for each player across all slots
        const query = `
            SELECT 
                p1.name,
                p1.email,
                p1.score,
                p1.timetaken,
                p1.displaytime,
                p1.date,
                p1.location,
                p1.slot_id,
                s.name as slot_name
            FROM players p1
            JOIN slots s ON p1.slot_id = s.id
            INNER JOIN (
                SELECT email, MAX(score) as max_score
                FROM players
                GROUP BY email
            ) p2 ON p1.email = p2.email AND p1.score = p2.max_score
            ORDER BY p1.score DESC, p1.timetaken ASC
        `;
        
        return await db.all(query);
    } catch (error) {
        console.error('Error getting top players across slots:', error);
        throw error;
    }
}

// Add player to database
async function addPlayerToDb(playerData) {
    try {
        await ensureDbInitialized();
        // Get the active slot
        const activeSlot = await getActiveSlot();
        if (!activeSlot) {
            throw new Error('No active slot available');
        }
        const slotId = activeSlot.id;
        // Ensure date is present, fallback to now if missing
        let date = playerData.date;
        if (!date) {
            date = new Date().toISOString();
        }
        // Check if a record exists for this email, slot, and location
        const existing = await db.get(
            `SELECT * FROM players WHERE email = ? AND slot_id = ? AND location = ?`,
            [playerData.email, slotId, playerData.location]
        );
        if (existing) {
            // Only update if new score is higher, or same score but less time
            if (
                playerData.score > existing.score ||
                (playerData.score === existing.score && playerData.timetaken < existing.timetaken)
            ) {
                await db.run(
                    `UPDATE players SET name = ?, score = ?, timetaken = ?, displaytime = ?, date = ? WHERE id = ?`,
                    [playerData.name, playerData.score, playerData.timetaken, playerData.displaytime, date, existing.id]
                );
                return 'updated';
            } else {
                // No update needed
                return false;
            }
        } else {
            // Insert new player for current slot
            await db.run(
                `INSERT INTO players (name, email, score, timetaken, displaytime, date, location, slot_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [playerData.name, playerData.email, playerData.score, playerData.timetaken,
                 playerData.displaytime, date, playerData.location, slotId]
            );
            return true;
        }
    } catch (error) {
        console.error('Error in addPlayerToDb:', error);
        throw error;
    }
}

// Get players for a specific location from the database
async function getPlayersForLocation(location, slotId = null) {
    try {
        await ensureDbInitialized();
        let query = `
            SELECT p.*, s.name as slot_name
            FROM players p
            JOIN slots s ON p.slot_id = s.id
            WHERE p.location = ?
        `;
        const params = [location];

        if (slotId) {
            query += ` AND p.slot_id = ?`;
            params.push(slotId);
        } else {
            // If no slot specified, get best scores per player
            query = `
                SELECT p1.*, s.name as slot_name
                FROM players p1
                JOIN slots s ON p1.slot_id = s.id
                INNER JOIN (
                    SELECT email, MAX(score) as max_score
                    FROM players
                    WHERE location = ?
                    GROUP BY email
                ) p2 ON p1.email = p2.email AND p1.score = p2.max_score
                WHERE p1.location = ?
            `;
            params.push(location); // Add location twice for both conditions
        }

        query += ` ORDER BY p1.score DESC, p1.timetaken ASC`;
        
        return await db.all(query, params);
    } catch (error) {
        console.error('Error getting players for location:', error);
        throw error;
    }
}

// Client management functions
function addClient(ws, location) {
    clients.set(ws, location);
    console.log(`Client added with location: ${location}. Total clients: ${clients.size}`);
}

function removeClient(ws) {
    const location = clients.get(ws);
    clients.delete(ws);
    console.log(`Client removed. Was connected to location: ${location}. Remaining clients: ${clients.size}`);
}

function getClientLocation(ws) {
    return clients.get(ws);
}

// POST endpoint to receive Player data
app.post('/api/player', async (req, res) => {
    try {
        const playerData = req.body;
        const result = await addPlayerToDb(playerData);
        
        // Broadcast player update to all clients
        const updateMessage = JSON.stringify({
            type: 'playerUpdate',
            location: playerData.location
        });
        
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(updateMessage);
            }
        });

        // Then broadcast updated rankings
        await broadcastRankings(playerData.location);
        
        res.json({ status: 'success', message: result ? 'Player added' : 'Score updated' });
    } catch (error) {
        console.error('Error in POST /api/player:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// GET endpoint to retrieve current rankings for a location
// GET endpoint to retrieve current rankings for a location
app.get('/api/rankings/:location', async (req, res) => {
    try {
        const { location } = req.params;

        // Get the active slot
        const activeSlot = await getActiveSlot();
        
        // Get players for the active slot if it exists, otherwise get top players across all slots
        const players = activeSlot 
            ? await getPlayersForSlot(activeSlot.id)
            : await getTopPlayersAcrossSlots();

        // Create rankings with position numbers
        const rankings = players
            .filter(player => player.location === location)
            .map((player, index) => ({
                ...player,
                rank: index + 1
            }));
        
        res.json({
            status: 'success',
            location: location,
            rankings: rankings,
            activeSlot: activeSlot
        });
    } catch (error) {
        console.error('Error getting rankings:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get rankings',
            error: error.message
        });
    }
});

// GET endpoint to retrieve all slots
app.get('/api/slots', async (req, res) => {
    try {
        const slots = await getAllSlots();
        res.json({
            status: 'success',
            slots: slots
        });
    } catch (error) {
        console.error('Error getting slots:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get slots',
            error: error.message
        });
    }
});

// GET endpoint to retrieve players for a specific slot
app.get('/api/slots/:slotId/players', async (req, res) => {
    try {
        const { slotId } = req.params;
        const players = await getPlayersForSlot(slotId);
        
        // Add ranking information
        const rankings = players.map((player, index) => ({
            ...player,
            rank: index + 1
        }));
        
        res.json({
            status: 'success',
            slotId: slotId,
            players: rankings
        });
    } catch (error) {
        console.error('Error getting players for slot:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get players for slot',
            error: error.message
        });
    }
});

// GET endpoint to retrieve top players across all slots
app.get('/api/players/top', async (req, res) => {
    try {
        const players = await getTopPlayersAcrossSlots();
        
        // Add ranking information
        const rankings = players.map((player, index) => ({
            ...player,
            rank: index + 1
        }));
        
        res.json({
            status: 'success',
            players: rankings
        });
    } catch (error) {
        console.error('Error getting top players:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get top players',
            error: error.message
        });
    }
});
// Get the last completed slot information
async function getLastCompletedSlot() {
    try {
        const lastSlot = await db.get(`            SELECT 
                name,
                datetime(start_time) as start_time,
                datetime(end_time) as end_time,
                CASE 
                    WHEN (strftime('%s', end_time) - strftime('%s', start_time)) / 3600 >= 1 
                    THEN strftime('%H:%M:%S', julianday(end_time) - julianday(start_time)) 
                    ELSE strftime('%M:%S', julianday(end_time) - julianday(startTime)) 
                END as duration
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

// Cache for last sent top 10 per location
const lastTop10Cache = {}

// Broadcast rankings to all connected clients for a specific location
async function broadcastRankings(location) {
    try {
        const players = await getPlayersForLocation(location, currentSlot?.id);
        const top10 = players.slice(0, 10);
        const prevTop10 = lastTop10Cache[location];
        // Compare top 10: if unchanged, do not broadcast
        let changed = false;
        if (!prevTop10 || prevTop10.length !== top10.length) {
            changed = true;
        } else {
            for (let i = 0; i < top10.length; i++) {
                if (!prevTop10[i] || prevTop10[i].email !== top10[i].email || prevTop10[i].score !== top10[i].score || prevTop10[i].timetaken !== top10[i].timetaken) {
                    changed = true;
                    break;
                }
            }
        }
        if (!changed) {
            // No change in top 10, do not broadcast
            return;
        }
        // Update cache
        lastTop10Cache[location] = top10.map(p => ({ email: p.email, score: p.score, timetaken: p.timetaken }));
        const message = JSON.stringify({
            type: 'rankings',
            location: location,
            players: players
        });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && getClientLocation(client) === location) {
                client.send(message);
            }
        });
    } catch (error) {
        console.error('Error broadcasting rankings:', error);
    }
}
// Broadcast to all WebSocket clients
function broadcastToAll(data) {
    console.log('Broadcasting to all clients:', data);
    
    // If data is not a string, stringify it
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
                console.log('Successfully sent message to client');
            } catch (error) {
                console.error('Error sending message to client:', error);
                // If there's an error, remove the client from our tracking
                removeClient(client);
            }
        }
    });
}

// Broadcast game state change
async function broadcastGameStateChange(status, slotInfo = null) {
    console.log('Broadcasting game state change:', { status, slotInfo });
    // Get last completed slot if game is stopping
    const lastSlot = !status.active ? await getLastCompletedSlot() : null;
    // Get winners if game is stopping
    const winners = !status.active && slotInfo ? await db.all(`
        SELECT name, email, score, displaytime
        FROM players
        WHERE slot_id = ?
        ORDER BY score DESC, timetaken ASC
        LIMIT 3
    `, [slotInfo.id]) : [];
    // Compose a detailed message for inactive session
    let message = status.message;
    if (!status.active && lastSlot) {
        message = `Game session "${lastSlot.name}" is now completed.\nStarted: ${lastSlot.start_time}\nEnded: ${lastSlot.end_time}\nDuration: ${lastSlot.duration}`;
    }
    // Get all slots for slot tab update
    const allSlots = await getAllSlots();
    const gameStatus = {
        type: 'gameStatus',
        status: {
            active: status.active,
            slotName: status.slotName,
            message: message,
            lastSlotInfo: lastSlot,
            winners: winners, // Include winners in the broadcast
            hasSlots: allSlots.length > 0,
            slots: allSlots,
            activeSlotId: status.active ? slotInfo?.id : null
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

// Start the server
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Initialize all services first
        await initializeServer();

        // Start listening
        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

// Start the server with proper error handling
startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received. Closing HTTP server...');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    // Ensure CORS headers are set even in error responses
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', true);
    
    res.status(err.status || 500).json({
        status: 'error',
        message: err.message || 'Internal Server Error'
    });
});
