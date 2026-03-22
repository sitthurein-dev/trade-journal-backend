const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ====== STORAGE (temporary in memory) ======
let feed = [];
let reactions = [];

// ====== EMOJI SYSTEM ======
const emojiPool = ["🔥", "🚀", "💎", "⚡", "🐼", "🦊", "🐯", "🐸", "🐵", "🐧", "🌙", "⭐", "🌊", "🍀"];
const userEmojiMap = {};

function getEmoji(userId) {
  if (!userEmojiMap[userId]) {
    userEmojiMap[userId] = emojiPool[Math.floor(Math.random() * emojiPool.length)];
  }
  return userEmojiMap[userId];
}

// ====== GET FEED ======
app.get("/api/feed/cards", (req, res) => {
  res.json({ items: feed });
});

// ====== SHARE TRADE ======
app.post("/api/feed/share-trade", (req, res) => {
  const data = req.body;

  // prevent duplicate trade
  const exists = feed.find((f) => f.tradeId === (data.trade_id || data.tradeId));
  if (exists) {
    return res.status(400).json({ error: "Already shared" });
  }

  const newCard = {
    id: "card_" + Date.now(),

    tradeId: data.trade_id || data.tradeId,
    pair: data.pair,
    sessionLabel: data.session_label || data.sessionLabel,
    direction: data.direction,
    result: data.result,

    entryPrice: Number(data.entry_price || data.entryPrice || 0),
    exitPrice: Number(data.exit_price || data.exitPrice || 0),

    pnl: Number(data.pnl || 0),

    

    tradeTime: data.trade_time || data.tradeTime,

    displayName: "Pre-Billionarie",
    emojiAvatar: getEmoji(data.user_id),

    loveCount: 0,
    heartbreakCount: 0,
    userReaction: ""
  };

  feed.unshift(newCard);

  res.json(newCard);
});

// ====== REACT ======
app.post("/api/feed/react", (req, res) => {
  const { user_id, card_id, reaction_type } = req.body;

  const card = feed.find((c) => c.id === card_id);
  if (!card) return res.status(404).send();

  // remove old reaction
  reactions = reactions.filter((r) => !(r.user_id === user_id && r.card_id === card_id));

  // add new reaction
  reactions.push({ user_id, card_id, reaction_type });

  // recalc counts
  card.loveCount = reactions.filter((r) => r.card_id === card_id && r.reaction_type === "love").length;
  card.heartbreakCount = reactions.filter((r) => r.card_id === card_id && r.reaction_type === "heartbreak").length;

  res.json({ success: true });
});

// ====== START SERVER ======
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
