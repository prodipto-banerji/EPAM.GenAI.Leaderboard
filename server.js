// server.js - Main server file that initializes all components
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const Ranker = require('./Model/Ranker');
const DatabaseService = require('./services/DatabaseService');
const WebSocketService = require('./services/WebSocketService');
const ApiRouter = require('./routes/ApiRouter');

// Constants for paths
const DB_PATH = path.join(__dirname, 'leaderboard.db');
const UI_PATH = path.join(__dirname, 'UI');

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
const ranker = new Ranker();
const webSocketService = new WebSocketService(server, databaseService, ranker);
const apiRouter = new ApiRouter(databaseService, webSocketService);

// Set up routes
app.use('/api', apiRouter.getRouter());
app.use(express.static(UI_PATH));
app.get('/', (req, res) => {
    res.sendFile(path.join(UI_PATH, 'dashboard.html'));
});

// Start the server
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await databaseService.initialize();
        console.log('Database initialized successfully');
        
        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received. Closing HTTP server...');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

startServer();
