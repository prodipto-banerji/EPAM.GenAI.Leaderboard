// ApiRouter.js - Handles all HTTP API routes
const express = require('express');
const path = require('path');

class ApiRouter {
    constructor(databaseService, webSocketService) {
        this.databaseService = databaseService;
        this.webSocketService = webSocketService;
        this.router = express.Router();
        this.setupRoutes();
    }

    setupRoutes() {
        // Serve documentation page
        this.router.get('/documentation', (req, res) => {
            res.sendFile(path.join(__dirname, '../UI/documentation.html'));
        });

        // Admin login
        this.router.post('/auth/login', (req, res) => {
            const { email, password } = req.body;
            const credentials = {
                'hyderabad@admin.com': { password: 'admin', location: 'Hyderabad' },
                'pune@admin.com': { password: 'admin', location: 'Pune' },
                'chennai@admin.com': { password: 'admin', location: 'Chennai' },
                'gurgaon@admin.com': { password: 'admin', location: 'Gurgaon' },
                'bangalore@admin.com': { password: 'admin', location: 'Bangalore' },
                'coimbatore@admin.com': { password: 'admin', location: 'Coimbatore' }
            };

            const user = credentials[email];
            if (!user || user.password !== password) {
                return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
            }

            res.json({ status: 'success', location: user.location });
        });

        // Get slots for a specific location
        this.router.get('/slots/location/:location', async (req, res) => {
            try {
                const slots = await this.databaseService.getSlotsForLocation(req.params.location);
                res.json(slots);
            } catch (error) {
                console.error('Error in GET /slots/location/:location:', error);
                res.status(500).json({ status: 'error', message: error.message });
            }
        });

        // Get active slot for a specific location
        this.router.get('/slots/active/:location', async (req, res) => {
            try {
                const activeSlot = await this.databaseService.getActiveSlot(req.params.location);
                if (!activeSlot) {
                    return res.json({ status: 'success', active: false, slot: null });
                }
                res.json({ status: 'success', active: true, slot: activeSlot });
            } catch (error) {
                console.error('Error in GET /slots/active/:location:', error);
                res.status(500).json({ status: 'error', message: error.message });
            }
        });

        // Add or update player
        this.router.post('/player', async (req, res) => {
            try {
                const result = await this.databaseService.addOrUpdatePlayer(req.body);
                
                // First, broadcast a player update event
                await this.webSocketService.broadcast(JSON.stringify({
                    type: 'playerUpdate',
                    location: req.body.location
                }));

                // Then broadcast updated rankings
                await this.webSocketService.broadcastRankings(req.body.location);

                // Also broadcast updated game state to refresh slot data
                const activeSlot = await this.databaseService.getActiveSlot(req.body.location);
                const slots = await this.databaseService.getSlotsForLocation(req.body.location);
                await this.webSocketService.broadcastGameState({
                    active: !!activeSlot,
                    slotName: activeSlot?.name,
                    message: activeSlot ? 
                        `Game Session "${activeSlot.name}" is active!` : 
                        'Waiting for game session to start...',
                    slots: slots,
                    activeSlotId: activeSlot?.id
                });

                res.json({ 
                    status: 'success', 
                    message: result.message,
                    updated: result.updated
                });
            } catch (error) {
                console.error('Error in POST /player:', error);
                res.status(500).json({ 
                    status: 'error', 
                    message: 'Failed to add player',
                    error: error.message 
                });
            }
        });

        // Get slots
        this.router.get('/slots', async (req, res) => {
            try {
                const slots = await this.databaseService.getAllSlots();
                res.json(slots);
            } catch (error) {
                console.error('Error in GET /slots:', error);
                res.status(500).json({ status: 'error', message: error.message });
            }
        });

        // Start new slot
        this.router.post('/slots/start', async (req, res) => {
            try {
                const { slotName, location, level } = req.body;
                if (!slotName) {
                    return res.status(400).json({ status: 'error', message: 'Slot name is required' });
                }
                const slot = await this.webSocketService.startSlot(slotName, location || null, level || 'simple');
                res.json({ status: 'success', data: slot });
            } catch (error) {
                console.error('Error in POST /slots/start:', error);
                res.status(500).json({ status: 'error', message: error.message });
            }
        });

        // Stop slot
        this.router.post('/slots/:slotId/stop', async (req, res) => {
            try {
                const { slotId } = req.params;
                const slot = await this.webSocketService.stopSlot(slotId);
                res.json({ status: 'success', data: slot });
            } catch (error) {
                console.error('Error in POST /slots/stop:', error);
                res.status(500).json({ status: 'error', message: error.message });
            }
        });

        // Get players for slot
        this.router.get('/slots/:slotId/players', async (req, res) => {
            try {
                const { slotId } = req.params;
                const { location } = req.query;
                const players = await this.databaseService.getPlayersForSlot(slotId, location);
                res.json(players);
            } catch (error) {
                console.error('Error in GET /slots/:slotId/players:', error);
                res.status(500).json({ status: 'error', message: error.message });
            }
        });

        // Get rankings for location
        this.router.get('/rankings/:location', async (req, res) => {
            try {
                const players = await this.databaseService.getPlayersForLocation(req.params.location);
                res.json(players);
            } catch (error) {
                console.error('Error in GET /rankings/:location:', error);
                res.status(500).json({ status: 'error', message: error.message });
            }
        });

        // Check if email has already played in active slot
        this.router.post('/check-email', async (req, res) => {
            try {
                const { email, location } = req.body;
                
                if (!email) {
                    return res.status(400).json({ 
                        status: 'error', 
                        message: 'Email is required' 
                    });
                }

                const result = await this.databaseService.checkEmailInActiveSlot(email, location);
                
                res.json({ 
                    status: 'success',
                    hasPlayed: result.hasPlayed,
                    message: result.message,
                    activeSlot: result.activeSlot,
                    playerData: result.playerData
                });
            } catch (error) {
                console.error('Error in POST /check-email:', error);
                res.status(500).json({ 
                    status: 'error', 
                    message: 'Failed to check email',
                    error: error.message 
                });
            }
        });

        // SSE endpoint for scalable dashboard streaming (no WebSocket needed)
        // Supports 500+ concurrent viewers efficiently via HTTP
        this.router.get('/stream/:location', (req, res) => {
            const location = req.params.location;
            
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no' // Disable nginx buffering
            });

            // Send initial heartbeat
            res.write(': connected\n\n');

            // Register this SSE client
            this.webSocketService.addSSEClient(res, location);

            // Keepalive every 20 seconds to prevent proxy timeouts
            const keepalive = setInterval(() => {
                res.write(': keepalive\n\n');
            }, 20000);

            // Send initial game status immediately
            this.databaseService.getSlotsForLocation(location).then(async (slots) => {
                const activeSlot = await this.databaseService.getActiveSlot(location);
                const lastSlotId = !activeSlot && slots.length > 0 ? slots[0].id : null;
                const data = {
                    type: 'gameStatus',
                    status: {
                        active: !!activeSlot,
                        slotName: activeSlot?.name,
                        message: activeSlot ? 
                            `Game Session "${activeSlot.name}" is active!` : 
                            'Waiting for game session to start...',
                        slots: slots,
                        activeSlotId: activeSlot?.id || lastSlotId,
                        hasSlots: slots.length > 0
                    }
                };
                res.write(`event: gameStatus\ndata: ${JSON.stringify(data)}\n\n`);

                // Also send current rankings
                const slotId = activeSlot?.id || lastSlotId;
                if (slotId) {
                    const players = await this.databaseService.getPlayersForSlot(slotId, location);
                    res.write(`event: rankings\ndata: ${JSON.stringify({ type: 'rankings', location, players, slotId })}\n\n`);
                }
            }).catch(err => console.error('SSE initial data error:', err));

            // Cleanup on disconnect
            req.on('close', () => {
                clearInterval(keepalive);
                this.webSocketService.removeSSEClient(res);
            });
        });
    }

    getRouter() {
        return this.router;
    }
}

module.exports = ApiRouter;
