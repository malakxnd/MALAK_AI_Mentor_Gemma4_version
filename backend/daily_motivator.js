import cron from 'node-cron';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';
import { query, connectDB } from './db.js';
import { getUserMemorySummary } from '../utils/vector_memory.js';

dotenv.config();

const genAI = new GoogleGenAI({ apiKey: process.env.GEMMA_API_KEY });
const GEMMA_MODEL = 'gemma-4-26b-a4b-it';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendDailyEmails() {
    console.log('\n🌞 Starting daily motivation emails...');

    try {

        // Fetch up to 7 recent sessions per user that have a goal
        const { rows } = await query(`
            SELECT
                u.user_id,
                u.username,
                u.email,
                cs.main_goal,
                cs.session_title,
                cs.chat_summary,
                cs.created_at
            FROM users u
            JOIN (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY user_id
                        ORDER BY created_at DESC
                    ) AS rn
                FROM chat_sessions
                WHERE main_goal IS NOT NULL
            ) cs ON cs.user_id = u.user_id
            WHERE cs.rn <= 7
            AND u.email NOT LIKE '%@guest.malak'
            ORDER BY u.user_id, cs.created_at DESC
        `);

        // Group rows by user
        const userMap = new Map();
        for (const row of rows) {
            if (!userMap.has(row.user_id)) {
                userMap.set(row.user_id, {
                    user_id:  row.user_id,
                    username: row.username,
                    email:    row.email,
                    sessions: []
                });
            }
            userMap.get(row.user_id).sessions.push({
                main_goal:    row.main_goal,
                session_title: row.session_title,
                chat_summary: row.chat_summary,
                created_at:   row.created_at
            });
        }

        console.log(`Found ${userMap.size} users to motivate.`);

        for (const user of userMap.values()) {
            console.log(`\nProcessing: ${user.username} (${user.sessions.length} sessions)`);

            const sessionHistory = user.sessions
                .map((s, i) => {
                    const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return `Session ${i + 1} (${date}): "${s.session_title}" — Goal: ${s.main_goal}${s.chat_summary ? `\n  Summary: ${s.chat_summary}` : ''}`;
                })
                .join('\n\n');

            // Pull Pinecone memories for richer context
            let memoryContext = '';
            try {
                const memories = await getUserMemorySummary(user.user_id, 8);
                if (memories.length > 0) {
                    const lines = memories
                        .filter(m => m.sender === 'User')
                        .slice(0, 5)
                        .map(m => `• "${m.text.substring(0, 120)}"`)
                        .join('\n');
                    memoryContext = `\nRecent things this user has been saying:\n${lines}`;
                    console.log(`  🧠 Using ${memories.length} memories`);
                }
            } catch (e) {
                console.warn('Memory fetch failed:', e.message);
            }

            let emailBody = '';

            try {
                const emailPrompt = `Write a motivational email for ${user.username}.

Here are their last ${user.sessions.length} learning sessions:

${sessionHistory}
${memoryContext}

Requirements:
- Acknowledge the RANGE of topics they've been working on — not just one session
- Identify any recurring theme or overarching goal across their sessions if one exists
- Give ONE concrete action they can do TODAY (5-15 min) that ties into their overall journey
- 4-5 sentences total
- Sign off as: <p>— <strong>MALAK, your AI Mentor</strong></p>
- Use only <p> and <strong> HTML tags`;

                const response = await genAI.models.generateContent({
                    model: GEMMA_MODEL,
                    contents: emailPrompt,
                    config: {
                        systemInstruction: `You write short motivational emails for learners.
Output ONLY the email body HTML. No subject line. No preamble. 
No sign-off after the closing tag. Just the HTML.

- ONLY use memories classified as "learning".
- Ignore: jokes, casual talk, emotional venting, unrelated conversations

FOCUS ONLY ON:
- goals
- skills
- learning progress
- struggles related to learning
- achievements
If no learning memory exists:
- write a general motivational message without referencing memory.`,
                        temperature: 0.4,
                        maxOutputTokens: 350,
                    }
                });

                emailBody = response.text;
                console.log(`  AI email generated`);

            } catch (aiError) {
                console.warn(`  AI failed, using fallback:`, aiError.message);
                const goalList = user.sessions.map(s => s.main_goal).join(', ');
                emailBody = `
                    <p>Hi <strong>${user.username}</strong>,</p>
                    <p>You've been working across several areas lately: <strong>${goalList}</strong>.</p>
                    <p>Today, pick whichever one feels most alive right now and give it 15 focused minutes.</p>
                    <p>Momentum is built one session at a time.</p>
                    <p>— <strong>MALAK, your AI Mentor</strong></p>
                `;
            }

            try {
                await transporter.sendMail({
                    from: `"MALAK AI Mentor" <${process.env.EMAIL_USER}>`,
                    to: user.email,
                    subject: `🌅 Your Daily MALAK Boost`,
                    html: `
                        <div style="font-family:'Segoe UI',sans-serif;background:#050510;color:#fff;padding:48px;max-width:600px;margin:auto;border-radius:20px;border:1px solid rgba(0,243,255,0.15);">
                            <div style="border-bottom:1px solid rgba(0,243,255,0.15);padding-bottom:20px;margin-bottom:28px;">
                                <h1 style="color:#00f3ff;font-weight:300;letter-spacing:5px;margin:0;font-size:1.5rem;">MALAK</h1>
                                <p style="color:#444;margin:4px 0 0;font-size:0.75rem;letter-spacing:2px;">YOUR AI MENTOR · DAILY BOOST</p>
                            </div>
                            ${emailBody}
                            <div style="margin-top:36px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.05);color:#333;font-size:0.75rem;">
                                You receive this because you're on a learning journey with MALAK.
                            </div>
                        </div>
                    `
                });
                console.log(`  ✅ Sent to ${user.email}`);
            } catch (mailError) {
                console.error(`  Mail failed for ${user.email}:`, mailError.message);
            }

            await new Promise(r => setTimeout(r, 2000));
        }

        console.log('\n✅ Daily motivation job complete.');
    } catch (err) {
        console.error('Scheduler error:', err.message);
    }
}

cron.schedule('0 8 * * *', async () => {
    console.log(`[${new Date().toISOString()}] 🌞 Cron triggered`);
    
    const timeout = setTimeout(() => {
        console.error('❌ Daily motivator timed out after 5 min — forcing continue');
    }, 5 * 60 * 1000);

    try {
        await sendDailyEmails();
        console.log(`[${new Date().toISOString()}] ✅ Emails sent`);
    } catch (err) {
        console.error('❌ Cron job crashed:', err.message);
    } finally {
        clearTimeout(timeout);
    }
}, { timezone: 'Africa/Cairo' });

console.log('⏳ Daily Motivator active — fires at 8:00 AM.');

// Uncomment to test immediately:
// sendDailyEmails();