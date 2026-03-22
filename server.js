const express = require("express");
const cors = require("cors");

const app = express();

// ====== BASIC APP HARDENING ======
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "50kb" }));

// ====== CORS ======
// Optional: set Render env var ALLOWED_ORIGIN to your web origin if you need strict CORS.
// Mobile apps often send no Origin header, so requests without Origin are allowed.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// Lightweight security headers without extra packages
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

const PORT = process.env.PORT || 3000;

// ====== ROOT / HEALTH ======
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ====== STORAGE (temporary in memory) ======
let feed = [];
let reactions = [];
let dailyShareCounts = {};

// ====== IN-MEMORY RATE LIMITING ======
const requestBuckets = {};
const RATE_WINDOW_MS = 60 * 1000;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function isRateLimited(key, maxHits, windowMs = RATE_WINDOW_MS) {
  const now = Date.now();
  const bucket = requestBuckets[key];

  if (!bucket || now - bucket.windowStart > windowMs) {
    requestBuckets[key] = { count: 1, windowStart: now };
    return false;
  }

  if (bucket.count >= maxHits) {
    return true;
  }

  bucket.count += 1;
  return false;
}

function cleanupOldRateLimits() {
  const now = Date.now();
  for (const key of Object.keys(requestBuckets)) {
    if (now - requestBuckets[key].windowStart > RATE_WINDOW_MS * 2) {
      delete requestBuckets[key];
    }
  }
}

setInterval(cleanupOldRateLimits, 10 * 60 * 1000).unref();

// ====== EMOJI SYSTEM ======
const emojiPool = ["🔥", "🚀", "💎", "⚡", "🐼", "🦊", "🐯", "🐸", "🐵", "🐧", "🌙", "⭐", "🌊", "🍀"];
const userEmojiMap = {};

function getEmoji(userId) {
  if (!userEmojiMap[userId]) {
    userEmojiMap[userId] =
      emojiPool[Math.floor(Math.random() * emojiPool.length)];
  }
  return userEmojiMap[userId];
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ====== HELPERS ======
const VALID_DIRECTIONS = new Set(["BUY", "SELL"]);
const VALID_RESULTS = new Set(["WIN", "LOSS", "BREAKEVEN", "OPEN"]);
const VALID_REACTIONS = new Set(["love", "heartbreak"]);

function normalizeString(value, fallback = "", maxLength = 50) {
  const result = String(value ?? fallback).trim();
  if (!result) return fallback;
  return result.slice(0, maxLength);
}

function readNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function validateShareTradePayload(data) {
  const tradeId = normalizeString(data.trade_id || data.tradeId, "", 100);
  const userId = normalizeString(data.user_id, "anon", 100);
  const pair = normalizeString(data.pair, "", 30).toUpperCase();
  const sessionLabel = normalizeString(
    data.session_label || data.sessionLabel,
    "Unknown",
    50
  );
  const direction = normalizeString(data.direction, "BUY", 10).toUpperCase();
  const result = normalizeString(data.result, "OPEN", 15).toUpperCase();

  const entryPrice = readNumber(data.entry_price ?? data.entryPrice, 0);
  const exitPrice = readNumber(data.exit_price ?? data.exitPrice, 0);
  const pnl = readNumber(data.pnl, 0);
  const tradeTime = normalizeString(
    data.trade_time || data.tradeTime || new Date().toISOString(),
    new Date().toISOString(),
    100
  );

  if (!tradeId) {
    return { ok: false, error: "Missing tradeId" };
  }

  if (!userId) {
    return { ok: false, error: "Missing user_id" };
  }

  if (!pair) {
    return { ok: false, error: "Missing pair" };
  }

  if (!VALID_DIRECTIONS.has(direction)) {
    return { ok: false, error: "Invalid direction" };
  }

  if (!VALID_RESULTS.has(result)) {
    return { ok: false, error: "Invalid result" };
  }

  if (entryPrice <= 0 || exitPrice <= 0) {
    return { ok: false, error: "Invalid entry/exit price" };
  }

  return {
    ok: true,
    value: {
      tradeId,
      userId,
      pair,
      sessionLabel,
      direction,
      result,
      entryPrice,
      exitPrice,
      pnl,
      tradeTime,
    },
  };
}

function validateReactionPayload(data) {
  const userId = normalizeString(data.user_id, "", 100);
  const cardId = normalizeString(data.card_id, "", 100);
  const reactionType = normalizeString(data.reaction_type, "", 20).toLowerCase();

  if (!userId) return { ok: false, error: "Missing user_id" };
  if (!cardId) return { ok: false, error: "Missing card_id" };
  if (!VALID_REACTIONS.has(reactionType)) {
    return { ok: false, error: "Invalid reaction_type" };
  }

  return {
    ok: true,
    value: { userId, cardId, reactionType },
  };
}

function recalcReactionCounts(cardId) {
  const card = feed.find((c) => c.id === cardId);
  if (!card) return;

  card.loveCount = reactions.filter(
    (r) => r.card_id === cardId && r.reaction_type === "love"
  ).length;

  card.heartbreakCount = reactions.filter(
    (r) => r.card_id === cardId && r.reaction_type === "heartbreak"
  ).length;
}

// ====== REQUEST LOGGING ======
app.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ip=${getClientIp(req)}`
  );
  next();
});

// ====== GET FEED ======
app.get("/api/feed/cards", (req, res) => {
  const ip = getClientIp(req);
  if (isRateLimited(`feed:${ip}`, 120)) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const limit = Math.max(1, Math.min(50, readNumber(req.query.limit, 50)));

  res.json({ items: feed.slice(0, limit) });
});

// ====== SHARE TRADE ======
app.post("/api/feed/share-trade", (req, res) => {
  const ip = getClientIp(req);

  if (isRateLimited(`share:${ip}`, 20)) {
    return res.status(429).json({ error: "Too many share attempts. Please slow down." });
  }

  const validation = validateShareTradePayload(req.body || {});
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const data = validation.value;
  const todayKey = getTodayKey();
  const shareKey = `${data.userId}_${todayKey}`;

  if (!dailyShareCounts[shareKey]) {
    dailyShareCounts[shareKey] = 0;
  }

  if (dailyShareCounts[shareKey] >= 3) {
    return res.status(400).json({ error: "Daily share limit reached (3 per day)" });
  }

  const exists = feed.find((f) => f.tradeId === data.tradeId);
  if (exists) {
    return res.status(400).json({ error: "Already shared" });
  }

  const newCard = {
    id: "card_" + Date.now(),
    tradeId: data.tradeId,
    pair: data.pair,
    sessionLabel: data.sessionLabel,
    direction: data.direction,
    result: data.result,
    entryPrice: data.entryPrice,
    exitPrice: data.exitPrice,
    pnl: data.pnl,
    tradeTime: data.tradeTime,
    displayName: "Pre-Billionarie",
    emojiAvatar: getEmoji(data.userId),
    loveCount: 0,
    heartbreakCount: 0,
    userReaction: "",
  };

  feed.unshift(newCard);

  if (feed.length > 50) {
    feed = feed.slice(0, 50);
  }

  dailyShareCounts[shareKey] += 1;

  return res.json(newCard);
});

// ====== REACT ======
app.post("/api/feed/react", (req, res) => {
  const ip = getClientIp(req);

  if (isRateLimited(`react:${ip}`, 60)) {
    return res.status(429).json({ error: "Too many reaction attempts. Please slow down." });
  }

  const validation = validateReactionPayload(req.body || {});
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const { userId, cardId, reactionType } = validation.value;

  const card = feed.find((c) => c.id === cardId);
  if (!card) {
    return res.status(404).json({ error: "Card not found" });
  }

  const existingReaction = reactions.find(
    (r) => r.user_id === userId && r.card_id === cardId
  );

  if (existingReaction && existingReaction.reaction_type === reactionType) {
    reactions = reactions.filter(
      (r) => !(r.user_id === userId && r.card_id === cardId)
    );
    recalcReactionCounts(cardId);
    return res.json({
      success: true,
      removed: true,
      loveCount: card.loveCount,
      heartbreakCount: card.heartbreakCount,
    });
  }

  reactions = reactions.filter(
    (r) => !(r.user_id === userId && r.card_id === cardId)
  );

  reactions.push({
    user_id: userId,
    card_id: cardId,
    reaction_type: reactionType,
  });

  recalcReactionCounts(cardId);

  return res.json({
    success: true,
    removed: false,
    loveCount: card.loveCount,
    heartbreakCount: card.heartbreakCount,
  });
});

// ====== ERROR HANDLERS ======
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  return res.status(500).json({ error: "Internal server error" });
});

// ====== START SERVER ======
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
