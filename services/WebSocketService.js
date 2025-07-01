// WebSocketService.js - Handles WebSocket connections and broadcasting
const WebSocket = require('ws');

class WebSocketService {
    constructor(server, databaseService, ranker) {
        this.clients = new Map();
        this.databaseService = databaseService;
        this.ranker = ranker;
        this.initialize(server);
    }

    initialize(server) {
        this.wss = new WebSocket.Server({ 
            server,
            verifyClient: () => true // Allow all connections, CORS handled at HTTP level
        });

        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        this.wss.on('connection', (ws) => {
            console.log('New client connected');
            
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    switch (data.type) {
                        case 'setLocation':
                            this.addClient(ws, data.location);
                            console.log(`Client set location to: ${data.location}`);
                            
                            // Get slot information
                            const slots = await this.databaseService.getAllSlots();
                            const activeSlot = await this.databaseService.getActiveSlot();
                            
                            // Send initial data to client - this will show leaderboard if there's data
                            await this.broadcastRankings(data.location);
                            
                            // Determine game status based on slots and data
                            let gameStatus;
                            if (slots.length === 0) {
                                // No slots exist yet
                                gameStatus = {
                                    active: false,
                                    slotName: null,
                                    message: 'Waiting for game session to start...',
                                    slots: slots,
                                    activeSlotId: null,
                                    hasSlots: false
                                };
                            } else if (activeSlot) {
                                // Active slot exists
                                gameStatus = {
                                    active: true,
                                    slotName: activeSlot.name,
                                    message: `Game Session "${activeSlot.name}" is active!`,
                                    slots: slots,
                                    activeSlotId: activeSlot.id,
                                    hasSlots: true
                                };
                            } else {
                                // No active slot, but slots exist (game has ended)
                                const lastSlot = await this.databaseService.getLastCompletedSlot();
                                gameStatus = {
                                    active: false, 
                                    slotName: lastSlot?.name,
                                    message: 'Game session has ended',
                                    slots: slots,
                                    activeSlotId: null,
                                    hasSlots: true,
                                    lastSlotInfo: lastSlot
                                };
                            }
                            
                            await this.broadcastGameState(gameStatus);
                            break;
                        case 'getRankings':
                            if (data.slotId) {
                                const players = await this.databaseService.getPlayersForSlot(data.slotId, data.location);
                                this.sendToClient(ws, JSON.stringify({
                                    type: 'rankings',
                                    location: data.location,
                                    players: players
                                }));
                            } else {
                                await this.broadcastRankings(data.location);
                            }
                            break;
                    }
                } catch (error) {
                    console.error('Error processing WebSocket message:', error);
                }
            });

            ws.on('close', () => {
                console.log('Client disconnected');
                this.removeClient(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.removeClient(ws);
            });
        });
    }

    // Client management methods
    addClient(ws, location) {
        this.clients.set(ws, location);
        console.log(`Client added with location: ${location}. Total clients: ${this.clients.size}`);
    }

    removeClient(ws) {
        const location = this.clients.get(ws);
        this.clients.delete(ws);
        console.log(`Client removed. Was connected to location: ${location}. Remaining clients: ${this.clients.size}`);
    }

    getClientLocation(ws) {
        return this.clients.get(ws);
    }

    // Broadcast methods
    broadcast(message) {
        console.log('Broadcasting message:', typeof message === 'string' ? message : JSON.stringify(message));
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                this.sendToClient(client, message);
            }
        });
    }

    broadcastToLocation(message, location) {
        console.log(`Broadcasting to location ${location}:`, typeof message === 'string' ? message : JSON.stringify(message));
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && this.getClientLocation(client) === location) {
                this.sendToClient(client, message);
            }
        });
    }

    sendToClient(ws, message) {
        try {
            const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
            ws.send(messageStr);
        } catch (error) {
            console.error('Error sending message to client:', error);
        }
    }

    async broadcastRankings(location) {
        try {
            const activeSlot = await this.databaseService.getActiveSlot();
            let players = [];
            let slotId = null;
            
            if (activeSlot) {
                // Active slot exists - get players from active slot
                players = await this.databaseService.getPlayersForLocation(location, activeSlot.id);
                slotId = activeSlot.id;
            } else {
                // No active slot - get players from the last completed slot
                const lastCompletedSlot = await this.databaseService.getLastCompletedSlot();
                if (lastCompletedSlot) {
                    players = await this.databaseService.getPlayersForLocation(location, lastCompletedSlot.id);
                    slotId = lastCompletedSlot.id;
                }
            }
            
            const message = {
                type: 'rankings',
                location: location,
                players: players,
                slotId: slotId
            };
            this.broadcastToLocation(JSON.stringify(message), location);
        } catch (error) {
            console.error('Error broadcasting rankings:', error);
        }
    }

    async startSlot(slotName) {
        try {
            const newSlot = await this.databaseService.startSlot(slotName);
            await this.broadcastGameState({
                active: true,
                slotName: newSlot.name,
                message: `Game Session "${newSlot.name}" has started!`,
                slots: await this.databaseService.getAllSlots(),
                activeSlotId: newSlot.id,
                hasSlots: true
            });
            return newSlot;
        } catch (error) {
            console.error('Error starting slot:', error);
            throw error;
        }
    }

    async stopSlot(slotId) {
        try {
            const stoppedSlot = await this.databaseService.stopSlot(slotId);
            const lastSlot = await this.databaseService.getLastCompletedSlot();
            
            await this.broadcastGameState({
                active: false,
                slotName: stoppedSlot.name,
                message: 'Game session has ended',
                slots: await this.databaseService.getAllSlots(),
                activeSlotId: null,
                lastSlotInfo: lastSlot,
                hasSlots: true
            });
            return stoppedSlot;
        } catch (error) {
            console.error('Error stopping slot:', error);
            throw error;
        }
    }

    async broadcastGameState(status) {
        const message = {
            type: 'gameStatus',
            status: {
                hasSlots: status.slots && status.slots.length > 0, // Check if slots actually exist
                ...status
            }
        };

        this.broadcast(JSON.stringify(message));
    }
}

module.exports = WebSocketService;
