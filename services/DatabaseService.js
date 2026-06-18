// DatabaseService.js - Handles all database operations
// Supports both SQLite (default) and SQL Server (when configured)

const path = require('path');

class DatabaseService {
    constructor(config) {
        this.config = config;
        this.useMssql = !!(config.connectionString);
        this.db = null;
        this.pool = null;
    }

    async initialize() {
        try {
            if (this.useMssql) {
                await this._initMssql();
            } else {
                await this._initSqlite();
            }
            await this.createTables();
            console.log(`Database initialized using ${this.useMssql ? 'SQL Server' : 'SQLite'}`);
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error;
        }
    }

    async _initSqlite() {
        const sqlite3 = require('sqlite3');
        const { open } = require('sqlite');

        const dbPath = this.config.sqlite.filename ||
            path.join(__dirname, '..', 'leaderboard.db');

        this.db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
        await this.db.exec(`PRAGMA journal_mode = WAL`);
        await this.db.exec(`PRAGMA busy_timeout = 5000`);
        await this.db.exec(`PRAGMA synchronous = NORMAL`);
    }

    async _initMssql() {
        const sql = require('mssql');
        this.pool = await sql.connect(this.config.connectionString);
    }

    // --- Query abstraction ---

    async _run(query, params = []) {
        if (this.useMssql) {
            const request = this.pool.request();
            params.forEach((val, i) => {
                request.input(`p${i}`, val);
            });
            const parameterized = this._convertPlaceholders(query);
            const result = await request.query(parameterized);
            return { lastID: result.recordset && result.recordset[0] ? result.recordset[0].id : null, changes: result.rowsAffected ? result.rowsAffected[0] : 0 };
        } else {
            return await this.db.run(query, params);
        }
    }

    async _get(query, params = []) {
        if (this.useMssql) {
            const request = this.pool.request();
            params.forEach((val, i) => {
                request.input(`p${i}`, val);
            });
            const parameterized = this._convertPlaceholders(query);
            const result = await request.query(parameterized);
            return (result.recordset && result.recordset[0]) || null;
        } else {
            return await this.db.get(query, params);
        }
    }

    async _all(query, params = []) {
        if (this.useMssql) {
            const request = this.pool.request();
            params.forEach((val, i) => {
                request.input(`p${i}`, val);
            });
            const parameterized = this._convertPlaceholders(query);
            const result = await request.query(parameterized);
            return result.recordset || [];
        } else {
            return await this.db.all(query, params);
        }
    }

    async _exec(query) {
        if (this.useMssql) {
            await this.pool.request().query(query);
        } else {
            await this.db.exec(query);
        }
    }

    // Convert ? placeholders to @p0, @p1, etc. for mssql
    _convertPlaceholders(query) {
        let index = 0;
        return query.replace(/\?/g, () => `@p${index++}`);
    }

    // --- Table creation ---

    async createTables() {
        try {
            if (this.useMssql) {
                await this._createTablesMssql();
            } else {
                await this._createTablesSqlite();
            }
        } catch (error) {
            console.error('Error creating tables:', error);
            throw error;
        }
    }

    async _createTablesSqlite() {
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                location TEXT,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        try {
            await this.db.exec(`ALTER TABLE slots ADD COLUMN location TEXT`);
        } catch (e) { /* Column already exists */ }

        try {
            await this.db.exec(`ALTER TABLE slots ADD COLUMN level TEXT DEFAULT 'simple'`);
        } catch (e) { /* Column already exists */ }

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
    }

    async _createTablesMssql() {
        await this._exec(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='slots' AND xtype='U')
            CREATE TABLE slots (
                id INT IDENTITY(1,1) PRIMARY KEY,
                name NVARCHAR(255) NOT NULL,
                status NVARCHAR(50) NOT NULL,
                location NVARCHAR(255),
                level NVARCHAR(50) DEFAULT 'simple',
                start_time DATETIME,
                end_time DATETIME,
                created_at DATETIME DEFAULT GETDATE()
            )
        `);

        await this._exec(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('slots') AND name = 'location')
            ALTER TABLE slots ADD location NVARCHAR(255)
        `);

        await this._exec(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('slots') AND name = 'level')
            ALTER TABLE slots ADD level NVARCHAR(50) DEFAULT 'simple'
        `);

        await this._exec(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='players' AND xtype='U')
            CREATE TABLE players (
                id INT IDENTITY(1,1) PRIMARY KEY,
                name NVARCHAR(255) NOT NULL,
                email NVARCHAR(255) NOT NULL,
                score INT NOT NULL,
                timetaken INT NOT NULL,
                displaytime NVARCHAR(50) NOT NULL,
                date DATETIME NOT NULL,
                location NVARCHAR(255) NOT NULL,
                slot_id INT NOT NULL,
                FOREIGN KEY (slot_id) REFERENCES slots(id)
            )
        `);
    }

    // --- Business methods ---

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
        return await this._all(query, params);
    }

    async getPlayersForLocation(location, slotId = null) {
        try {
            if (slotId) {
                return await this.getPlayersForSlot(slotId, location);
            }

            const query = 'SELECT p1.*, s.name as slot_name ' +
                        'FROM players p1 ' +
                        'JOIN slots s ON p1.slot_id = s.id ' +
                        'INNER JOIN (SELECT email, MAX(score) as max_score ' +
                        '           FROM players WHERE location = ? ' +
                        '           GROUP BY email) p2 ' +
                        'ON p1.email = p2.email AND p1.score = p2.max_score ' +
                        'WHERE p1.location = ? ' +
                        'ORDER BY p1.score DESC, p1.timetaken ASC';

            return await this._all(query, [location, location]);
        } catch (error) {
            console.error('Error getting players for location:', error);
            throw error;
        }
    }

    async addPlayer(playerData) {
        try {
            const activeSlot = await this.getActiveSlot(playerData.location);
            if (!activeSlot) {
                throw new Error('No active slot available for this location');
            }

            await this._run(
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
            let query;
            if (this.useMssql) {
                query = 'SELECT id, name, status, ' +
                        'CONVERT(VARCHAR, start_time, 120) as start_time, ' +
                        'CONVERT(VARCHAR, end_time, 120) as end_time, ' +
                        'CASE ' +
                        '    WHEN DATEDIFF(SECOND, start_time, ISNULL(end_time, GETDATE())) >= 3600 ' +
                        '    THEN CONVERT(VARCHAR(8), DATEADD(SECOND, DATEDIFF(SECOND, start_time, ISNULL(end_time, GETDATE())), 0), 108) ' +
                        '    ELSE RIGHT(CONVERT(VARCHAR(8), DATEADD(SECOND, DATEDIFF(SECOND, start_time, ISNULL(end_time, GETDATE())), 0), 108), 5) ' +
                        'END as duration ' +
                        'FROM slots ORDER BY start_time DESC';
            } else {
                query = 'SELECT id, name, status, ' +
                        'datetime(start_time) as start_time, ' +
                        'datetime(end_time) as end_time, ' +
                        'CASE ' +
                        '    WHEN (strftime("%s", COALESCE(end_time, datetime("now"))) - strftime("%s", start_time)) / 3600 >= 1 ' +
                        '    THEN strftime("%H:%M:%S", julianday(COALESCE(end_time, datetime("now"))) - julianday(start_time)) ' +
                        '    ELSE strftime("%M:%S", julianday(COALESCE(end_time, datetime("now"))) - julianday(start_time)) ' +
                        'END as duration ' +
                        'FROM slots ORDER BY start_time DESC';
            }
            return await this._all(query);
        } catch (error) {
            console.error('Error getting all slots:', error);
            throw error;
        }
    }

    async startSlot(slotName, location = null, level = 'simple') {
        try {
            const activeSlot = await this.getActiveSlot(location);
            if (activeSlot) {
                throw new Error('Another slot is already active for this location');
            }

            let result;
            if (this.useMssql) {
                const request = this.pool.request();
                request.input('name', slotName);
                request.input('status', 'active');
                request.input('location', location);
                request.input('level', level);
                const res = await request.query(
                    'INSERT INTO slots (name, status, location, level, start_time) ' +
                    'OUTPUT INSERTED.id ' +
                    'VALUES (@name, @status, @location, @level, GETDATE())'
                );
                result = { lastID: res.recordset[0].id };
            } else {
                result = await this.db.run(
                    'INSERT INTO slots (name, status, location, level, start_time) VALUES (?, ?, ?, ?, datetime("now"))',
                    [slotName, 'active', location, level]
                );
            }

            return {
                id: result.lastID,
                name: slotName,
                status: 'active',
                location: location,
                level: level,
                start_time: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error starting slot:', error);
            throw error;
        }
    }

    async getSlotsForLocation(location) {
        try {
            let query;
            if (this.useMssql) {
                query = 'SELECT id, name, status, location, level, ' +
                        'CONVERT(VARCHAR, start_time, 120) as start_time, ' +
                        'CONVERT(VARCHAR, end_time, 120) as end_time, ' +
                        'CASE ' +
                        '    WHEN DATEDIFF(SECOND, start_time, ISNULL(end_time, GETDATE())) >= 3600 ' +
                        '    THEN CONVERT(VARCHAR(8), DATEADD(SECOND, DATEDIFF(SECOND, start_time, ISNULL(end_time, GETDATE())), 0), 108) ' +
                        '    ELSE RIGHT(CONVERT(VARCHAR(8), DATEADD(SECOND, DATEDIFF(SECOND, start_time, ISNULL(end_time, GETDATE())), 0), 108), 5) ' +
                        'END as duration ' +
                        'FROM slots WHERE location = ? ORDER BY start_time DESC';
            } else {
                query = 'SELECT id, name, status, location, level, ' +
                        'datetime(start_time) as start_time, ' +
                        'datetime(end_time) as end_time, ' +
                        'CASE ' +
                        '    WHEN (strftime("%s", COALESCE(end_time, datetime("now"))) - strftime("%s", start_time)) / 3600 >= 1 ' +
                        '    THEN strftime("%H:%M:%S", julianday(COALESCE(end_time, datetime("now"))) - julianday(start_time)) ' +
                        '    ELSE strftime("%M:%S", julianday(COALESCE(end_time, datetime("now"))) - julianday(start_time)) ' +
                        'END as duration ' +
                        'FROM slots WHERE location = ? ORDER BY start_time DESC';
            }
            return await this._all(query, [location]);
        } catch (error) {
            console.error('Error getting slots for location:', error);
            throw error;
        }
    }

    async stopSlot(slotId) {
        try {
            const slot = await this._get('SELECT * FROM slots WHERE id = ?', [slotId]);
            if (!slot) {
                throw new Error('Slot not found');
            }

            if (slot.status !== 'active') {
                throw new Error('Slot is not active');
            }

            if (this.useMssql) {
                await this._run(
                    'UPDATE slots SET status = ?, end_time = GETDATE() WHERE id = ?',
                    ['completed', slotId]
                );
            } else {
                await this._run(
                    'UPDATE slots SET status = ?, end_time = datetime("now") WHERE id = ?',
                    ['completed', slotId]
                );
            }

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

    async getActiveSlot(location = null) {
        try {
            if (this.useMssql) {
                if (location) {
                    return await this._get(
                        `SELECT TOP 1 id, name, status, location, level,
                        CONVERT(VARCHAR, start_time, 120) as start_time,
                        CONVERT(VARCHAR, end_time, 120) as end_time
                        FROM slots 
                        WHERE status = 'active' AND location = ?
                        ORDER BY start_time DESC`,
                        [location]
                    );
                }
                return await this._get(
                    `SELECT TOP 1 id, name, status, location, level,
                    CONVERT(VARCHAR, start_time, 120) as start_time,
                    CONVERT(VARCHAR, end_time, 120) as end_time
                    FROM slots 
                    WHERE status = 'active' 
                    ORDER BY start_time DESC`
                );
            } else {
                if (location) {
                    return await this._get(
                        `SELECT id, name, status, location, level,
                        datetime(start_time) as start_time,
                        datetime(end_time) as end_time
                        FROM slots 
                        WHERE status = 'active' AND location = ?
                        ORDER BY start_time DESC 
                        LIMIT 1`,
                        [location]
                    );
                }
                return await this._get(
                    `SELECT id, name, status, location, level,
                    datetime(start_time) as start_time,
                    datetime(end_time) as end_time
                    FROM slots 
                    WHERE status = 'active' 
                    ORDER BY start_time DESC 
                    LIMIT 1`
                );
            }
        } catch (error) {
            console.error('Error getting active slot:', error);
            throw error;
        }
    }

    async getLastCompletedSlot() {
        try {
            let query;
            if (this.useMssql) {
                query = `SELECT TOP 1 id, name, status,
                    CONVERT(VARCHAR, start_time, 120) as startTime,
                    CONVERT(VARCHAR, end_time, 120) as endTime,
                    CASE 
                        WHEN DATEDIFF(SECOND, start_time, end_time) >= 3600 
                        THEN CONVERT(VARCHAR(8), DATEADD(SECOND, DATEDIFF(SECOND, start_time, end_time), 0), 108)
                        ELSE RIGHT(CONVERT(VARCHAR(8), DATEADD(SECOND, DATEDIFF(SECOND, start_time, end_time), 0), 108), 5)
                    END as duration
                    FROM slots 
                    WHERE status = 'completed' 
                    ORDER BY end_time DESC`;
            } else {
                query = `SELECT id, name, status,
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
                    LIMIT 1`;
            }

            return await this._get(query);
        } catch (error) {
            console.error('Error getting last completed slot:', error);
            throw error;
        }
    }

    async addOrUpdatePlayer(playerData) {
        try {
            let activeSlot = await this.getActiveSlot(playerData.location);

            // Grace period: if no active slot, check if a slot was closed within last 5 minutes
            if (!activeSlot) {
                let graceQuery;
                if (this.useMssql) {
                    graceQuery = `SELECT TOP 1 id, name, status, location, level,
                        CONVERT(VARCHAR, start_time, 120) as start_time,
                        CONVERT(VARCHAR, end_time, 120) as end_time
                        FROM slots 
                        WHERE status = 'completed' AND location = ?
                        AND end_time >= DATEADD(MINUTE, -5, GETDATE())
                        ORDER BY end_time DESC`;
                } else {
                    graceQuery = `SELECT id, name, status, location, level,
                        datetime(start_time) as start_time,
                        datetime(end_time) as end_time
                        FROM slots 
                        WHERE status = 'completed' AND location = ?
                        AND end_time >= datetime('now', '-5 minutes')
                        ORDER BY end_time DESC 
                        LIMIT 1`;
                }

                const graceSlot = await this._get(graceQuery, [playerData.location]);
                if (graceSlot) {
                    console.log(`Using grace period: accepting score for recently closed slot "${graceSlot.name}" (id: ${graceSlot.id})`);
                    activeSlot = graceSlot;
                } else {
                    throw new Error('No active slot available for this location');
                }
            }

            const formattedDate = new Date().toISOString();

            if (!playerData.name || !playerData.email || typeof playerData.score !== 'number' ||
                !playerData.timetaken || !playerData.displaytime || !playerData.location) {
                throw new Error('Missing required player data');
            }

            const existingPlayer = await this._get(
                'SELECT * FROM players WHERE email = ? AND slot_id = ?',
                [playerData.email, activeSlot.id]
            );

            if (existingPlayer) {
                if (playerData.score > existingPlayer.score ||
                    (playerData.score === existingPlayer.score &&
                     playerData.timetaken < existingPlayer.timetaken)) {

                    await this._run(
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

            await this._run(
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

    async checkEmailInActiveSlot(email, location = null) {
        try {
            const activeSlot = await this.getActiveSlot(location);

            if (!activeSlot) {
                return { hasPlayed: false, message: 'No active slot found' };
            }

            const player = await this._get(
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
