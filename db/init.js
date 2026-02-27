// db/init.js
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const initDB = async () => {
    try {
        // Read the schema file
        const schemaSQL = fs.readFileSync(
            path.join(__dirname, 'schema.sql'),
            'utf8'
        );
        
        // Execute the SQL
        await pool.query(schemaSQL);
        console.log('✅ Database schema initialized successfully');
    } catch (err) {
        console.error('❌ Error initializing database:', err);
    } finally {
        await pool.end();
    }
};

// Run if this file is executed directly
if (require.main === module) {
    initDB();
}

module.exports = initDB;