// this is run once, to create the database tables 
// for MALAK. It can be re-run without issue, 
// as it uses "IF NOT EXISTS" in the SQL commands.

import { query, connectDB } from './db.js';

async function setup() {
    console.log('Setting up MALAK database...\n');

    await connectDB();

    try {
        // Users table
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                user_id    SERIAL PRIMARY KEY,
                username   VARCHAR(100) NOT NULL,
                email      VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('users table created');

        // Chat sessions table
        await query(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id    SERIAL PRIMARY KEY,
                user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                session_title VARCHAR(200) DEFAULT 'New Conversation',
                main_goal     TEXT,
                created_at    TIMESTAMP DEFAULT NOW(),
                chat_summary TEXT
            )
        `);
        console.log('chat_sessions table created');

        // Chat messages table
        await query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                message_id   SERIAL PRIMARY KEY,
                session_id   INTEGER NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
                sender       VARCHAR(10) NOT NULL CHECK (sender IN ('User', 'malak')),
                message_text TEXT NOT NULL,
                sent_at      TIMESTAMP DEFAULT NOW()
            )
        `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
            ON chat_messages(session_id)
            `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
            ON chat_sessions(user_id)
            `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at
            ON chat_sessions(created_at)
            `);
        console.log('chat_messages table created with index for faster lookups');

        console.log('\nDatabase setup complete! You can now run: npm start');
        process.exit(0);

    } catch (err) {
        console.error('Setup failed:', err.message);
        process.exit(1);
    }
}

setup();