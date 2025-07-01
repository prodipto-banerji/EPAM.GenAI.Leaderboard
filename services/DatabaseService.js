// DatabaseService.js - Handles all database operations
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

class DatabaseService {    constructor(dbPath) {
        this.dbPath = dbPath;
    }

    async initialize() {
        try {
            this.db = await open({
                filename: this.dbPath,
                driver: sqlite3.Database
            });
            await this.createTables();
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error;
        }
    }

    async createTables() {
        try {
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS slots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            await this.db.exec(`
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

    async getPlayersForSlot(slotId, location = null) {
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

        return await this.db.all(query, params);
    }

    async getPlayersForLocation(location, slotId = null) {
        try {
            if (slotId) {
                return await this.getPlayersForSlot(slotId, location);
            }

            // If no slot specified, get best scores per player
            const query = 'SELECT p1.*, s.name as slot_name ' +
                         'FROM players p1 ' +
                         'JOIN slots s ON p1.slot_id = s.id ' +
                         'INNER JOIN (SELECT email, MAX(score) as max_score ' +
                         '           FROM players WHERE location = ? ' +
                         '           GROUP BY email) p2 ' +
                         'ON p1.email = p2.email AND p1.score = p2.max_score ' +
                         'WHERE p1.location = ? ' +
                         'ORDER BY p1.score DESC, p1.timetaken ASC';

            return await this.db.all(query, [location, location]);
        } catch (error) {
            console.error('Error getting players for location:', error);
            throw error;
        }
    }

    async addPlayer(playerData) {
        try {
            const activeSlot = await this.getActiveSlot();
            if (!activeSlot) {
                throw new Error('No active slot available');
            }

            await this.db.run(
                'INSERT INTO players (name, email, score, timetaken, displaytime, date, location, slot_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [playerData.name, playerData.email, playerData.score, playerData.timetaken,
                 playerData.displaytime, playerData.date, playerData.location, activeSlot.id]
            );

            return true;
        } catch (error) {
            console.error('Error adding player:', error);
            throw error;
        }
    }

    async getAllSlots() {
        try {
            return await this.db.all(
                'SELECT id, name, status, ' +
                'datetime(start_time) as start_time, ' +
                'datetime(end_time) as end_time, ' +
                'CASE ' +
                '    WHEN (strftime("%s", COALESCE(end_time, datetime("now"))) - strftime("%s", start_time)) / 3600 >= 1 ' +
                '    THEN strftime("%H:%M:%S", julianday(COALESCE(end_time, datetime("now"))) - julianday(start_time)) ' +
                '    ELSE strftime("%M:%S", julianday(COALESCE(end_time, datetime("now"))) - julianday(start_time)) ' +
                'END as duration ' +
                'FROM slots ORDER BY start_time DESC'
            );
        } catch (error) {
            console.error('Error getting all slots:', error);
            throw error;
        }
    }

    // Slot management methods
    async startSlot(slotName) {
        try {
            // Check if there's already an active slot
            const activeSlot = await this.getActiveSlot();
            if (activeSlot) {
                throw new Error('Another slot is already active');
            }

            // Create new slot
            const result = await this.db.run(
                'INSERT INTO slots (name, status, start_time) VALUES (?, ?, datetime("now"))',
                [slotName, 'active']
            );

            return {
                id: result.lastID,
                name: slotName,
                status: 'active',
                start_time: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error starting slot:', error);
            throw error;
        }
    }

    async stopSlot(slotId) {
        try {
            const slot = await this.db.get('SELECT * FROM slots WHERE id = ?', [slotId]);
            if (!slot) {
                throw new Error('Slot not found');
            }

            if (slot.status !== 'active') {
                throw new Error('Slot is not active');
            }

            await this.db.run(
                'UPDATE slots SET status = ?, end_time = datetime("now") WHERE id = ?',
                ['completed', slotId]
            );

            return {
                ...slot,
                status: 'completed',
                end_time: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error stopping slot:', error);
            throw error;
        }
    }

    async getActiveSlot() {
        try {
            return await this.db.get(
                `SELECT id, name, status, 
                datetime(start_time) as start_time,
                datetime(end_time) as end_time
                FROM slots 
                WHERE status = 'active' 
                ORDER BY start_time DESC 
                LIMIT 1`
            );
        } catch (error) {
            console.error('Error getting active slot:', error);
            throw error;
        }
    }

    async getLastCompletedSlot() {
        try {
            const slot = await this.db.get(
                `SELECT id, name, status,
                datetime(start_time) as startTime,
                datetime(end_time) as endTime,
                CASE 
                    WHEN (strftime('%s', end_time) - strftime('%s', start_time)) / 3600 >= 1 
                    THEN strftime('%H:%M:%S', julianday(end_time) - julianday(start_time)) 
                    ELSE strftime('%M:%S', julianday(end_time) - julianday(start_time)) 
                END as duration
                FROM slots 
                WHERE status = 'completed' 
                ORDER BY end_time DESC 
                LIMIT 1`
            );

            return slot;
        } catch (error) {
            console.error('Error getting last completed slot:', error);
            throw error;
        }
    }    async addOrUpdatePlayer(playerData) {
        try {
            // Get the active slot
            const activeSlot = await this.getActiveSlot();
            if (!activeSlot) {
                throw new Error('No active slot available');
            }            // Always use current timestamp for the date
            const formattedDate = new Date().toISOString();

            // Validate required fields
            if (!playerData.name || !playerData.email || typeof playerData.score !== 'number' || 
                !playerData.timetaken || !playerData.displaytime || !playerData.location) {
                throw new Error('Missing required player data');
            }

            // Check if player exists in current slot
            const existingPlayer = await this.db.get(
                'SELECT * FROM players WHERE email = ? AND slot_id = ?',
                [playerData.email, activeSlot.id]
            );

            if (existingPlayer) {
                // Only update if new score is better
                if (playerData.score > existingPlayer.score || 
                    (playerData.score === existingPlayer.score && 
                     playerData.timetaken < existingPlayer.timetaken)) {
                    
                    await this.db.run(
                        `UPDATE players 
                         SET score = ?, timetaken = ?, displaytime = ?, date = ?
                         WHERE email = ? AND slot_id = ?`,
                        [playerData.score, playerData.timetaken, playerData.displaytime,
                         formattedDate, playerData.email, activeSlot.id]
                    );
                    return { updated: true, message: 'Score updated' };
                }
                return { updated: false, message: 'Existing score is better' };
            }

            // Insert new player
            await this.db.run(
                `INSERT INTO players (name, email, score, timetaken, displaytime, date, location, slot_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [playerData.name, playerData.email, playerData.score, playerData.timetaken,
                 playerData.displaytime, formattedDate, playerData.location, activeSlot.id]
            );

            return { updated: true, message: 'Player added' };
        } catch (error) {
            console.error('Error in addOrUpdatePlayer:', error);
            throw error;
        }
    }

    async checkEmailInActiveSlot(email) {
        try {
            const activeSlot = await this.getActiveSlot();
            
            if (!activeSlot) {
                return { hasPlayed: false, message: 'No active slot found' };
            }

            const player = await this.db.get(
                `SELECT id, name, email, score, timetaken, displaytime 
                 FROM players 
                 WHERE email = ? AND slot_id = ?`,
                [email, activeSlot.id]
            );

            return {
                hasPlayed: !!player,
                activeSlot: activeSlot,
                playerData: player || null,
                message: player ? 
                    `Email ${email} has already played in slot "${activeSlot.name}"` : 
                    `Email ${email} has not played in slot "${activeSlot.name}" yet`
            };
        } catch (error) {
            console.error('Error in checkEmailInActiveSlot:', error);
            throw error;
        }
    }
}

module.exports = DatabaseService;
