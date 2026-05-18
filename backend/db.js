import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

// Single connection pool reused across the whole app
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Required for cloud providers
    ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false, sslmode: 'require' }
});

pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message);
});

setInterval(async () => {
    try {
        await pool.query('SELECT 1');
    } catch (e) {
        console.warn('DB keep-alive failed:', e.message, e.code);
    }
}, 4 * 60 * 1000); // ping every 4 minutes

export async function connectDB() {
    try {
        const client = await pool.connect();
        console.log('PostgreSQL connected');
        client.release();
    } catch (err) {
        console.error('PostgreSQL connection failed:', err.message);
        console.error('Check DATABASE_URL in your .env file');
    }
}

// Simple query helper — use this everywhere instead of pool.query directly
export async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) console.warn(`Slow query (${duration}ms):`, text);
    return res;
}

export default pool;