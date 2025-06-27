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
                const activeSlot = await this.databaseService.getActiveSlot();
                const slots = await this.databaseService.getAllSlots();
                await this.webSocketService.broadcastGameState({
                    active: !!activeSlot,
                    slotName: activeSlot?.name,
                    message: activeSlot ? 
                        `Game Session "${activeSlot.name}" is inactive!` : 
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
                const { slotName } = req.body;
                if (!slotName) {
                    return res.status(400).json({ status: 'error', message: 'Slot name is required' });
                }
                const slot = await this.webSocketService.startSlot(slotName);
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
                const { email } = req.body;
                
                if (!email) {
                    return res.status(400).json({ 
                        status: 'error', 
                        message: 'Email is required' 
                    });
                }

                const result = await this.databaseService.checkEmailInActiveSlot(email);
                
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
    }

    getRouter() {
        return this.router;
    }
}

module.exports = ApiRouter;
