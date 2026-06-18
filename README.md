# EPAM GenAI Leaderboard

A real-time leaderboard application with WebSocket support, admin panel, and dual database support (SQLite / SQL Server).

## Prerequisites

- Node.js (v16 or later)
- npm

## Installation

```bash
npm install
```

## Running the Application

```bash
npm start
```

The server starts on port `3000` by default (configurable via `PORT` environment variable).

- **Dashboard:** http://localhost:3000/
- **Admin Panel:** http://localhost:3000/admin

## Database Configuration

The application supports two database backends. The selection is automatic based on configuration:

| Condition | Database Used |
|-----------|--------------|
| `SQL_CONNECTION_STRING` is set | SQL Server |
| `SQL_CONNECTION_STRING` is empty/not set | SQLite (default) |

### Option 1: SQLite (Default — No Configuration Needed)

If no SQL Server connection string is provided, the app automatically uses SQLite with a local file `leaderboard.db` in the project root. No setup required.

You can optionally customize the SQLite file path:

```bash
set DB_SQLITE_PATH=C:\path\to\custom.db
npm start
```

### Option 2: SQL Server (Connection String)

Set the `SQL_CONNECTION_STRING` environment variable with your SQL Server connection string:

**Windows (PowerShell):**
```powershell
$env:SQL_CONNECTION_STRING = "Server=myserver.database.windows.net;Database=leaderboard;User Id=admin;Password=yourpassword;Encrypt=true;TrustServerCertificate=true;"
npm start
```

**Windows (CMD):**
```cmd
set SQL_CONNECTION_STRING=Server=myserver.database.windows.net;Database=leaderboard;User Id=admin;Password=yourpassword;Encrypt=true;TrustServerCertificate=true;
npm start
```

**Linux/Mac:**
```bash
export SQL_CONNECTION_STRING="Server=myserver.database.windows.net;Database=leaderboard;User Id=admin;Password=yourpassword;Encrypt=true;TrustServerCertificate=true;"
npm start
```

### Connection String Examples

**Azure SQL Database:**
```
Server=yourserver.database.windows.net;Database=leaderboard;User Id=youradmin;Password=yourpassword;Encrypt=true;TrustServerCertificate=false;
```

**Local SQL Server:**
```
Server=localhost;Database=leaderboard;User Id=sa;Password=yourpassword;TrustServerCertificate=true;
```

**SQL Server with Windows Authentication:**
```
Server=localhost;Database=leaderboard;Trusted_Connection=true;TrustServerCertificate=true;
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `SQL_CONNECTION_STRING` | SQL Server connection string. If set, SQL Server is used. | _(empty — SQLite)_ |
| `DB_SQLITE_PATH` | Custom path for SQLite database file | `./leaderboard.db` |

## Project Structure

```
├── server.js              # Main entry point
├── config/
│   └── db.config.js       # Database configuration
├── services/
│   ├── DatabaseService.js # Database abstraction (SQLite + SQL Server)
│   └── WebSocketService.js# WebSocket handling
├── routes/
│   └── ApiRouter.js       # API endpoints
├── Model/
│   ├── Player.js          # Player model
│   └── Ranker.js          # Ranking logic
└── UI/
    ├── dashboard.html     # Player leaderboard
    ├── admin.html         # Admin panel
    └── ...
```

## How Database Selection Works

The logic is in `config/db.config.js` and `services/DatabaseService.js`:

1. On startup, the app reads `SQL_CONNECTION_STRING` from environment variables
2. If the connection string is **non-empty** → connects to SQL Server using `mssql` package
3. If the connection string is **empty** → uses SQLite with a local file (zero config)

Tables are auto-created on first run for both databases.
