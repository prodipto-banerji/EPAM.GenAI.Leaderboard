// Ranker.js - Handles the ranking logic for players based on score and time
const Player = require('./Player');

class Ranker {
    constructor() {
        // Initialize players from localStorage if available, otherwise empty array
        this.players = this._loadFromStorage() || [];
    }

    /**
     * Load players data from localStorage
     * @private
     * @returns {Array} Array of player objects
     */
    _loadFromStorage() {
        try {
            const storedPlayers = localStorage.getItem('leaderboardPlayers');
            if (storedPlayers) {
                // Parse stored data and reconstruct Player objects
                return JSON.parse(storedPlayers).map(playerData => {
                    return new Player(
                        playerData.name,
                        playerData.email,
                        playerData.score,
                        playerData.timetaken,
                        playerData.displaytime,
                        new Date(playerData.date),
                        playerData.location
                    );
                });
            }
        } catch (error) {
            console.error('Error loading players from storage:', error);
        }
        return null;
    }

    /**
     * Save players data to localStorage
     * @private
     */
    _saveToStorage() {
        try {
            localStorage.setItem('leaderboardPlayers', JSON.stringify(this.players));
        } catch (error) {
            console.error('Error saving players to storage:', error);
        }
    }

    /**
     * Add a player or array of players to be ranked
     * @param {Player|Player[]} players - Single player or array of players to add
     */    addPlayers(players) {
        if (Array.isArray(players)) {
            this.players = this.players.concat(players);
        } else {
            this.players.push(players);
        }
        this._saveToStorage();
    }

    /**
     * Clear all players from the ranker
     */
    clearPlayers() {
        this.players = [];
        this._saveToStorage();
    }

    /**
     * Remove a player by email
     * @param {string} email - Email of the player to remove
     * @returns {boolean} True if player was removed, false if not found
     */
    removePlayer(email) {
        const initialLength = this.players.length;
        this.players = this.players.filter(player => player.email !== email);
        const wasRemoved = this.players.length < initialLength;
        if (wasRemoved) {
            this._saveToStorage();
        }
        return wasRemoved;
    }

    /**
     * Get ranked players based on score (primary) and time taken (secondary)
     * Higher score and lower time is better
     * @returns {Array} Array of players with rank property added
     */
    getRankedPlayers() {
        // Sort players by score (descending) and time (ascending)
        const sortedPlayers = [...this.players].sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score; // Higher score is better
            }
            return a.timetaken - b.timetaken; // Lower time is better
        });

        // Add rank to each player
        return sortedPlayers.map((player, index) => ({
            ...player,
            rank: index + 1
        }));
    }

    /**
     * Get top N ranked players
     * @param {number} n - Number of top players to return
     * @returns {Array} Array of top N ranked players
     */
    getTopPlayers(n) {
        const rankedPlayers = this.getRankedPlayers();
        return rankedPlayers.slice(0, n);
    }

    /**
     * Get player rank by email
     * @param {string} email - Email of the player to find
     * @returns {Object|null} Player with rank or null if not found
     */
    getPlayerRank(email) {
        const rankedPlayers = this.getRankedPlayers();
        return rankedPlayers.find(player => player.email === email) || null;
    }
}

module.exports = Ranker;
