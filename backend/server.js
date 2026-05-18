import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, query } from './db.js';
import { sendWelcomeEmail } from '../utils/email_sender.js';
import { storeMemory, queryMemory, buildContextBlock } from '../utils/vector_memory.js';
import { generateSessionInsight } from '../utils/extract_goal.js';
import { classifyMemory } from '../utils/vector_memory.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'public')));

connectDB().catch(err => {
    console.error("DB connection failed:", err.message);
});

if (!process.env.GEMMA_API_KEY) {
    console.error('FATAL: GEMMA_API_KEY missing');
    process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMMA_API_KEY });
const GEMMA_MODEL = 'gemma-4-26b-a4b-it';

const SYSTEM_PROMPT = `You are MALAK, an AI Mentor created by Malak M. Salem — a data science student at Cairo University who is deeply curious about technology and self-development. She built MALAK to be the kind of mentor she wished existed while learning: intelligent, practical, and genuinely helpful.

MEMORY RULES (CRITICAL - follow these exactly):
- When you receive a [RELEVANT PAST CONTEXT] block, that information is real — it happened. Treat it as factual history about this user.
- If the user DIRECTLY asks what they've been struggling with, working on, or learning — answer SPECIFICALLY from the context block. Do not hedge, do not say "we haven't discussed this yet", do not say "I can't tell yet." You have the information — use it.
- If the user asks about their interests, preferences, or history and the context block contains relevant information — reference it directly and confidently.
- NEVER say "we haven't defined this yet" or "I can't tell yet" when the context block contains relevant information. That is a hallucination of ignorance.
- NEVER volunteer past struggles or topics in greetings or when the user is clearly starting a new unrelated topic.
- If the user says "hi" or asks something unrelated, do not open with a memory dump.
- Memory is silent enrichment for general responses — but a direct, confident source of truth when the user asks about their own history.


Intent Handling Rules:
Detect the user's intent before choosing a response format:
Learning intent: If the user asks how to learn or master a topic (e.g., "teach me X," "how do I learn X," "guide me on X"), provide:
– A clear learning roadmap
– 2–3 high-quality resources
– End with a prompt asking where they want to start
Explanation intent: If the user asks for an explanation (e.g., "explain X," "what is X," "can you explain"), respond directly, conversationally, with examples.
– Do NOT give a roadmap or resources unless explicitly requested.
Follow-up intent: If the user drills deeper into a topic (e.g., "let's start with Y," "tell me more about X"), assume they want you to teach step by step, using analogies and examples.
– Do NOT provide external links or resource lists.
If intent is unclear, default to a direct explanation rather than listing resources.

Rules for Explanations:
Always use analogies and step-by-step walkthroughs.
After explaining, include one check-your-understanding question to engage the user.
Never provide a roadmap or resource list when the user explicitly wants an explanation.
Keep responses concise, intelligent, and mentor-like, using bold for key terms when needed.

Tone & Style:
Warm, sharp, practical, and respectful of the user's time.
Interactive: respond directly and ask one thoughtful follow-up question when it naturally improves the conversation.
When teaching, make it clear, structured, and example-driven.

RESPONSE RULES:
- Answer directly. Never start with filler like "Great question!" or "Of course!".
- Keep responses concise, natural, and intelligent.
- Ask ONE thoughtful follow-up question when it naturally improves the conversation.
- Responses should feel mentor-like and interactive.
- When teaching something, provide:
  1. A clear roadmap
  2. 2-3 high-quality resources (books, courses, docs, or videos)
- Use **bold** for key terms. Use numbered lists for steps.
- Tone: warm, sharp, practical, and respectful of the user's time.
- Use clean Markdown formatting with line breaks between sections.

IDENTITY:
- You are MALAK. If asked who created you, answer naturally and briefly — never like a corporate product description.`;

const userCooldowns = new Map();

// -- AI RESPONSE CACHE --
const responseCache = new Map();
const RESPONSE_CACHE_MAX = 200;
 
function getCachedResponse(message) {
    return responseCache.get(message.trim().toLowerCase()) || null;
}
 
function setCachedResponse(message, reply) {
    if (responseCache.size >= RESPONSE_CACHE_MAX)
        responseCache.delete(responseCache.keys().next().value);
    responseCache.set(message.trim().toLowerCase(), reply);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ error: 'All fields are required.' });
        if (password.length < 6 || !/\d/.test(password) || !/[a-zA-Z]/.test(password))
            return res.status(400).json({ error: 'Password must be at least 6 characters and include both letters and numbers.' });

        const existing = await query('SELECT user_id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0)
            return res.status(409).json({ error: 'Email already registered.' });

        const passwordHash = await bcrypt.hash(password, 10);
        await query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)',
            [username, email, passwordHash]
        );

        sendWelcomeEmail(email, username).catch(e =>
            console.warn('Welcome email failed:', e.message)
        );

        res.json({ message: 'Registered successfully! You can now log in.' });
    } catch (err) {
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Registration failed.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password are required.' });

        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash)))
            return res.status(401).json({ error: 'Invalid email or password.' });

        const token = jwt.sign(
            { id: user.user_id, name: user.username },
            process.env.JWT_SECRET || 'MALAK_SECRET',
            { expiresIn: '7d' }
        );

        res.json({ token, username: user.username, userId: user.user_id });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Login failed.' });
    }
});

// Guest login — no DB, no email, ephemeral session
app.post('/api/guest', async (req, res) => {
    try {
        const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const token = jwt.sign(
            { id: guestId, name: 'Guest', isGuest: true },
            process.env.JWT_SECRET || 'MALAK_SECRET',
            { expiresIn: '24h' }
        );

        // Create a temporary session row so chat works normally
        const result = await query(
            `INSERT INTO users (username, email, password_hash)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING
             RETURNING user_id`,
            [guestId, `${guestId}@guest.malak`, 'GUEST_NO_PASSWORD']
        );

        let userId;
        if (result.rows.length > 0) {
            userId = result.rows[0].user_id;
        } else {
            const existing = await query('SELECT user_id FROM users WHERE email = $1', [`${guestId}@guest.malak`]);
            userId = existing.rows[0]?.user_id;
        }

        res.json({ token, username: 'Guest', userId, isGuest: true });
    } catch (err) {
        console.error('Guest login error:', err.message);
        res.status(500).json({ error: 'Guest session failed.' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHAT SESSIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/chat/start', async (req, res) => {
    const { userId } = req.body;
    try {
        const result = await query(
            'INSERT INTO chat_sessions (user_id) VALUES ($1) RETURNING session_id',
            [userId]
        );
        res.json({ sessionId: result.rows[0].session_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chat/history/:userId', async (req, res) => {
    try {
        const result = await query(`
            SELECT
                cs.session_id,
                cs.session_title,
                cs.main_goal,
                cm.message_id,
                cm.message_text,
                cm.sender,
                cm.sent_at
            FROM chat_sessions cs
            LEFT JOIN chat_messages cm ON cm.session_id = cs.session_id
            WHERE cs.user_id = $1
            AND cs.created_at > NOW() - INTERVAL '90 days'
            ORDER BY cs.session_id DESC, cm.sent_at ASC
            LIMIT 500
        `, [req.params.userId]);

        res.json(result.rows);
    } catch (err) {
        console.error('History error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEND MESSAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/chat/message', async (req, res) => {
    const now = Date.now();
    const { sessionId, userId, message } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    const memoryType = await classifyMemory(message);

    const lastRequest = userCooldowns.get(userId) || 0;
    if (now - lastRequest < 3000) {
        return res.status(429).json({ error: 'Cooling down. Try again in a few seconds.' });
    }
    userCooldowns.set(userId, now);

    console.log(`[${new Date().toISOString()}] User ${userId}: "${message.substring(0, 60)}"`);

    try {
        const shouldInjectMemory = memoryType !== 'casual' && userId && process.env.PINECONE_API_KEY;

        // FIX 1: Run save user message + Pinecone query in parallel instead of sequentially
        const [userMsgResult, memories] = await Promise.all([
            query(
                'INSERT INTO chat_messages (session_id, sender, message_text) VALUES ($1, $2, $3) RETURNING message_id',
                [sessionId, 'User', message]
            ),
            shouldInjectMemory
                ? queryMemory({ userId, currentMessage: message, topK: 5 })
                : Promise.resolve([])
        ]);

        const userMessageId = userMsgResult.rows[0].message_id;

        // Store user message in Pinecone (non-blocking)
        storeMemory({ userId, sessionId,
            messageId: userMessageId, text: message, sender: 'User',
            type: memoryType })
            .catch(e => console.warn('storeMemory() failed:', e.message));

        // Build context block from parallel-fetched memories
        let contextBlock = '';
        if (shouldInjectMemory && memories.length > 0) {
            contextBlock = buildContextBlock(memories);
            if (contextBlock) {
                console.log(`🧠 Injecting ${memories.length} memories into prompt`);
            } else {
                console.log(`🧠 No memories above threshold for this message`);
            }
        } else {
            console.log(`🧠 Skipping memory injection (type: ${memoryType})`);
        }

        // Build enriched prompt
        const enrichedPrompt = contextBlock
            ? `${contextBlock}\n\n[CURRENT MESSAGE]\n${message}`
            : message;

        // Call Gemma — use cache for repeated/similar queries
        // Only use cache if no memory context was injected — personalized responses must never be cached
        let aiText = (!contextBlock) ? getCachedResponse(message) : null;
        if (aiText) {
            console.log('⚡ Cache hit — skipping Gemma call');
        } else {
            try {
                const response = await genAI.models.generateContent({
                    model: GEMMA_MODEL,
                    contents: enrichedPrompt,
                    config: {
                        systemInstruction: SYSTEM_PROMPT,
                        temperature: 0.4,
                        maxOutputTokens: 1024,
                    }
                });
                aiText = response.text;
                console.log('Gemma replied');
                // Only cache non-personalized responses (casual/learning without injected memory)
                if (!contextBlock) setCachedResponse(message, aiText);
            } catch (aiError) {
                console.warn('Gemma error:', aiError.message);
                aiText = "I couldn't generate a response right now — try again in a moment.";
            }
        }

        // Save AI reply
        const aiMsgResult = await query(
            'INSERT INTO chat_messages (session_id, sender, message_text) VALUES ($1, $2, $3) RETURNING message_id',
            [sessionId, 'malak', aiText]
        );
        const aiMessageId = aiMsgResult.rows[0].message_id;

        // Store AI reply in Pinecone (non-blocking)
        storeMemory({ userId, sessionId, messageId: `ai-${aiMessageId}`, text: aiText, sender: 'malak', type: 'casual' })
            .catch(e => console.warn('storeMemory() AI failed:', e.message));

        // FIX 2: Send response FIRST, then do background work after — user never waits for these
        res.json({ reply: aiText });

        // Background: title + insight run fully after response is sent
        const { rows: msgCount } = await query(
            'SELECT COUNT(*) FROM chat_messages WHERE session_id = $1', [sessionId]
        );
        if (parseInt(msgCount[0].count) <= 2) {
            generateSessionTitle(sessionId, message);
        }
        updateSessionInsight(sessionId);

    } catch (err) {
        console.error('Chat error:', err.message);
        res.status(500).json({ error: 'Something went wrong.', details: err.message });
    }
});

// Generate a smart session title from the first message — runs once, never again
async function generateSessionTitle(sessionId, firstMessage) {
    try {
        const response = await genAI.models.generateContent({
            model: GEMMA_MODEL,
            contents: firstMessage,
            config: {
                systemInstruction: `Generate a short, smart session title (2-5 words) based on the user's message.
- If it's a greeting (hi, hello, hey...) → return: Greeting
- If it's a learning question → return the topic, e.g. "Computer Science Roadmap", "JWT Authentication"
- If it's personal info → return: Personal Introduction
- Otherwise → return a clean short title describing what the user wants
Return ONLY the title. No punctuation. No quotes.`,
                temperature: 0.2,
                maxOutputTokens: 20,
            }
        });
 
        const title = response.text.trim().substring(0, 60);
        await query(
            'UPDATE chat_sessions SET session_title = $1 WHERE session_id = $2',
            [title, sessionId]
        );
        console.log(`Session ${sessionId} titled → "${title}"`);
    } catch (e) {
        console.warn('generateSessionTitle failed:', e.message);
    }
}

async function updateSessionInsight(sessionId) {
    try {
        const insight = await generateSessionInsight(sessionId);
        if (!insight) return;

        await query(
            'UPDATE chat_sessions SET session_title = $1, main_goal = $2 WHERE session_id = $3',
            [insight.goal, insight.summary, sessionId]
        );
        console.log(`Session ${sessionId} updated → goal: "${insight.goal}"`);
    } catch (e) {
        console.log('updateSessionInsight skipped:', e.message);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HEALTH CHECK + SELF-PING (prevents Render free tier spin-down)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/health', (req, res) => res.json({ status: 'alive', ts: Date.now() }));

const SELF_URL = process.env.RENDER_URL;
if (SELF_URL) {
    setInterval(async () => {
        try {
            await fetch(`${SELF_URL}/health`);
            console.log('🏓 Self-ping OK');
        } catch (e) {
            console.warn('Self-ping failed:', e.message);
        }
    }, 4 * 60 * 1000); // every 4 minutes
    console.log(`🏓 Self-ping active → ${SELF_URL}/health`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START DAILY MOTIVATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import './daily_motivator.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
    console.log(`\n🚀 MALAK Server → http://localhost:${PORT}`);
    console.log(`🤖 Chat model  → Gemma / ${GEMMA_MODEL}`);
    console.log(`🧠 Vector DB   → ${process.env.PINECONE_API_KEY ? 'Pinecone ENABLED ✅' : 'Pinecone DISABLED'}`);
    console.log(`📧 Email       → ${process.env.EMAIL_USER || 'not configured'}\n`);
});
