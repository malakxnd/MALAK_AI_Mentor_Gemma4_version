<div align="center">

<br/>

<img src="./assets/banner.svg" width="100%" alt="MALAK — animated cinematic banner" />

<br/>

### `M.A.L.A.K — Mentor for Adaptive Learning & Knowledge`

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://neon.tech)
[![Pinecone](https://img.shields.io/badge/Pinecone-Vector_Memory-00C17C?style=for-the-badge)](https://pinecone.io)
[![Gemma](https://img.shields.io/badge/Gemma_4-26B-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://deepmind.google/technologies/gemma/)
[![License](https://img.shields.io/badge/License-MIT-00f3ff?style=for-the-badge)](LICENSE)

</div>

<br/>

---

<br/>

It started in a terminal window.
No UI. No database. No memory system. Just an API call fired into the void — and something actually talking back.

<div align="center">
  <br/>
  <img src="./assets/terminal.jpeg" width="100%" alt="The first reply" />
  <br/>
</div>

<br/>

What you're looking at now is everything built after that moment: persistent vector memory, autonomous daily emails, session intelligence, a 3-tier hybrid memory classifier, and a full glassmorphism UI — all grown from one terminal reply.

---

<br/>

<img src="./assets/demo-landing1.png" width="100%" />
<img src="./assets/demo-landing2.png" width="100%" />
<img src="./assets/demo-chat.png" width="100%" />

<br/>

---

<br/>

## ◈ &nbsp; Demo

<div align="center">

**Demo video coming soon.**
In the meantime, clone the repo, plug in your own API keys, and run it locally — setup takes under 3 minutes.

</div>

<br/>

---
## ◈ &nbsp; Response Times

MALAK is currently hosted on free-tier infrastructure. Response times depend on the
underlying model API and may occasionally be slower than expected — this is a
platform constraint, not a reflection of the architecture.

For local deployments with your own API key, response times will vary based on your
tier and region.
---

<br/>

## ◈ &nbsp; What MALAK Actually Does

Most AI chatbots forget you the moment you close the tab. **MALAK doesn't.**

MALAK is a full-stack AI mentorship platform built around one core idea: *your mentor should know you.* It remembers your goals across sessions, tracks your learning arc over weeks, and shows up in your inbox every morning with something personal — not a generic newsletter, but a message that references what *you specifically* worked on.

<br/>

```
  You, Day 1      →   "I want to learn machine learning"
  You, Day 8      →   "I'm stuck on backpropagation"
  You, Day 15     →   "Can we do computer vision next?"

  MALAK, 8:00 AM  →   knows all three. references all three.
                       gives you one concrete thing to do today.
```

<br/>

---

<br/>

## ◈ &nbsp; Architecture

```
malak-ai-mentor/
│
├── 📁 backend/
│   ├── server.js            ←  Express API · auth · chat · session routes · response cache
│   ├── db.js                ←  PostgreSQL pool · 4-min keep-alive · query helper
│   ├── daily_motivator.js   ←  Cron job · 8 AM Cairo time · 5-min timeout guard
│   └── setupDB.js           ←  One-time schema setup (safe to re-run)
│
├── 📁 utils/
│   ├── vector_memory.js     ←  Hybrid classifier · embed · store · query · context builder
│   ├── extract_goal.js      ←  AI session analysis · title + goal extraction (Gemma 4)
│   └── email_sender.js      ←  Welcome email · Nodemailer · Gmail SMTP
│
├── 📁 public/
│   ├── index.html           ←  Landing page · aurora gradient · feature grid
│   ├── auth.html            ←  Sign in / Sign up · glassmorphism card
│   └── chat.html            ←  Full chat UI · sidebar · live Markdown rendering
│
├── 📁 assets/               ←  Banner, screenshots, demo media
├── .env.example             ←  Template — fill in your keys
└── package.json
```

<br/>

### Message Flow

Every message passes through this full pipeline before a single token is generated:

```
┌─────────────────────────────────────────────────┐
│                USER SENDS MESSAGE               │
└───────────────────────┬─────────────────────────┘
                        │
            ┌───────────▼────────────┐
            │   Hybrid Classifier    │
            │  1. Cache lookup       │  ← hits first, zero cost
            │  2. Regex patterns     │  ← no LLM needed for clear cases
            │  3. Gemma 4 (fallback) │  ← only for ambiguous messages
            │  learning/identity/    │
            │        casual          │
            └───────────┬────────────┘
                        │
       ┌────────────────┼─────────────────┐
       ▼                ▼                 ▼
  Save to          Embed + store      If not casual:
  PostgreSQL       in Pinecone        query Pinecone
                   (async,            top-K memories
                   non-blocking)      score > 0.7
                                           │
                                           ▼
                                   Build enriched prompt
                                   [PAST CONTEXT] + message
                                           │
                        ┌──────────────────▼───────────────────┐
                        │         Response Cache check         │
                        │  hit  → return instantly, skip Gemma │
                        │  miss → call Gemma 4 · cache if non- │
                        │         personalized (no memory used)│
                        └──────────────────┬───────────────────┘
                                           │
                                 ┌─────────▼────────┐
                                 │     Gemma 4      │
                                 │  gemma-4-26b-    │
                                 │    a4b-it        │
                                 │  SYSTEM_PROMPT   │
                                 └─────────┬────────┘
                                           │
                  ┌────────────────────────┼─────────────────────┐
                  ▼                        ▼                     ▼
            Save reply               Store reply           Background:
            PostgreSQL               Pinecone              title (1st msg only)
                                     (async)               + goal/summary update
```

<br/>

### Daily Email Pipeline — 8:00 AM Cairo Time

```
① Fetch last 7 sessions with goals  →  PostgreSQL
② Pull top learning memories        →  Pinecone  (mode: 'email', score > 0.7)
③ Feed everything to Gemma 4        →  tight prompt, learning context only
④ Generate 4–5 sentence email       →  references range of topics, one action today
⑤ Send via Gmail SMTP               →  branded HTML template
⑥ 2s delay between users            →  next user → repeat
```

<br/>

---

<br/>

## ◈ &nbsp; Feature Deep-Dive

<br/>

### 🧠 &nbsp; Vector Memory — Pinecone + BGE Embeddings

Every message is **semantically embedded** into a 384-dimensional vector using BGE-Small-EN-v1.5 (runs locally via `fastembed` — zero API cost) and stored in Pinecone under a personal namespace per user.

Before embedding, every message is classified into one of three tiers:

| Type | Examples | Stored in Pinecone? | Injected into chat? | Used in daily email? |
|------|----------|:-------------------:|:-------------------:|:--------------------:|
| `learning` | goals, skills, struggles, breakthroughs | ✅ | ✅ | ✅ |
| `identity` | job, location, student status | ✅ | ✅ | ❌ |
| `casual` | jokes, greetings, small talk | ✅ | ⚡ score-dependent | ❌ |

> `casual` messages are stored and embedded like everything else. They are skipped from active injection — but if a casual message scores above the **0.7 cosine similarity threshold**, it can still surface as relevant context. Memory retrieval is semantic, not categorical.
> The classifier is also used for the daily motivational emails — they should only reference learning-oriented content, not casual things the user sent like jokes or greetings.

The embedder instance auto-recycles every 30 minutes to prevent staleness during long server uptime.

<br/>

### ⚡ &nbsp; Hybrid Memory Classifier

The memory classifier is designed to call Gemma 4 **as rarely as possible**. Every message goes through three stages in order:

**Stage 1 — Cache lookup.** The result of every previously classified message is stored in an in-memory Map (max 500 entries, LRU eviction). If the same message has been classified before, the result is returned instantly with no computation at all.

**Stage 2 — Regex pattern matching.** If no cache hit, the message is tested against hardcoded regex patterns for all three types. Clear greetings, common learning phrases, and identity statements are detected here — no model call needed.

**Stage 3 — Gemma 4 fallback.** Only genuinely ambiguous messages that pass through both stages reach the model. When they do, Gemma 4 is asked for a single word at `temperature: 0`, `maxOutputTokens: 5` — the cheapest possible call.

```
message → cache hit?  → return instantly
        → regex match? → return without LLM
        → Gemma 4      → classify + cache result
```

<br/>

### 🗃️ &nbsp; Response Cache

Gemma 4 responses are cached by exact message text (case-insensitive, trimmed) in an in-memory Map (max 200 entries, LRU eviction).

**Critically, only non-personalized responses are cached.** If memory context was injected into the prompt — meaning the response was shaped by the user's personal history — it is never cached, because the same message from a different user (or the same user at a different point) should produce a different answer.

```
message + no memory context  →  cache + serve
message + memory injected    →  serve fresh, never cache
```

<br/>

### ⚡ &nbsp; Gemma 4-Powered Chat

Sub-second AI responses via Gemma 4 (`gemma-4-26b-a4b-it`). The system prompt enforces **intent detection** before selecting a response format:

| User says... | MALAK does... |
|---|---|
| `"teach me X"` | Learning roadmap + curated resources + where to start |
| `"explain X"` | Conversational explanation with analogies — no resource list |
| `"let's go deeper on Y"` | Step-by-step teaching + comprehension check at the end |
| Intent unclear | Defaults to direct explanation, never a generic list |

No filler openers. No "Great question!" No roadmap when you asked for an explanation.

<br/>

### 📊 &nbsp; Session Intelligence — Background AI Analysis

After every message, two background jobs run silently:

**Session title** — generated from the **first message only**, then never touched again. This keeps token usage minimal: one cheap Gemma 4 call per session (`maxOutputTokens: 20`), fired once at message count ≤ 2, never repeated.

**Goal + summary** — updated after every message by analyzing the full transcript. Irrelevant sessions (jokes, casual chat, one-liner exchanges) are detected by Gemma 4 and skipped entirely, returning `{ relevant: false }` with no further processing.

```
message count ≤ 2  →  generateSessionTitle()  (runs once, never again)
every message      →  updateSessionInsight()   (goal + summary for daily email)
```

<br/>

### 📧 &nbsp; Daily Motivation Engine

Every morning at 8 AM Cairo time, a cron job queries each user's recent sessions and Pinecone memories, feeds the context to Gemma 4, and delivers a personalized email that references the *actual range* of topics worked on — not a copy-pasted motivational quote. A 5-minute timeout guard prevents any single stuck user from blocking the rest of the queue.

<br/>

### 🔐 &nbsp; Auth System

- JWT tokens with 7-day expiry — stateless, no session storage needed
- Passwords hashed with bcrypt (10 salt rounds)
- Welcome email fires automatically on registration
- Guest mode — ephemeral 24h session, no email required, excluded from daily emails
- 3-second per-user rate limit cooldown between messages

<br/>

---

<br/>

## ◈ &nbsp; Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 18+ (ESM) | Native `import/export`, modern JS |
| API | Express.js | Fast, minimal, battle-tested |
| Database | PostgreSQL · Neon | Serverless, auto-scales, free tier |
| Vector DB | Pinecone | Sub-10ms semantic search |
| Embeddings | BGE-Small-EN-v1.5 (`fastembed`) | 384-dim, runs locally, zero API cost |
| LLM | Gemma 4 26B · Google GenAI | Powerful, fast, used across chat + classifier + email |
| Auth | JWT + bcrypt | Stateless, secure, no session store |
| Email | Nodemailer + Gmail SMTP | Zero infrastructure needed |
| Scheduler | node-cron | Lightweight in-process cron |
| Frontend | Vanilla HTML / CSS / JS | Zero build step, instant deploy |

<br/>

---

<br/>

## ◈ &nbsp; Getting Started

**Prerequisites:**
- Node.js 18+
- PostgreSQL — [Neon](https://neon.tech) recommended (free tier is enough)
- [Google GenAI API key](https://aistudio.google.com) — for Gemma 4 access
- [Pinecone](https://pinecone.io) — create an index: **384 dimensions**, cosine metric
- Gmail + [App Password](https://myaccount.google.com/apppasswords) (not your regular Gmail password)

<br/>

```bash
# 1. Clone
git clone https://github.com/your-username/malak-ai-mentor.git
cd malak-ai-mentor

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# → fill in your keys (see below)

# 4. Initialize database
npm run setup-db

# 5. Run
npm run dev
```

Open **`http://localhost:3005`**

<br/>

**`.env` reference:**

```env
DATABASE_URL=postgresql://user:pass@host.neon.tech/neondb?sslmode=require
GEMMA_API_KEY=your_google_genai_api_key
PINECONE_API_KEY=pcsk_...
PINECONE_HOST=https://your-index.pinecone.io
EMAIL_USER=your@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx
JWT_SECRET=something_long_and_random
PORT=3005
```

<br/>

**Test the daily email without waiting for 8 AM:**

```bash
npm run motivator
# or uncomment sendDailyEmails() at the bottom of daily_motivator.js
```

<br/>

---

<br/>

## ◈ &nbsp; API Reference

```
POST  /api/register              →  Create account · fires welcome email
POST  /api/login                 →  Authenticate · returns JWT
POST  /api/guest                 →  Ephemeral guest session · 24h JWT · no email
POST  /api/chat/start            →  Create new chat session
POST  /api/chat/message          →  Send message · receive AI reply
GET   /api/chat/history/:userId  →  Last 90 days of sessions + messages
```

<br/>

**The command that started it all, use it too for testing. I still get inspired byy it:**

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:3005/api/chat" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"message":"Hello"}'
```

```
reply
─────
Hello! How can I help you today?
```

---

<br/>

## ◈ &nbsp; Contributing

```bash
git checkout -b feature/your-idea
git commit -m "feat: describe your change"
git push origin feature/your-idea
# → open a Pull Request
```

<br/>

---

<br/>

<div align="center">

<br/>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
Built with intention · Cairo, Egypt · 2026  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Malak M. Salem**  
Data Science · Cairo University

*Started as a terminal command. Became a mentor.*

`MIT License · © Malak M. Salem`

<br/>

</div>
