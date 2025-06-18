// Ranker.js - Handles the ranking logic for players based on score and time
const Player = require('./Player');

class Ranker {
    constructor() {
        // We don't need to store players anymore, as they're stored in SQLite
        this.players = [];
    }

    /**
     * Sort and rank a list of players
     * @param {Array} players - Array of player objects to rank
     * @returns {Array} Array of players with rank property added
     */
    rankPlayers(players) {
        // Sort by score (descending) and time (ascending)
        const sortedPlayers = [...players].sort((a, b) => {
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
