// Database Configuration
// If SQL_CONNECTION_STRING env variable is set, SQL Server will be used.
// Otherwise, SQLite will be used as the default.

module.exports = {
    // SQL Server connection string (set this to use SQL Server)
    // Example: "Server=myserver.database.windows.net;Database=leaderboard;User Id=admin;Password=secret;Encrypt=true;TrustServerCertificate=true;"
    connectionString: '',

    // SQLite configuration (used when connectionString is empty)
    sqlite: {
        filename: process.env.DB_SQLITE_PATH || null // defaults to leaderboard.db in project root
    }
};
