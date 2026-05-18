import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI } from '@google/genai';
const genAI = new GoogleGenAI({ apiKey: process.env.GEMMA_API_KEY });
const CLASSIFIER_MODEL = 'gemma-4-26b-a4b-it';
const EMBEDDING_MODEL  = 'gemini-embedding-001'; // Google embedding — no local files, works on Render

// -- CLASSIFICATION CACHE --
const classifyCache = new Map();
const CACHE_MAX = 500;

// -- HARDCODED PATTERNS --
const CASUAL_PATTERNS   = /^\s*(hi|hello|hey|hii|helo|sup|yo|howdy|greetings|good morning|good evening|good night|good afternoon|thanks|thank you|thx|ty|ok|okay|k|lol|haha|hehe|bye|goodbye|see you|cya|np|no problem|cool|nice|great|awesome|got it|sure|yep|nope|yes|no|maybe)\s*[!?.]*\s*$/i;
const IDENTITY_PATTERNS = /\b(i am|i'm|my name is|i work as|i'm a|i am a|i study|i'm studying|i live in|i'm from|i'm based in|i'm currently)\b/i;
const LEARNING_PATTERNS = /\b(teach me|explain|how (do|does|can|to)|learn|understand|what is|what are|difference between|help me (with|understand)|i want to learn|i need to learn|how it works|show me|walk me through|guide me|roadmap|course|resource|study|practice|stuck on|struggling with|can you help)\b/i;

export async function classifyMemory(text) {
    if (classifyCache.has(text)) return classifyCache.get(text);

    const cache = (val) => {
        if (classifyCache.size >= CACHE_MAX) classifyCache.delete(classifyCache.keys().next().value);
        classifyCache.set(text, val);
        return val;
    };

    const t = text.trim();

    if (CASUAL_PATTERNS.test(t))   return cache('casual');
    if (LEARNING_PATTERNS.test(t)) return cache('learning');
    if (IDENTITY_PATTERNS.test(t)) return cache('identity');

    try {
        const response = await genAI.models.generateContent({
            model: CLASSIFIER_MODEL,
            contents: t,
            config: {
                systemInstruction: `Classify into ONE word only: learning | identity | casual`,
                temperature: 0,
                maxOutputTokens: 5,
            }
        });
        return cache(response.text.trim().toLowerCase().replace(/[^a-z]/g, ''));
    } catch (err) {
        console.warn('Classifier failed:', err.message);
        return cache('casual');
    }
}

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_HOST    = process.env.PINECONE_HOST;

// -- 1. GENERATE EMBEDDING via Google API (no local files needed, works on Render) --
export async function generateEmbedding(text) {
    try {
        const response = await genAI.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text,
            config: { outputDimensionality: 768 }
        });

        const vector = response?.embeddings?.[0]?.values;

        if (!vector || vector.length === 0) {
            console.warn('Empty embedding returned');
            return null;
        }

        return vector;
    } catch (err) {
        console.error('Embedding failed:', err.message);
        return null;
    }
}

async function pineconeRequest(path, method = 'GET', body = null) {
    if (!PINECONE_API_KEY || !PINECONE_HOST) return null;

    const res = await fetch(`${PINECONE_HOST}${path}`, {
        method,
        headers: {
            'Api-Key': PINECONE_API_KEY,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Pinecone ${method} ${path} → ${res.status}: ${err}`);
    }
    return res.json();
}

// -- 2. STORE A MESSAGE --
export async function storeMemory({ userId, sessionId, messageId, text, sender, type }) {
    if (!PINECONE_API_KEY) return;
    try {
        const vector = await generateEmbedding(text);
        if (!vector || vector.length === 0) {
            console.warn('Skipping Pinecone upsert due to bad vector');
            return;
        }

        await pineconeRequest('/vectors/upsert', 'POST', {
            vectors: [{
                id: `msg-${messageId}`,
                values: vector,
                metadata: {
                    userId:    String(userId),
                    sessionId: String(sessionId),
                    sender,
                    type,
                    text:      text.substring(0, 500),
                    timestamp: new Date().toISOString()
                }
            }],
            namespace: `user-${userId}`
        });

        console.log(`storeMemory() succeeded: msg-${messageId} [${sender}]`);
    } catch (err) {
        console.warn('storeMemory() failed (non-fatal):', err.message);
    }
}

// -- 3. QUERY RELEVANT PAST CONTEXT --
export async function queryMemory({ userId, currentMessage, topK = 8, mode = 'chat' }) {
    if (!PINECONE_API_KEY) return [];
    try {
        const vector = await generateEmbedding(currentMessage);
        if (!vector) return [];

        const result = await pineconeRequest('/query', 'POST', {
            vector,
            topK,
            includeMetadata: true,
            namespace: `user-${userId}`,
            filter: { userId: { $eq: String(userId) } }
        });

        const matches = (result?.matches || [])
            .filter(m => {
                if (m.score <= 0.7) return false;
                if (mode === 'email') return m.metadata.type === 'learning';
                return m.metadata.type === 'learning' || m.metadata.type === 'identity';
            })
            .map(m => ({
                text:      m.metadata.text,
                sender:    m.metadata.sender,
                timestamp: m.metadata.timestamp,
                type:      m.metadata.type,
                score:     m.score
            }));

        console.log(`queryMemory: ${matches.length} matches above 0.7 threshold`);
        return matches;
    } catch (err) {
        console.warn('queryMemory() failed (non-fatal):', err.message);
        return [];
    }
}

// -- 4. FORMAT CONTEXT BLOCK FOR AI PROMPT --
export function buildContextBlock(memories) {
    if (!memories?.length) return '';
    const lines = memories.map(m => {
        const who  = m.sender === 'User' ? 'User said' : 'MALAK replied';
        const when = new Date(m.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `• [${when}] ${who}: "${m.text}"`;
    });
    return `[RELEVANT PAST CONTEXT - only reference this if it is directly relevant to the current message]\n${lines.join('\n')}\n[END CONTEXT]`;
}

// -- 5. GET USER MEMORY SUMMARY (for daily emails) --
export async function getUserMemorySummary(userId, topK = 10) {
    if (!PINECONE_API_KEY) return [];
    try {
        return await queryMemory({
            userId,
            currentMessage: 'learning goals progress skills achievements challenges struggles',
            topK,
            mode: 'email'
        });
    } catch (err) {
        console.warn('getUserMemorySummary failed:', err.message);
        return [];
    }
}
