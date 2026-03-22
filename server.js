const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ====== ROOT (IMPORTANT FOR RENDER) ======
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

// ====== STORAGE (temporary in memory) ======
let feed = [];
let reactions = [];
let dailyShareCounts = {};

// ====== EMOJI SYSTEM ======
const emojiPool = ["🔥", "🚀", "💎", "⚡", "🐼", "🦊", "🐯", "🐸", "🐵", "🐧", "🌙", "⭐", "🌊", "🍀"];
const userEmojiMap = {};

function getEmoji(userId) {
  if (!userEmojiMap[userId]) {
    userEmojiMap[userId] = emojiPool[Math.floor(Math.random() * emojiPool.length)];
  }
  return userEmojiMap[userId];
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ====== GET FEED ======
app.get("/api/feed/cards", (req, res) => {
  console.log("GET /api/feed/cards HIT");
  res.json({ items: feed });
});

// ====== SHARE TRADE ======
app.post("/api/feed/share-trade", (req, res) => {
  console.log("POST /api/feed/share-trade HIT");

  const data = req.body || {};
  const tradeId = data.trade_id || data.tradeId;
  const userId = data.user_id || "anon";
  const todayKey = getTodayKey();
  const shareKey = `${userId}_${todayKey}`;

  if (!tradeId) {
    return res.status(400).json({ error: "Missing tradeId" });
  }

  if (!dailyShareCounts[shareKey]) {
    dailyShareCounts[shareKey] = 0;
  }

  if (dailyShareCounts[shareKey] >= 3) {
    return res.status(400).json({ error: "Daily share limit reached (3 per day)" });
  }

  const exists = feed.find((f) => f.tradeId === tradeId);
  if (exists) {
    return res.status(400).json({ error: "Already shared" });
  }

  const newCard = {
    id: "card_" + Date.now(),
    tradeId: tradeId,
    pair: data.pair || "N/A",
    sessionLabel: data.session_label || data.sessionLabel || "Unknown",
    direction: data.direction || "BUY",
    result: data.result || "OPEN",
    entryPrice: Number(data.entry_price || data.entryPrice || 0),
    exitPrice: Number(data.exit_price || data.exitPrice || 0),
    pnl: Number(data.pnl || 0),
    tradeTime: data.trade_time || data.tradeTime || new Date().toISOString(),
    displayName: "Pre-Billionarie",
    emojiAvatar: getEmoji(userId),
    loveCount: 0,
    heartbreakCount: 0,
    userReaction: ""
  };

  feed.unshift(newCard);

  // keep only latest 50 posts
  if (feed.length > 50) {
    feed = feed.slice(0, 50);
  }

  dailyShareCounts[shareKey] += 1;

  res.json(newCard);
});

// ====== REACT ======
app.post("/api/feed/react", (req, res) => {
  const { user_id, card_id, reaction_type } = req.body;

  const card = feed.find((c) => c.id === card_id);
  if (!card) return res.status(404).send();

  reactions = reactions.filter((r) => !(r.user_id === user_id && r.card_id === card_id));

  reactions.push({ user_id, card_id, reaction_type });

  card.loveCount = reactions.filter((r) => r.card_id === card_id && r.reaction_type === "love").length;

  card.heartbreakCount = reactions.filter((r) => r.card_id === card_id && r.reaction_type === "heartbreak").length;

  res.json({ success: true });
});

// ====== START SERVER ======
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
