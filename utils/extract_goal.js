import { GoogleGenAI } from '@google/genai';
import { query } from "../backend/db.js";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMMA_API_KEY });
const GEMMA_MODEL = 'gemma-4-26b-a4b-it';

/**
 * Generate goal + summary from chat session using Gemma
 */

export async function generateSessionInsight(sessionId) {
  try {

    // 1. Get chat messages
    const { rows: messages } = await query(`
      SELECT sender, message_text, sent_at
      FROM chat_messages
      WHERE session_id = $1
      ORDER BY sent_at ASC
    `, [sessionId]);

    if (!messages.length) return null;

    // 2. Build chat transcript
    const chatText = messages
      .map(m => `${m.sender}: ${m.message_text}`)
      .join("\n");

    const systemPrompt = `You analyze chat sessions and determine whether the session contains meaningful learning, building, problem-solving, or self-improvement content.

IGNORE:
- casual chatting
- jokes
- random questions
- meaningless short exchanges
- conversations without a clear productive purpose

ONLY extract insights if the session reflects:
- learning
- building projects
- solving technical problems
- studying
- productivity
- career growth
- self-improvement
- meaningful goals

Return ONLY valid JSON.

If the session IS meaningful:

{
  "relevant": true,
  "goal": "VERY short topic/title (2-6 words max)",
  "summary": "1-2 sentence summary of what the user worked on"
}

IMPORTANT:
- goal must NEVER be a sentence
- NEVER start with "The user..."
- goal should look like a project/topic title
- Examples of GOOD goals:
  - "JWT Authentication"
  - "DBSCAN Clustering"
  - "Vector Memory System"
  - "Express API Debugging"

If the session is NOT meaningful, return ONLY:

{
  "relevant": false
}`;

    // 3. Ask Gemma to analyze session relevance + extract insight
    const response = await genAI.models.generateContent({
      model: GEMMA_MODEL,
      contents: `Analyze this chat session:\n\n${chatText}`,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
        maxOutputTokens: 200,
      }
    });

    const raw = response.text;

    // 4. Parse JSON response
    let result;
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (parseError) {
      console.error("Invalid JSON from Gemma:", raw);
      return null;
    }

    // 5. Ignore irrelevant/silly sessions
    if (!result.relevant) {
      console.log(`Session ${sessionId} skipped (irrelevant)`);
      return null;
    }

    // 6. Extra safety cleanup
    if (!result.goal || !result.summary) {
      console.log(`Session ${sessionId} missing goal/summary`);
      return null;
    }

    // Prevent giant accidental titles
    result.goal = result.goal.trim().substring(0, 60);

    // Remove annoying prefixes if AI slips
    result.goal = result.goal
      .replace(/^The user\s+/i, '')
      .replace(/^User\s+/i, '')
      .trim();

    return result;

  } catch (err) {
    console.error("generateSessionInsight failed:", err.message);
    return null;
  }
}