import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const WAITLIST_DATA_FILE = path.resolve(
  process.env.PBP_WAITLIST_DATA_FILE ||
    path.join(__dirname, "data", "waitlist-submissions.json")
);
const OUTBOUND_CLICK_DATA_FILE = path.resolve(
  process.env.PBP_OUTBOUND_CLICK_DATA_FILE ||
    path.join(__dirname, "data", "outbound-click-events.json")
);
const BETA_FEEDBACK_DATA_FILE = path.resolve(
  process.env.PBP_BETA_FEEDBACK_DATA_FILE ||
    path.join(__dirname, "data", "beta-feedback.json")
);
const ALERT_SIGNALS_TABLE = "alert_signals";
const OUTBOUND_CLICK_EVENTS_TABLE = "outbound_click_events";
const BETA_FEEDBACK_TABLE = "beta_feedback";
const PUBLIC_ALERT_SIGNAL_LIMIT = 5;

const GAMMA_BASE = "https://gamma-api.polymarket.com";

const LIVE_MARKET_LIMIT = 250;
const LIVE_CACHE_MS = 45_000;
const LIVE_REFRESH_INTERVAL_MS = 120_000;
const FETCH_TIMEOUT_MS = 15_000;
const PRICE_MEMORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRICE_MEMORY_MIN_SAMPLE_GAP_MS = 60_000;
const MARKET_END_GRACE_MS = 15 * 60 * 1000;
const MARKET_FRESH_MS = 60 * 60 * 1000;
const MARKET_STALE_MS = 72 * 60 * 60 * 1000;

const TRUSTED_TOP_LEVEL_CATEGORIES = new Set([
  "News",
  "Politics",
  "Sports",
  "Crypto",
  "Business",
  "World",
  "Culture",
]);

const GENERIC_CATEGORY_VALUES = new Set([
  "",
  "all",
  "featured",
  "new",
  "markets",
  "market",
  "events",
  "event",
  "homepage",
  "trending",
  "uncategorized",
  "general",
  "misc",
  "other",
  "everything",
]);

const DIRECT_SOURCE_CATEGORY_RULES = [
  {
    category: "Sports",
    patterns: [
      /\bsports?\b/,
      /\bnba\b/,
      /\bwnba\b/,
      /\bnfl\b/,
      /\bmlb\b/,
      /\bnhl\b/,
      /\bsoccer\b/,
      /\bfootball\b/,
      /\bbaseball\b/,
      /\bbasketball\b/,
      /\btennis\b/,
      /\bgolf\b/,
      /\bboxing\b/,
      /\bmma\b/,
      /\bufc\b/,
      /\bcricket\b/,
      /\brugby\b/,
      /\bformula[\s-]?1\b/,
      /\bf1\b/,
    ],
  },
  {
    category: "Politics",
    patterns: [
      /\bpolitic(?:s|al)?\b/,
      /\belections?\b/,
      /\belection\s*202[0-9]\b/,
      /\bgovernment\b/,
      /\bpolicy\b/,
      /\bcampaign\b/,
      /\bcongress\b/,
      /\bsenate\b/,
      /\bhouse\b/,
      /\bpresident(?:ial)?\b/,
      /\bprime minister\b/,
      /\bgovernor\b/,
      /\bmayor\b/,
      /\bparliament\b/,
    ],
  },
  {
    category: "Business",
    patterns: [
      /\bbusiness\b/,
      /\bfinance\b/,
      /\bfinancial\b/,
      /\bearnings\b/,
      /\brevenue\b/,
      /\bcompany\b/,
      /\bcompanies\b/,
      /\bstock\b/,
      /\bstocks\b/,
      /\bshare\b/,
      /\bshares\b/,
      /\binflation\b/,
      /\bcpi\b/,
      /\bgdp\b/,
      /\bfed\b/,
      /\brate cuts?\b/,
      /\binterest rates?\b/,
      /\btreasury\b/,
      /\byields?\b/,
      /\bmacro\b/,
      /\beconomic\b/,
      /\beconomy\b/,
      /\brecession\b/,
      /\btariffs?\b/,
      /\bbanking\b/,
      /\bipo\b/,
    ],
  },
  {
    category: "World",
    patterns: [
      /\bworld\b/,
      /\binternational\b/,
      /\bglobal\b/,
      /\bgeopolitic(?:s|al)?\b/,
      /\bforeign\b/,
      /\bmiddle east\b/,
      /\beurope\b/,
      /\basia\b/,
      /\bafrica\b/,
      /\blatin america\b/,
    ],
  },
  {
    category: "Culture",
    patterns: [
      /\bculture\b/,
      /\bentertainment\b/,
      /\bcelebrit(?:y|ies)\b/,
      /\bmovie(?:s)?\b/,
      /\bfilm\b/,
      /\btv\b/,
      /\btelevision\b/,
      /\bmusic\b/,
      /\bawards?\b/,
      /\bpop culture\b/,
    ],
  },
  {
    category: "Crypto",
    patterns: [
      /\bcrypto\b/,
      /\bcryptocurrency\b/,
      /\bblockchain\b/,
      /\bweb3\b/,
      /\bdefi\b/,
      /\bnft(?:s)?\b/,
      /\bbitcoin\b/,
      /\bethereum\b/,
      /\bsolana\b/,
      /\bdogecoin\b/,
      /\bxrp\b/,
      /\bbtc\b/,
      /\beth\b/,
    ],
  },
  {
    category: "News",
    patterns: [/\bnews\b/, /\bcurrent events\b/, /\bheadlines?\b/],
  },
];

const liveDataState = {
  markets: [],
  lastFetchedAt: 0,
};

const priceMemoryByMarketId = new Map();
const signalLogByMarketId = new Map();
let waitlistWriteQueue = Promise.resolve();
let outboundClickWriteQueue = Promise.resolve();
let betaFeedbackWriteQueue = Promise.resolve();

const demoState = {
  account: createInitialAccountState(),
  paper: createInitialPaperState(),
};

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      ok: false,
      error: "Invalid JSON body.",
    });
  }

  return next(error);
});
app.use(express.static(PUBLIC_DIR));

function createInitialAccountState() {
  return {
    isConnected: false,
    walletType: "NONE",
    walletAddress: "",
    proxyWalletAddress: "",
    signatureType: 0,
    funderAddress: "",
    liveModeEnabled: false,
  };
}

function createInitialPaperState() {
  const startingBankroll = 1000;
  const defaultPositionSize = 50;

  return {
    bankroll: {
      startingBankroll,
      cash: startingBankroll,
      equity: startingBankroll,
      defaultPositionSize,
    },
    positions: [],
  };
}

function normalizeWaitlistEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidWaitlistEmail(value) {
  const email = normalizeWaitlistEmail(value);
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function normalizeWaitlistSource(value) {
  return String(value || "pbp-alerts-homepage")
    .trim()
    .replace(/[^\w .:/?#&=+-]/g, "")
    .slice(0, 120) || "pbp-alerts-homepage";
}

function redactSensitivePublicText(value) {
  return String(value || "")
    .replace(
      /\b(?:PBP_ADMIN_SECRET|PBP_ALERT_INGEST_SECRET|SUPABASE_SERVICE_ROLE_KEY|DISCORD_WEBHOOK_URL|WEBHOOK_URL)\s*[:=]\s*["']?[^"'\s]+["']?/gi,
      "[redacted-secret]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
      "[redacted-token]"
    )
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(
      /\b(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
      "[redacted-email]"
    )
    .replace(
      /\b(?:10|127)\.(?:\d{1,3}\.){2}\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b|\b169\.254\.\d{1,3}\.\d{1,3}\b/g,
      "[redacted-ip]"
    )
    .replace(/\blocalhost(?::\d{2,5})?\b/gi, "[redacted-host]");
}

function sanitizePublicAlertText(value, maxLength) {
  const text = redactSensitivePublicText(value)
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function sanitizeOptionalPublicAlertText(value, maxLength) {
  const text = sanitizePublicAlertText(value, maxLength);
  return text || null;
}

function normalizeAlertType(value) {
  return sanitizePublicAlertText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeAlertSeverity(value) {
  const severity = sanitizePublicAlertText(value, 40)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  return severity || null;
}

function normalizeAlertSource(value) {
  return sanitizePublicAlertText(value, 120)
    .replace(/[^\w .:/?#&=+-]/g, "")
    .trim()
    .slice(0, 120) || null;
}

function normalizeAlertSignalInput(body) {
  return {
    alertType: normalizeAlertType(body?.alertType ?? body?.alert_type),
    marketQuestion: sanitizePublicAlertText(
      body?.marketQuestion ?? body?.market_question,
      280
    ),
    reason: sanitizeOptionalPublicAlertText(body?.reason, 400),
    severity: normalizeAlertSeverity(body?.severity),
    source: normalizeAlertSource(body?.source),
  };
}

function sanitizeOutboundClickText(value, maxLength) {
  const text = redactSensitivePublicText(value)
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function normalizeOutboundClickToken(value, fallback, maxLength = 120) {
  const text = sanitizeOutboundClickText(value, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);

  return text || fallback;
}

function normalizeOutboundMarketUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (hostname !== "polymarket.com" && !hostname.endsWith(".polymarket.com"))
    ) {
      return "";
    }

    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString().slice(0, 600);
  } catch {
    return "";
  }
}

function normalizeOutboundClickInput(body) {
  return {
    marketId: sanitizeOutboundClickText(body?.marketId ?? body?.market_id, 160),
    marketSlug: sanitizeOutboundClickText(body?.marketSlug ?? body?.market_slug, 220),
    marketQuestion: sanitizeOutboundClickText(
      body?.marketQuestion ?? body?.market_question,
      300
    ),
    marketUrl: normalizeOutboundMarketUrl(body?.marketUrl ?? body?.market_url),
    sourceSection: normalizeOutboundClickToken(
      body?.sourceSection ?? body?.source_section,
      "unknown-section",
      120
    ),
    cta: normalizeOutboundClickToken(body?.cta, "open-market", 120),
  };
}

function sanitizeBetaFeedbackText(value, maxLength) {
  const text = redactSensitivePublicText(value)
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function normalizeBetaFeedbackRating(value) {
  if (value === null || value === undefined || value === "") return null;

  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  return rating;
}

function normalizeBetaFeedbackEmail(value) {
  const email = normalizeWaitlistEmail(value).slice(0, 254);
  return email || null;
}

function normalizeBetaFeedbackSource(value) {
  return String(value || "public-beta")
    .trim()
    .replace(/[^\w .:/?#&=+-]/g, "")
    .slice(0, 120) || "public-beta";
}

function normalizeBetaFeedbackInput(body) {
  return {
    rating: normalizeBetaFeedbackRating(body?.rating),
    message: sanitizeBetaFeedbackText(body?.message, 2000),
    email: normalizeBetaFeedbackEmail(body?.email),
    source: normalizeBetaFeedbackSource(body?.source),
  };
}

function toPublicAlertSignal(signal) {
  return {
    alertType: signal.alertType,
    marketQuestion: signal.marketQuestion,
    reason: signal.reason,
    severity: signal.severity,
    createdAt: signal.createdAt,
  };
}

function normalizeWaitlistData(raw) {
  const submissions = Array.isArray(raw?.submissions) ? raw.submissions : [];
  const normalizedSubmissions = [];
  const seenEmails = new Set();

  for (const submission of submissions) {
    const email = normalizeWaitlistEmail(submission?.email);
    if (!isValidWaitlistEmail(email) || seenEmails.has(email)) continue;

    seenEmails.add(email);
    normalizedSubmissions.push({
      email,
      source: normalizeWaitlistSource(submission?.source),
      createdAt: String(submission?.createdAt || new Date().toISOString()),
    });
  }

  return {
    version: 1,
    updatedAt: String(raw?.updatedAt || new Date().toISOString()),
    submissions: normalizedSubmissions,
  };
}

function normalizeOutboundClickData(raw) {
  const events = Array.isArray(raw?.events) ? raw.events : [];
  const normalizedEvents = [];

  for (const event of events) {
    const normalized = normalizeOutboundClickInput({
      marketId: event?.marketId,
      marketSlug: event?.marketSlug,
      marketQuestion: event?.marketQuestion,
      marketUrl: event?.marketUrl,
      sourceSection: event?.sourceSection,
      cta: event?.cta,
    });

    normalizedEvents.push({
      ...normalized,
      createdAt: String(event?.createdAt || new Date().toISOString()),
    });
  }

  return {
    version: 1,
    updatedAt: String(raw?.updatedAt || new Date().toISOString()),
    events: normalizedEvents,
  };
}

function normalizeBetaFeedbackData(raw) {
  const feedback = Array.isArray(raw?.feedback) ? raw.feedback : [];
  const normalizedFeedback = [];

  for (const item of feedback) {
    const normalized = normalizeBetaFeedbackInput({
      rating: item?.rating,
      message: item?.message,
      email: item?.email,
      source: item?.source,
    });

    if (!normalized.message) continue;

    normalizedFeedback.push({
      ...normalized,
      createdAt: String(item?.createdAt || new Date().toISOString()),
    });
  }

  return {
    version: 1,
    updatedAt: String(raw?.updatedAt || new Date().toISOString()),
    feedback: normalizedFeedback,
  };
}

async function readWaitlistData() {
  try {
    const rawJson = await fs.readFile(WAITLIST_DATA_FILE, "utf8");
    return normalizeWaitlistData(JSON.parse(rawJson));
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeWaitlistData({ submissions: [] });
    }
    throw error;
  }
}

async function writeWaitlistData(data) {
  const normalizedData = normalizeWaitlistData({
    ...data,
    updatedAt: new Date().toISOString(),
  });
  const directory = path.dirname(WAITLIST_DATA_FILE);
  const tempFile = path.join(
    directory,
    `.waitlist-submissions.${process.pid}.${Date.now()}.tmp`
  );

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    tempFile,
    `${JSON.stringify(normalizedData, null, 2)}\n`,
    "utf8"
  );
  await fs.rename(tempFile, WAITLIST_DATA_FILE);
}

async function readOutboundClickData() {
  try {
    const rawJson = await fs.readFile(OUTBOUND_CLICK_DATA_FILE, "utf8");
    return normalizeOutboundClickData(JSON.parse(rawJson));
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeOutboundClickData({ events: [] });
    }
    throw error;
  }
}

async function writeOutboundClickData(data) {
  const normalizedData = normalizeOutboundClickData({
    ...data,
    updatedAt: new Date().toISOString(),
  });
  const directory = path.dirname(OUTBOUND_CLICK_DATA_FILE);
  const tempFile = path.join(
    directory,
    `.outbound-click-events.${process.pid}.${Date.now()}.tmp`
  );

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    tempFile,
    `${JSON.stringify(normalizedData, null, 2)}\n`,
    "utf8"
  );
  await fs.rename(tempFile, OUTBOUND_CLICK_DATA_FILE);
}

async function readBetaFeedbackData() {
  try {
    const rawJson = await fs.readFile(BETA_FEEDBACK_DATA_FILE, "utf8");
    return normalizeBetaFeedbackData(JSON.parse(rawJson));
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeBetaFeedbackData({ feedback: [] });
    }
    throw error;
  }
}

async function writeBetaFeedbackData(data) {
  const normalizedData = normalizeBetaFeedbackData({
    ...data,
    updatedAt: new Date().toISOString(),
  });
  const directory = path.dirname(BETA_FEEDBACK_DATA_FILE);
  const tempFile = path.join(
    directory,
    `.beta-feedback.${process.pid}.${Date.now()}.tmp`
  );

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    tempFile,
    `${JSON.stringify(normalizedData, null, 2)}\n`,
    "utf8"
  );
  await fs.rename(tempFile, BETA_FEEDBACK_DATA_FILE);
}

function getSupabaseWaitlistConfig() {
  const supabaseUrl = envFirst("SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = envFirst("SUPABASE_SERVICE_ROLE_KEY");
  const table = envFirst("SUPABASE_WAITLIST_TABLE");

  return {
    enabled: !!(supabaseUrl && serviceRoleKey && table),
    supabaseUrl,
    serviceRoleKey,
    table,
  };
}

function getSupabaseAlertSignalConfig() {
  const supabaseUrl = envFirst("SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = envFirst("SUPABASE_SERVICE_ROLE_KEY");

  return {
    enabled: !!(supabaseUrl && serviceRoleKey),
    supabaseUrl,
    serviceRoleKey,
    table: ALERT_SIGNALS_TABLE,
  };
}

function getSupabaseOutboundClickConfig() {
  const supabaseUrl = envFirst("SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = envFirst("SUPABASE_SERVICE_ROLE_KEY");

  return {
    enabled: !!(supabaseUrl && serviceRoleKey),
    supabaseUrl,
    serviceRoleKey,
    table: OUTBOUND_CLICK_EVENTS_TABLE,
  };
}

function getSupabaseBetaFeedbackConfig() {
  const supabaseUrl = envFirst("SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = envFirst("SUPABASE_SERVICE_ROLE_KEY");

  return {
    enabled: !!(supabaseUrl && serviceRoleKey),
    supabaseUrl,
    serviceRoleKey,
    table: BETA_FEEDBACK_TABLE,
  };
}

function getSupabaseHost(supabaseUrl) {
  if (!supabaseUrl) return "";

  try {
    return new URL(supabaseUrl).host;
  } catch {
    return "invalid-url";
  }
}

function getSupabaseTargetInfo(url) {
  try {
    const parsed = url instanceof URL ? url : new URL(String(url));
    return {
      host: parsed.host,
      path: parsed.pathname,
    };
  } catch {
    return {
      host: "invalid-url",
      path: "",
    };
  }
}

function buildWaitlistStorageLog(config = getSupabaseWaitlistConfig()) {
  return {
    storageMode: config.enabled ? "supabase" : "json",
    supabaseEnabled: config.enabled,
    supabaseHost: getSupabaseHost(config.supabaseUrl) || "not-configured",
    supabaseTable: config.table || "not-configured",
    supabaseUrlConfigured: !!config.supabaseUrl,
    supabaseServiceRoleKeyConfigured: !!config.serviceRoleKey,
    supabaseTableConfigured: !!config.table,
  };
}

function logWaitlistStorageMode(context) {
  console.log(`[waitlist] ${context}`, buildWaitlistStorageLog());
}

function buildAlertSignalStorageLog(config = getSupabaseAlertSignalConfig()) {
  return {
    storageMode: config.enabled ? "supabase" : "not_configured",
    supabaseEnabled: config.enabled,
    supabaseHost: getSupabaseHost(config.supabaseUrl) || "not-configured",
    supabaseTable: config.table,
    supabaseUrlConfigured: !!config.supabaseUrl,
    supabaseServiceRoleKeyConfigured: !!config.serviceRoleKey,
  };
}

function logAlertSignalStorageMode(context) {
  console.log(`[alert-signals] ${context}`, buildAlertSignalStorageLog());
}

function buildOutboundClickStorageLog(config = getSupabaseOutboundClickConfig()) {
  return {
    storageMode: config.enabled ? "supabase" : "json",
    supabaseEnabled: config.enabled,
    supabaseHost: getSupabaseHost(config.supabaseUrl) || "not-configured",
    supabaseTable: config.table,
    supabaseUrlConfigured: !!config.supabaseUrl,
    supabaseServiceRoleKeyConfigured: !!config.serviceRoleKey,
  };
}

function logOutboundClickStorageMode(context) {
  console.log(`[outbound-clicks] ${context}`, buildOutboundClickStorageLog());
}

function buildBetaFeedbackStorageLog(config = getSupabaseBetaFeedbackConfig()) {
  return {
    storageMode: config.enabled ? "supabase" : "json",
    supabaseEnabled: config.enabled,
    supabaseHost: getSupabaseHost(config.supabaseUrl) || "not-configured",
    supabaseTable: config.table,
    supabaseUrlConfigured: !!config.supabaseUrl,
    supabaseServiceRoleKeyConfigured: !!config.serviceRoleKey,
  };
}

function logBetaFeedbackStorageMode(context) {
  console.log(`[beta-feedback] ${context}`, buildBetaFeedbackStorageLog());
}

function getActiveWaitlistStorageProvider() {
  const config = getSupabaseWaitlistConfig();

  return {
    storageMode: config.enabled ? "supabase" : "json",
    config,
  };
}

function getActiveAlertSignalStorageProvider() {
  const config = getSupabaseAlertSignalConfig();

  return {
    storageMode: config.enabled ? "supabase" : "not_configured",
    config,
  };
}

function getActiveOutboundClickStorageProvider() {
  const config = getSupabaseOutboundClickConfig();

  return {
    storageMode: config.enabled ? "supabase" : "json",
    config,
  };
}

function getActiveBetaFeedbackStorageProvider() {
  const config = getSupabaseBetaFeedbackConfig();

  return {
    storageMode: config.enabled ? "supabase" : "json",
    config,
  };
}

function buildSupabaseTableUrl(config) {
  const baseUrl = new URL(config.supabaseUrl);
  return new URL(
    `/rest/v1/${encodeURIComponent(config.table)}`,
    `${baseUrl.origin}/`
  );
}

function getSupabaseHeaders(config, extraHeaders = {}) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extraHeaders,
  };
}

async function fetchSupabaseJson(url, options = {}) {
  const {
    logLabel = "waitlist",
    errorLabel = "waitlist",
    ...fetchOptions
  } = options;
  const target = getSupabaseTargetInfo(url);
  let response;

  try {
    response = await fetch(url, fetchOptions);
  } catch (error) {
    console.error(`[${logLabel}] Supabase fetch failed`, {
      errorName: error?.name,
      errorMessage: error?.message,
      causeCode: error?.cause?.code,
      causeMessage: error?.cause?.message,
      causeErrno: error?.cause?.errno,
      causeSyscall: error?.cause?.syscall,
      targetHost: target.host,
      targetPath: target.path,
    });
    throw error;
  }

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    console.error(`[${logLabel}] Supabase non-2xx response`, {
      status: response.status,
      responseBody: payload,
      targetHost: target.host,
      targetPath: target.path,
    });

    const errorMessage =
      payload?.message ||
      payload?.error ||
      (typeof payload === "string" ? payload : "") ||
      `HTTP ${response.status}`;
    const error = new Error(`Supabase ${errorLabel} request failed: ${errorMessage}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function mapSupabaseWaitlistRow(row) {
  return {
    email: normalizeWaitlistEmail(row?.email),
    source: normalizeWaitlistSource(row?.source),
    createdAt: String(row?.created_at || row?.createdAt || new Date().toISOString()),
  };
}

async function findSupabaseWaitlistSubmission(config, email) {
  const url = buildSupabaseTableUrl(config);
  url.searchParams.set("select", "email,source,created_at");
  url.searchParams.set("email", `eq.${normalizeWaitlistEmail(email)}`);
  url.searchParams.set("limit", "1");

  const rows = await fetchSupabaseJson(url, {
    headers: getSupabaseHeaders(config),
  });

  return Array.isArray(rows) && rows[0]
    ? mapSupabaseWaitlistRow(rows[0])
    : null;
}

async function readSupabaseWaitlistData(config = getSupabaseWaitlistConfig()) {
  const url = buildSupabaseTableUrl(config);
  url.searchParams.set("select", "email,source,created_at");
  url.searchParams.set("order", "created_at.asc");

  const rows = await fetchSupabaseJson(url, {
    headers: getSupabaseHeaders(config),
  });

  const submissions = (Array.isArray(rows) ? rows : [])
    .map(mapSupabaseWaitlistRow)
    .filter((submission) => isValidWaitlistEmail(submission.email));

  const latestSubmission = submissions[submissions.length - 1];

  return {
    version: 1,
    updatedAt: latestSubmission?.createdAt || new Date().toISOString(),
    submissions,
  };
}

async function addSupabaseWaitlistSubmission({
  email,
  source,
  config = getSupabaseWaitlistConfig(),
}) {
  const normalizedEmail = normalizeWaitlistEmail(email);
  const normalizedSource = normalizeWaitlistSource(source);
  const existing = await findSupabaseWaitlistSubmission(config, normalizedEmail);

  if (existing) {
    return {
      status: "existing",
      submission: existing,
      count: null,
    };
  }

  const url = buildSupabaseTableUrl(config);

  try {
    const rows = await fetchSupabaseJson(url, {
      method: "POST",
      headers: getSupabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify({
        email: normalizedEmail,
        source: normalizedSource,
      }),
    });

    const inserted = Array.isArray(rows) && rows[0]
      ? mapSupabaseWaitlistRow(rows[0])
      : {
          email: normalizedEmail,
          source: normalizedSource,
          createdAt: new Date().toISOString(),
        };

    return {
      status: "created",
      submission: inserted,
      count: null,
    };
  } catch (error) {
    if (error.status === 409) {
      const duplicate = await findSupabaseWaitlistSubmission(config, normalizedEmail);
      if (duplicate) {
        return {
          status: "existing",
          submission: duplicate,
          count: null,
        };
      }
    }

    throw error;
  }
}

async function addJsonWaitlistSubmission({ email, source }) {
  const normalizedEmail = normalizeWaitlistEmail(email);
  const normalizedSource = normalizeWaitlistSource(source);

  const task = async () => {
    const data = await readWaitlistData();
    const existing = data.submissions.find(
      (submission) => submission.email === normalizedEmail
    );

    if (existing) {
      return {
        status: "existing",
        submission: existing,
        count: data.submissions.length,
      };
    }

    const submission = {
      email: normalizedEmail,
      source: normalizedSource,
      createdAt: new Date().toISOString(),
    };

    data.submissions.push(submission);
    await writeWaitlistData(data);

    return {
      status: "created",
      submission,
      count: data.submissions.length,
    };
  };

  waitlistWriteQueue = waitlistWriteQueue.then(task, task);
  return waitlistWriteQueue;
}

async function addWaitlistSubmission({ email, source }) {
  const provider = getActiveWaitlistStorageProvider();
  const result =
    provider.storageMode === "supabase"
      ? await addSupabaseWaitlistSubmission({
          email,
          source,
          config: provider.config,
        })
      : await addJsonWaitlistSubmission({ email, source });

  return {
    ...result,
    storageMode: provider.storageMode,
  };
}

async function readWaitlistExportData() {
  const provider = getActiveWaitlistStorageProvider();
  const data =
    provider.storageMode === "supabase"
      ? await readSupabaseWaitlistData(provider.config)
      : await readWaitlistData();

  return {
    ...data,
    storageMode: provider.storageMode,
  };
}

function getLatestWaitlistSignupAt(submissions) {
  let latestTimestamp = 0;

  for (const submission of Array.isArray(submissions) ? submissions : []) {
    const timestamp = Date.parse(submission?.createdAt);
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }

  return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
}

async function readWaitlistStatusSummary() {
  const data = await readWaitlistExportData();
  const submissions = Array.isArray(data.submissions) ? data.submissions : [];

  return {
    storageMode: data.storageMode,
    waitlist: {
      count: submissions.length,
      latestSignupAt: getLatestWaitlistSignupAt(submissions),
    },
  };
}

function mapSupabaseAlertSignalRow(row) {
  return {
    alertType: normalizeAlertType(row?.alert_type ?? row?.alertType),
    marketQuestion: sanitizePublicAlertText(
      row?.market_question ?? row?.marketQuestion,
      280
    ),
    reason: sanitizeOptionalPublicAlertText(row?.reason, 400),
    severity: normalizeAlertSeverity(row?.severity),
    source: normalizeAlertSource(row?.source),
    createdAt: String(row?.created_at || row?.createdAt || new Date().toISOString()),
  };
}

async function addSupabaseAlertSignal({
  alertSignal,
  config = getSupabaseAlertSignalConfig(),
}) {
  const url = buildSupabaseTableUrl(config);

  const rows = await fetchSupabaseJson(url, {
    method: "POST",
    headers: getSupabaseHeaders(config, {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify({
      alert_type: alertSignal.alertType,
      market_question: alertSignal.marketQuestion,
      reason: alertSignal.reason,
      severity: alertSignal.severity,
      source: alertSignal.source,
    }),
    logLabel: "alert-signals",
    errorLabel: "alert signals",
  });

  return Array.isArray(rows) && rows[0]
    ? mapSupabaseAlertSignalRow(rows[0])
    : {
        ...alertSignal,
        createdAt: new Date().toISOString(),
      };
}

async function addAlertSignal(alertSignal) {
  const provider = getActiveAlertSignalStorageProvider();

  if (provider.storageMode !== "supabase") {
    const error = new Error("Alert signal storage is not configured.");
    error.status = 503;
    throw error;
  }

  const inserted = await addSupabaseAlertSignal({
    alertSignal,
    config: provider.config,
  });

  return {
    storageMode: provider.storageMode,
    alertSignal: inserted,
  };
}

async function readRecentSupabaseAlertSignals({
  limit = PUBLIC_ALERT_SIGNAL_LIMIT,
  config = getSupabaseAlertSignalConfig(),
} = {}) {
  const url = buildSupabaseTableUrl(config);
  url.searchParams.set(
    "select",
    "alert_type,market_question,reason,severity,source,created_at"
  );
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(limit));

  const rows = await fetchSupabaseJson(url, {
    headers: getSupabaseHeaders(config),
    logLabel: "alert-signals",
    errorLabel: "alert signals",
  });

  return (Array.isArray(rows) ? rows : [])
    .map(mapSupabaseAlertSignalRow)
    .filter((alertSignal) => alertSignal.alertType && alertSignal.marketQuestion);
}

async function readRecentAlertSignals(limit = PUBLIC_ALERT_SIGNAL_LIMIT) {
  const provider = getActiveAlertSignalStorageProvider();

  if (provider.storageMode !== "supabase") {
    return [];
  }

  const signals = await readRecentSupabaseAlertSignals({
    limit,
    config: provider.config,
  });

  return signals.map(toPublicAlertSignal);
}

function getLatestAlertSignalAt(signals) {
  let latestTimestamp = 0;

  for (const signal of Array.isArray(signals) ? signals : []) {
    const timestamp = Date.parse(signal?.createdAt);
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }

  return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
}

async function readAlertSignalStatusSummary() {
  const provider = getActiveAlertSignalStorageProvider();

  if (provider.storageMode !== "supabase") {
    return {
      alertSignals: {
        count: 0,
        latestAlertAt: null,
      },
      alertStorage: "not_configured",
    };
  }

  const url = buildSupabaseTableUrl(provider.config);
  url.searchParams.set("select", "created_at");
  url.searchParams.set("order", "created_at.desc");

  const rows = await fetchSupabaseJson(url, {
    headers: getSupabaseHeaders(provider.config),
    logLabel: "alert-signals",
    errorLabel: "alert signals",
  });

  const signals = (Array.isArray(rows) ? rows : []).map(mapSupabaseAlertSignalRow);

  return {
    alertSignals: {
      count: signals.length,
      latestAlertAt: getLatestAlertSignalAt(signals),
    },
    alertStorage: "ok",
  };
}

function mapSupabaseOutboundClickRow(row) {
  return {
    marketId: sanitizeOutboundClickText(row?.market_id ?? row?.marketId, 160),
    marketSlug: sanitizeOutboundClickText(row?.market_slug ?? row?.marketSlug, 220),
    marketQuestion: sanitizeOutboundClickText(
      row?.market_question ?? row?.marketQuestion,
      300
    ),
    marketUrl: normalizeOutboundMarketUrl(row?.market_url ?? row?.marketUrl),
    sourceSection: normalizeOutboundClickToken(
      row?.source_section ?? row?.sourceSection,
      "unknown-section",
      120
    ),
    cta: normalizeOutboundClickToken(row?.cta, "open-market", 120),
    createdAt: String(row?.created_at || row?.createdAt || new Date().toISOString()),
  };
}

async function addSupabaseOutboundClickEvent({
  clickEvent,
  config = getSupabaseOutboundClickConfig(),
}) {
  const url = buildSupabaseTableUrl(config);

  const rows = await fetchSupabaseJson(url, {
    method: "POST",
    headers: getSupabaseHeaders(config, {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify({
      market_id: clickEvent.marketId || null,
      market_slug: clickEvent.marketSlug || null,
      market_question: clickEvent.marketQuestion || null,
      market_url: clickEvent.marketUrl || null,
      source_section: clickEvent.sourceSection,
      cta: clickEvent.cta,
    }),
    logLabel: "outbound-clicks",
    errorLabel: "outbound click",
  });

  return Array.isArray(rows) && rows[0]
    ? mapSupabaseOutboundClickRow(rows[0])
    : {
        ...clickEvent,
        createdAt: new Date().toISOString(),
      };
}

async function addJsonOutboundClickEvent(clickEvent) {
  const task = async () => {
    const data = await readOutboundClickData();
    const event = {
      ...normalizeOutboundClickInput(clickEvent),
      createdAt: new Date().toISOString(),
    };

    data.events.push(event);
    await writeOutboundClickData(data);

    return {
      event,
      count: data.events.length,
    };
  };

  outboundClickWriteQueue = outboundClickWriteQueue.then(task, task);
  return outboundClickWriteQueue;
}

async function addOutboundClickEvent(clickEvent) {
  const provider = getActiveOutboundClickStorageProvider();
  const result =
    provider.storageMode === "supabase"
      ? {
          event: await addSupabaseOutboundClickEvent({
            clickEvent,
            config: provider.config,
          }),
          count: null,
        }
      : await addJsonOutboundClickEvent(clickEvent);

  return {
    ...result,
    storageMode: provider.storageMode,
  };
}

function getLatestOutboundClickAt(events) {
  let latestTimestamp = 0;

  for (const event of Array.isArray(events) ? events : []) {
    const timestamp = Date.parse(event?.createdAt);
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }

  return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
}

async function readJsonOutboundClickStatusSummary() {
  const data = await readOutboundClickData();
  const events = Array.isArray(data.events) ? data.events : [];

  return {
    outboundClicks: {
      count: events.length,
      latestClickAt: getLatestOutboundClickAt(events),
    },
    outboundClickStorage: "ok",
  };
}

async function readSupabaseOutboundClickStatusSummary(config) {
  const url = buildSupabaseTableUrl(config);
  url.searchParams.set("select", "created_at");
  url.searchParams.set("order", "created_at.desc");

  const rows = await fetchSupabaseJson(url, {
    headers: getSupabaseHeaders(config),
    logLabel: "outbound-clicks",
    errorLabel: "outbound clicks",
  });

  const events = (Array.isArray(rows) ? rows : []).map(mapSupabaseOutboundClickRow);

  return {
    outboundClicks: {
      count: events.length,
      latestClickAt: getLatestOutboundClickAt(events),
    },
    outboundClickStorage: "ok",
  };
}

async function readOutboundClickStatusSummary() {
  const provider = getActiveOutboundClickStorageProvider();

  try {
    if (provider.storageMode === "supabase") {
      return await readSupabaseOutboundClickStatusSummary(provider.config);
    }

    return await readJsonOutboundClickStatusSummary();
  } catch (error) {
    console.error("[outbound-clicks] Status read failed:", error.message);
    return {
      outboundClicks: {
        count: 0,
        latestClickAt: null,
      },
      outboundClickStorage: "error",
    };
  }
}

function mapSupabaseBetaFeedbackRow(row) {
  return {
    rating: normalizeBetaFeedbackRating(row?.rating),
    message: sanitizeBetaFeedbackText(row?.message, 2000),
    email: normalizeBetaFeedbackEmail(row?.email),
    source: normalizeBetaFeedbackSource(row?.source),
    createdAt: String(row?.created_at || row?.createdAt || new Date().toISOString()),
  };
}

async function addSupabaseBetaFeedback({
  feedback,
  config = getSupabaseBetaFeedbackConfig(),
}) {
  const url = buildSupabaseTableUrl(config);

  const rows = await fetchSupabaseJson(url, {
    method: "POST",
    headers: getSupabaseHeaders(config, {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify({
      rating: feedback.rating,
      message: feedback.message,
      email: feedback.email,
      source: feedback.source,
    }),
    logLabel: "beta-feedback",
    errorLabel: "beta feedback",
  });

  return Array.isArray(rows) && rows[0]
    ? mapSupabaseBetaFeedbackRow(rows[0])
    : {
        ...feedback,
        createdAt: new Date().toISOString(),
      };
}

async function addJsonBetaFeedback(feedback) {
  const task = async () => {
    const data = await readBetaFeedbackData();
    const item = {
      ...normalizeBetaFeedbackInput(feedback),
      createdAt: new Date().toISOString(),
    };

    data.feedback.push(item);
    await writeBetaFeedbackData(data);

    return {
      feedback: item,
      count: data.feedback.length,
    };
  };

  betaFeedbackWriteQueue = betaFeedbackWriteQueue.then(task, task);
  return betaFeedbackWriteQueue;
}

async function addBetaFeedback(feedback) {
  const provider = getActiveBetaFeedbackStorageProvider();

  if (provider.storageMode === "supabase") {
    try {
      const inserted = await addSupabaseBetaFeedback({
        feedback,
        config: provider.config,
      });

      return {
        feedback: inserted,
        count: null,
        storageMode: provider.storageMode,
      };
    } catch (error) {
      console.error("[beta-feedback] Supabase save failed; falling back to JSON:", error.message);
    }
  }

  const result = await addJsonBetaFeedback(feedback);
  return {
    ...result,
    storageMode: "json",
  };
}

function getLatestBetaFeedbackAt(feedback) {
  let latestTimestamp = 0;

  for (const item of Array.isArray(feedback) ? feedback : []) {
    const timestamp = Date.parse(item?.createdAt);
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }

  return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
}

async function readJsonBetaFeedbackStatusSummary() {
  const data = await readBetaFeedbackData();
  const feedback = Array.isArray(data.feedback) ? data.feedback : [];

  return {
    feedback: {
      count: feedback.length,
      latestFeedbackAt: getLatestBetaFeedbackAt(feedback),
    },
    feedbackStorage: "ok",
  };
}

async function readSupabaseBetaFeedbackStatusSummary(config) {
  const url = buildSupabaseTableUrl(config);
  url.searchParams.set("select", "created_at");
  url.searchParams.set("order", "created_at.desc");

  const rows = await fetchSupabaseJson(url, {
    headers: getSupabaseHeaders(config),
    logLabel: "beta-feedback",
    errorLabel: "beta feedback",
  });

  const feedback = (Array.isArray(rows) ? rows : []).map(mapSupabaseBetaFeedbackRow);

  return {
    feedback: {
      count: feedback.length,
      latestFeedbackAt: getLatestBetaFeedbackAt(feedback),
    },
    feedbackStorage: "ok",
  };
}

async function readBetaFeedbackStatusSummary() {
  const provider = getActiveBetaFeedbackStorageProvider();

  try {
    if (provider.storageMode === "supabase") {
      return await readSupabaseBetaFeedbackStatusSummary(provider.config);
    }

    return await readJsonBetaFeedbackStatusSummary();
  } catch (error) {
    console.error("[beta-feedback] Status read failed:", error.message);
    if (provider.storageMode === "supabase") {
      try {
        const fallbackSummary = await readJsonBetaFeedbackStatusSummary();
        return {
          feedback: fallbackSummary.feedback,
          feedbackStorage: "json_fallback",
        };
      } catch (fallbackError) {
        console.error("[beta-feedback] JSON fallback status read failed:", fallbackError.message);
      }
    }

    return {
      feedback: {
        count: 0,
        latestFeedbackAt: null,
      },
      feedbackStorage: "error",
    };
  }
}

function getAdminSecret() {
  return envFirst("PBP_ADMIN_SECRET");
}

function getProvidedAdminSecret(req) {
  const authorizationHeader = String(req.get("authorization") || "").trim();

  if (/^bearer\s+/i.test(authorizationHeader)) {
    return authorizationHeader.replace(/^bearer\s+/i, "").trim();
  }

  if (authorizationHeader) {
    return authorizationHeader;
  }

  return String(
    req.query?.secret ||
      req.query?.adminSecret ||
      req.query?.admin_secret ||
      ""
  ).trim();
}

function secretsMatch(providedSecret, expectedSecret) {
  if (!providedSecret || !expectedSecret) return false;

  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);

  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

function authorizeAdminRequest(req, res) {
  const expectedSecret = getAdminSecret();

  if (!expectedSecret) {
    res.status(503).json({
      ok: false,
      error: "Admin waitlist export is not configured.",
    });
    return false;
  }

  const providedSecret = getProvidedAdminSecret(req);
  if (!secretsMatch(providedSecret, expectedSecret)) {
    res.status(401).json({
      ok: false,
      error: "Unauthorized.",
    });
    return false;
  }

  return true;
}

function getAlertIngestSecret() {
  return envFirst("PBP_ALERT_INGEST_SECRET");
}

function getProvidedBearerToken(req) {
  const authorizationHeader = String(req.get("authorization") || "").trim();

  if (!/^bearer\s+/i.test(authorizationHeader)) {
    return "";
  }

  return authorizationHeader.replace(/^bearer\s+/i, "").trim();
}

function authorizeAlertIngestRequest(req, res) {
  const expectedSecret = getAlertIngestSecret();

  if (!expectedSecret) {
    res.status(503).json({
      ok: false,
      error: "Alert ingestion is not configured.",
    });
    return false;
  }

  const providedSecret = getProvidedBearerToken(req);
  if (!secretsMatch(providedSecret, expectedSecret)) {
    res.status(401).json({
      ok: false,
      error: "Unauthorized.",
    });
    return false;
  }

  return true;
}

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function envFlag(...names) {
  const value = envFirst(...names);
  return /^(1|true|yes|on)$/i.test(value);
}

function envNumber(defaultValue, ...names) {
  const value = envFirst(...names);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : defaultValue;
}

function getBuilderConfig() {
  const builderApiKey = envFirst(
    "POLY_BUILDER_API_KEY",
    "PBP_BUILDER_API_KEY",
    "POLYMARKET_BUILDER_API_KEY",
    "BUILDER_API_KEY"
  );

  const builderApiSecret = envFirst(
    "POLY_BUILDER_SECRET",
    "PBP_BUILDER_API_SECRET",
    "POLYMARKET_BUILDER_API_SECRET",
    "BUILDER_API_SECRET"
  );

  const builderApiPassphrase = envFirst(
    "POLY_BUILDER_PASSPHRASE",
    "PBP_BUILDER_API_PASSPHRASE",
    "POLYMARKET_BUILDER_API_PASSPHRASE",
    "BUILDER_API_PASSPHRASE"
  );

  const relayerUrl = envFirst(
    "POLYMARKET_RELAYER_BASE_URL",
    "PBP_RELAYER_URL",
    "POLYMARKET_RELAYER_URL",
    "BUILDER_RELAYER_URL",
    "RELAYER_URL"
  );

  const builderProfileId = envFirst(
    "PBP_BUILDER_PROFILE_ID",
    "POLYMARKET_BUILDER_PROFILE_ID",
    "BUILDER_PROFILE_ID"
  );

  const builderName = envFirst(
    "PBP_BUILDER_NAME",
    "POLYMARKET_BUILDER_NAME",
    "BUILDER_NAME"
  );

  const builderApiConfigured = !!(
    builderApiKey &&
    builderApiSecret &&
    builderApiPassphrase
  );

  const liveRoutingRequested = envFlag(
    "PBP_ENABLE_BUILDER_LIVE_ROUTING",
    "PBP_LIVE_ROUTING_ENABLED",
    "POLYMARKET_LIVE_ROUTING_ENABLED",
    "LIVE_ROUTING_ENABLED"
  );

  const relayerExplicitReady = envFlag(
    "PBP_RELAYER_READY",
    "POLYMARKET_RELAYER_READY",
    "RELAYER_READY"
  );

  const relayerReady =
    relayerExplicitReady || !!relayerUrl || liveRoutingRequested;

  const liveRoutingEnabled = liveRoutingRequested || relayerReady;

  const signedOrderHandoffEnabled =
    envFirst(
      "PBP_SIGNED_ORDER_HANDOFF_ENABLED",
      "POLYMARKET_SIGNED_ORDER_HANDOFF_ENABLED",
      "SIGNED_ORDER_HANDOFF_ENABLED"
    ) === ""
      ? true
      : envFlag(
          "PBP_SIGNED_ORDER_HANDOFF_ENABLED",
          "POLYMARKET_SIGNED_ORDER_HANDOFF_ENABLED",
          "SIGNED_ORDER_HANDOFF_ENABLED"
        );

  const realLiveSubmitEnabled = envFlag(
    "PBP_ENABLE_REAL_LIVE_SUBMIT",
    "PBP_REAL_LIVE_SUBMIT_ENABLED",
    "POLYMARKET_REAL_LIVE_SUBMIT_ENABLED",
    "REAL_LIVE_SUBMIT_ENABLED"
  );

  const maxRealSubmitDollars = envNumber(
    25,
    "PBP_MAX_REAL_SUBMIT_DOLLARS",
    "PBP_REAL_LIVE_SUBMIT_MAX_DOLLARS",
    "POLYMARKET_REAL_LIVE_SUBMIT_MAX_DOLLARS",
    "REAL_LIVE_SUBMIT_MAX_DOLLARS"
  );

  const confirmText =
    envFirst(
      "PBP_REAL_SUBMIT_CONFIRM_TEXT",
      "PBP_REAL_LIVE_SUBMIT_CONFIRM_TEXT",
      "POLYMARKET_REAL_LIVE_SUBMIT_CONFIRM_TEXT",
      "REAL_LIVE_SUBMIT_CONFIRM_TEXT"
    ) || "CONFIRM LIVE SUBMIT";

  return {
    builderApiConfigured,
    relayerReady,
    liveRoutingEnabled,
    signedOrderHandoffEnabled,
    realLiveSubmitEnabled,
    maxRealSubmitDollars,
    confirmText,
    relayerUrl,
    builderProfileId,
    builderName,
    builderConfigSource: "SERVER_ENV",
  };
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstFinite(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeCategoryLabel(value) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[_/]+/g, " ")
    .trim();

  if (!cleaned) return "";

  const lower = cleaned.toLowerCase();

  const exactMap = {
    politics: "Politics",
    political: "Politics",
    election: "Politics",
    elections: "Politics",
    government: "Politics",
    policy: "Politics",

    sports: "Sports",
    sport: "Sports",
    nba: "Sports",
    wnba: "Sports",
    nfl: "Sports",
    mlb: "Sports",
    nhl: "Sports",
    soccer: "Sports",
    football: "Sports",
    baseball: "Sports",
    basketball: "Sports",
    tennis: "Sports",
    golf: "Sports",
    boxing: "Sports",
    mma: "Sports",
    ufc: "Sports",

    business: "Business",
    finance: "Business",
    financial: "Business",
    economy: "Business",
    economic: "Business",
    macro: "Business",

    world: "World",
    international: "World",
    geopolitics: "World",
    geopolitical: "World",
    global: "World",

    entertainment: "Culture",
    culture: "Culture",
    popculture: "Culture",
    "pop culture": "Culture",
    pop: "Culture",
    celebrity: "Culture",
    celebrities: "Culture",

    crypto: "Crypto",
    cryptocurrency: "Crypto",
    bitcoin: "Crypto",
    ethereum: "Crypto",
    blockchain: "Crypto",
    web3: "Crypto",

    news: "News",
    currentevents: "News",
    current: "News",
    headlines: "News",
  };

  if (exactMap[lower]) return exactMap[lower];

  for (const rule of DIRECT_SOURCE_CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(lower))) {
      return rule.category;
    }
  }

  return titleCase(cleaned);
}

function isGenericCategoryValue(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .trim();

  return GENERIC_CATEGORY_VALUES.has(normalized);
}

function isTopLevelCategory(value) {
  return TRUSTED_TOP_LEVEL_CATEGORIES.has(String(value || "").trim());
}

function isMeaningfulCategory(value) {
  const normalized = normalizeCategoryLabel(value);
  if (!normalized) return false;
  return isTopLevelCategory(normalized);
}

function parseStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean);
      }
    } catch {}

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function parseNumberArray(value) {
  return parseStringArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function parseTagLabels(raw) {
  const tags = [];

  const appendTag = (input) => {
    if (!input) return;
    if (Array.isArray(input)) {
      input.forEach(appendTag);
      return;
    }
    if (typeof input === "object") {
      if (input.label) tags.push(String(input.label));
      else if (input.slug) tags.push(String(input.slug));
      return;
    }
    if (typeof input === "string") tags.push(input);
  };

  appendTag(raw?.tags);
  appendTag(raw?.events?.flatMap((event) => event?.tags || []));
  appendTag(raw?.categories);

  return tags;
}

function normalizeTrustedCategoryCandidate(value) {
  if (isGenericCategoryValue(value)) return "";
  const normalized = normalizeCategoryLabel(value);
  return isMeaningfulCategory(normalized) ? normalized : "";
}

function classifySourceCategoryText(value) {
  const raw = String(value || "").trim();
  if (!raw || isGenericCategoryValue(raw)) return "";

  const normalized = normalizeCategoryLabel(raw);
  if (isTopLevelCategory(normalized)) return normalized;

  const lower = raw.toLowerCase();

  for (const rule of DIRECT_SOURCE_CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(lower))) {
      return rule.category;
    }
  }

  return "";
}

function getDirectSourceCategory(raw) {
  const directCandidates = [
    raw?.category,
    raw?.events?.[0]?.category,
    raw?.events?.[0]?.subcategory,
    ...(Array.isArray(raw?.categories)
      ? raw.categories.flatMap((category) => [
          category?.label,
          category?.slug,
          category,
        ])
      : []),
  ];

  for (const candidate of directCandidates) {
    const classified = classifySourceCategoryText(candidate);
    if (classified) return classified;
  }

  return "";
}

function getTagHintCategory(raw) {
  const tagCategories = [
    ...new Set(
      parseTagLabels(raw)
        .map((tag) => classifySourceCategoryText(tag))
        .filter(Boolean)
    ),
  ];

  if (tagCategories.length === 1) {
    return tagCategories[0];
  }

  if (
    tagCategories.length === 2 &&
    tagCategories.includes("News") &&
    tagCategories.some((category) => category !== "News")
  ) {
    return tagCategories.find((category) => category !== "News") || "";
  }

  return "";
}

function buildCategoryText(raw) {
  return [
    raw?.question,
    raw?.description,
    raw?.groupItemTitle,
    raw?.category,
    raw?.events?.[0]?.category,
    raw?.events?.[0]?.subcategory,
    raw?.events?.[0]?.title,
    raw?.events?.[0]?.subtitle,
    raw?.events?.[0]?.description,
    ...(Array.isArray(raw?.categories)
      ? raw.categories.map(
          (category) => category?.label || category?.slug || category
        )
      : []),
    ...parseTagLabels(raw),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreRegexMatches(text, patterns) {
  return patterns.reduce(
    (sum, pattern) => sum + (pattern.test(text) ? 1 : 0),
    0
  );
}

function scoreCategoryHeuristics(text) {
  const scores = {
    Politics: scoreRegexMatches(text, [
      /\b(election|elections|primary|president|presidential|senate|house|governor|mayor|congress|parliament)\b/,
      /\b(trump|biden|democrat|democrats|republican|republicans|labour|conservative|campaign)\b/,
      /\b(vote|voting|ballot|polls?|administration|cabinet|referendum)\b/,
    ]),
    Sports: scoreRegexMatches(text, [
      /\b(nba|wnba|nfl|mlb|nhl|ufc|mma|fifa|uefa|atp|wta|pga|ncaa|olympics?|formula 1|grand prix)\b/,
      /\b(soccer|football|baseball|basketball|hockey|tennis|golf|boxing|cricket|rugby)\b/,
      /\b(match|game|games|tournament|final|semifinal|quarterfinal|playoff|championship|super bowl|world cup|season opener)\b/,
      /\b(vs|vs\.|beat|beats|defeat|defeats|wins?|score|scores|fight night)\b/,
    ]),
    Business: scoreRegexMatches(text, [
      /\b(fed|inflation|cpi|ppi|gdp|recession|rate cut|rate cuts|interest rates?|yield|yields)\b/,
      /\b(earnings|revenue|guidance|stocks?|shares?|ipo)\b/,
      /\b(tariff|tariffs|economy|economic|macro|treasury|bond market|banking)\b/,
      /\b(company|companies)\b/,
    ]),
    World: scoreRegexMatches(text, [
      /\b(ukraine|russia|china|taiwan|israel|gaza|iran|europe|eu|nato)\b/,
      /\b(prime minister|foreign minister|ceasefire|war|conflict|sanctions|border)\b/,
      /\b(country|countries|international|global|treaty)\b/,
    ]),
    Culture: scoreRegexMatches(text, [
      /\b(movie|film|tv|television|series|season finale|album|music|artist|actor|actress)\b/,
      /\b(oscar|oscars|grammy|grammys|emmy|emmys|box office)\b/,
      /\b(celebrity|hollywood|reality show|netflix)\b/,
    ]),
    Crypto: scoreRegexMatches(text, [
      /\b(bitcoin|btc|ethereum|eth|solana|dogecoin|doge|xrp|litecoin|cardano|avalanche|avax)\b/,
      /\b(crypto|cryptocurrency|blockchain|web3|defi|nft|nfts|memecoin|stablecoin|onchain)\b/,
      /\b(spot bitcoin|spot ether|ethereum etf|bitcoin etf)\b/,
    ]),
  };

  if (scores.Sports > 0) scores.Crypto = Math.max(0, scores.Crypto - 4);
  if (scores.Politics > 0) scores.Crypto = Math.max(0, scores.Crypto - 3);
  if (scores.Business > 0) scores.Crypto = Math.max(0, scores.Crypto - 2);
  if (scores.World > 0) scores.Crypto = Math.max(0, scores.Crypto - 3);
  if (scores.Culture > 0) scores.Crypto = Math.max(0, scores.Crypto - 3);

  return scores;
}

function hasExplicitCryptoAssetMention(text) {
  return /\b(bitcoin|btc|ethereum|eth|solana|dogecoin|doge|xrp|litecoin|cardano|avalanche|avax|crypto|cryptocurrency|blockchain|web3|defi|nft|nfts|memecoin|stablecoin)\b/.test(
    text
  );
}

function applySourceCategorySafetyOverride(sourceCategory, raw) {
  if (!sourceCategory) return "";

  const text = buildCategoryText(raw);
  const scores = scoreCategoryHeuristics(text);

  if (sourceCategory === "Crypto") {
    if (scores.Sports >= 2) return "Sports";
    if (scores.Politics >= 2) return "Politics";
    if (scores.Culture >= 2) return "Culture";
    if (scores.World >= 2 && scores.Crypto <= 1) return "World";
    if (scores.Business >= 2 && scores.Crypto <= 1) return "Business";
  }

  return sourceCategory;
}

function deriveCategory(raw) {
  const directSourceCategory = applySourceCategorySafetyOverride(
    getDirectSourceCategory(raw),
    raw
  );
  if (directSourceCategory) return directSourceCategory;

  const tagHintCategory = applySourceCategorySafetyOverride(
    getTagHintCategory(raw),
    raw
  );
  if (tagHintCategory) return tagHintCategory;

  const text = buildCategoryText(raw);
  const scores = scoreCategoryHeuristics(text);

  const strongSports = scores.Sports >= 2;
  const strongPolitics = scores.Politics >= 2;
  const strongBusiness = scores.Business >= 2;
  const strongWorld = scores.World >= 2;
  const strongCulture = scores.Culture >= 2;
  const strongCrypto =
    scores.Crypto >= 3 &&
    hasExplicitCryptoAssetMention(text) &&
    !strongSports &&
    !strongPolitics &&
    !strongCulture &&
    scores.Crypto >= scores.Business + 1 &&
    scores.Crypto >= scores.World + 1;

  if (strongSports) return "Sports";
  if (strongPolitics) return "Politics";

  if (
    strongWorld &&
    scores.World >= Math.max(scores.Business, scores.Crypto, scores.Culture)
  ) {
    return "World";
  }

  if (
    strongCulture &&
    scores.Culture >= Math.max(scores.Business, scores.Crypto, scores.World)
  ) {
    return "Culture";
  }

  if (strongBusiness && !strongSports && !strongPolitics) {
    return "Business";
  }

  if (strongCrypto) {
    return "Crypto";
  }

  return "News";
}

function parseIsoTimestamp(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function isExplicitTrue(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    return ["true", "1", "yes"].includes(value.trim().toLowerCase());
  }
  return false;
}

function isExplicitFalse(value) {
  if (value === false || value === 0) return true;
  if (typeof value === "string") {
    return ["false", "0", "no"].includes(value.trim().toLowerCase());
  }
  return false;
}

function readBooleanFlag(value, fallback = false) {
  if (isExplicitTrue(value)) return true;
  if (isExplicitFalse(value)) return false;
  return fallback;
}

function newestIso(...values) {
  let bestTs = null;
  let bestValue = "";

  for (const value of values.flat()) {
    const ts = parseIsoTimestamp(value);
    if (ts !== null && (bestTs === null || ts > bestTs)) {
      bestTs = ts;
      bestValue = new Date(ts).toISOString();
    }
  }

  return bestValue;
}

function normalizeMarketQuestion(raw) {
  return String(
    raw?.question ||
      raw?.title ||
      raw?.groupItemTitle ||
      raw?.events?.[0]?.title ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function hasUsableMarketQuestion(value) {
  const question = String(value || "").replace(/\s+/g, " ").trim();
  if (!question) return false;
  return !/^(untitled|untitled market|unknown|n\/a|na|null|undefined)$/i.test(
    question
  );
}

function getMarketStatusText(raw) {
  return String(
    raw?.status ||
      raw?.marketStatus ||
      raw?.resolutionStatus ||
      raw?.events?.[0]?.status ||
      raw?.events?.[0]?.resolutionStatus ||
      ""
  )
    .trim()
    .toLowerCase();
}

function hasResolvedStatus(raw) {
  const status = getMarketStatusText(raw);
  return /^(resolved|settled|final|finalized|cancelled|canceled)$/i.test(status);
}

function hasClosedStatus(raw) {
  const status = getMarketStatusText(raw);
  return /^(closed|ended|expired|inactive|disabled)$/i.test(status);
}

function getMarketEndDate(raw) {
  return newestIso(
    raw?.endDate,
    raw?.endDateIso,
    raw?.end_date,
    raw?.closeTime,
    raw?.closedTime,
    raw?.events?.map((event) => event?.endDate),
    raw?.events?.map((event) => event?.endDateIso),
    raw?.events?.map((event) => event?.end_date),
    raw?.events?.map((event) => event?.closeTime),
    raw?.events?.map((event) => event?.closedTime)
  );
}

function hasClearlyEndedByTime(raw) {
  const endTs = parseIsoTimestamp(getMarketEndDate(raw));
  return endTs !== null && Date.now() - endTs > MARKET_END_GRACE_MS;
}

function getMarketDataFreshness(lastUpdated) {
  const updatedTs = parseIsoTimestamp(lastUpdated);
  if (updatedTs === null) return "unknown";

  const ageMs = Date.now() - updatedTs;
  if (ageMs < 0) return "unknown";
  if (ageMs <= MARKET_FRESH_MS) return "fresh";
  if (ageMs > MARKET_STALE_MS) return "stale";
  return "unknown";
}

function normalizeOneDayPriceChange(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) return 0;
  if (Math.abs(numeric) > 1.5) return numeric / 100;
  return numeric;
}

function findOutcomeIndex(outcomes, matcher) {
  return outcomes.findIndex((value) =>
    matcher.test(String(value || "").trim())
  );
}

function inferYesNoPrices(raw, outcomes, outcomePrices) {
  const yesIndex = findOutcomeIndex(outcomes, /^yes$/i);
  const noIndex = findOutcomeIndex(outcomes, /^no$/i);

  let yesPrice = yesIndex >= 0 ? outcomePrices[yesIndex] : null;
  let noPrice = noIndex >= 0 ? outcomePrices[noIndex] : null;

  const bestBid = toNumber(raw?.bestBid ?? raw?.best_bid);
  const bestAsk = toNumber(raw?.bestAsk ?? raw?.best_ask);
  const lastTradePrice = toNumber(raw?.lastTradePrice);

  const midpoint =
    Number.isFinite(bestBid) &&
    Number.isFinite(bestAsk) &&
    bestBid >= 0 &&
    bestAsk >= 0
      ? (bestBid + bestAsk) / 2
      : null;

  const fallbackPrice = firstFinite(midpoint, lastTradePrice);

  if (!Number.isFinite(yesPrice) && Number.isFinite(fallbackPrice)) {
    yesPrice = fallbackPrice;
  }

  if (!Number.isFinite(noPrice) && Number.isFinite(yesPrice)) {
    noPrice = clamp(1 - yesPrice, 0, 1);
  }

  return {
    yesIndex,
    noIndex,
    yesPrice: Number.isFinite(yesPrice) ? clamp(yesPrice, 0, 1) : null,
    noPrice: Number.isFinite(noPrice) ? clamp(noPrice, 0, 1) : null,
    bestBid,
    bestAsk,
    lastTradePrice,
    midpoint: Number.isFinite(midpoint) ? clamp(midpoint, 0, 1) : null,
  };
}

function calculateConfidenceAndSignal(market) {
  const volumeScore = clamp(
    Math.log10((market.volume24hr || 0) + 1) * 8,
    0,
    32
  );
  const liquidityScore = clamp(
    Math.log10((market.liquidity || 0) + 1) * 7,
    0,
    28
  );

  const spread =
    Number.isFinite(market.bestBid) && Number.isFinite(market.bestAsk)
      ? Math.max(0, market.bestAsk - market.bestBid)
      : null;

  const spreadScore = spread === null ? 6 : clamp((0.1 - spread) * 140, 0, 18);

  const moveScore = clamp(
    Math.abs(market.oneDayPriceChange || 0) * 180,
    0,
    14
  );

  const lastUpdatedTs = parseIsoTimestamp(market.lastUpdated);
  const freshnessHours =
    lastUpdatedTs === null ? 9999 : (Date.now() - lastUpdatedTs) / 3_600_000;

  const freshnessScore =
    freshnessHours <= 6
      ? 10
      : freshnessHours <= 24
        ? 7
        : freshnessHours <= 72
          ? 4
          : 1;
  const stalePenalty = freshnessHours > 72 ? 14 : 0;

  const confidenceScore = Math.round(
    clamp(
      volumeScore + liquidityScore + spreadScore + moveScore + freshnessScore - stalePenalty,
      5,
      98
    )
  );

  let actionSignal = "WATCH";
  if (
    confidenceScore >= 70 &&
    Number.isFinite(market.oneDayPriceChange) &&
    market.oneDayPriceChange >= 0.03 &&
    Number.isFinite(market.yesPriceLive) &&
    market.yesPriceLive >= 0.12 &&
    market.yesPriceLive <= 0.88
  ) {
    actionSignal = "BUY YES";
  } else if (
    confidenceScore >= 70 &&
    Number.isFinite(market.oneDayPriceChange) &&
    market.oneDayPriceChange <= -0.03 &&
    Number.isFinite(market.yesPriceLive) &&
    market.yesPriceLive >= 0.12 &&
    market.yesPriceLive <= 0.88
  ) {
    actionSignal = "BUY NO";
  }

  const hasHighVolume = (market.volume24hr || 0) >= 100_000;
  const hasStrongLiquidity = (market.liquidity || 0) >= 100_000;
  const hasMeaningfulMove = Math.abs(market.oneDayPriceChange || 0) >= 0.03;
  const isRecentlyUpdated = freshnessHours <= 24;
  const isFresh = freshnessHours <= 6;
  const isStale = freshnessHours > 72;

  let marketSignal = "Worth watching";
  if (hasMeaningfulMove && (hasHighVolume || hasStrongLiquidity)) {
    marketSignal = "Moving market";
  } else if (hasHighVolume && hasStrongLiquidity) {
    marketSignal = "High activity";
  } else if (hasStrongLiquidity) {
    marketSignal = "Strong liquidity";
  } else if (isRecentlyUpdated && (market.volume24hr || market.liquidity)) {
    marketSignal = "Fresh activity";
  }

  let displayReason = "High activity makes this market worth watching.";
  if (hasMeaningfulMove && (hasHighVolume || hasStrongLiquidity)) {
    displayReason = "Recent movement suggests traders are repricing new information.";
  } else if (hasHighVolume && hasStrongLiquidity) {
    displayReason = "High volume and strong liquidity make this market easier to evaluate.";
  } else if (hasStrongLiquidity) {
    displayReason = "Strong liquidity may make this market easier to enter or exit.";
  } else if (isFresh && (market.volume24hr || market.liquidity)) {
    displayReason = "Newer active market with rising attention.";
  } else if (hasHighVolume) {
    displayReason = "High activity makes this market worth watching.";
  } else if (isStale) {
    displayReason = "Market activity is available, but freshness is limited.";
  }

  const opportunityScore = Math.round(
    clamp(
      confidenceScore +
        (hasHighVolume ? 8 : 0) +
        (hasStrongLiquidity ? 8 : 0) +
        (hasMeaningfulMove ? 10 : 0) +
        (isRecentlyUpdated ? 4 : 0) -
        stalePenalty,
      1,
      100
    )
  );

  return {
    confidenceScore,
    opportunityScore,
    actionSignal,
    actionReason: displayReason,
    displayReason,
    marketReason: displayReason,
    marketSignal,
    freshnessHours: Number.isFinite(freshnessHours)
      ? roundTo(freshnessHours, 2)
      : null,
    hotScore: Math.round(
      (market.volume24hr || 0) * 0.45 +
        (market.liquidity || 0) * 0.35 +
        opportunityScore * 1200 +
        Math.abs(market.oneDayPriceChange || 0) * 120_000 -
        stalePenalty * 3000
    ),
  };
}

function buildMarketUrl(raw) {
  const eventSlug = raw?.events?.[0]?.slug;
  const slug = raw?.slug || eventSlug || raw?.id;
  return `https://polymarket.com/event/${encodeURIComponent(eventSlug || slug)}`;
}

function normalizeMarket(raw) {
  const outcomes = parseStringArray(raw?.outcomes);
  const outcomePrices = parseNumberArray(raw?.outcomePrices);
  const tokenIds = parseStringArray(raw?.clobTokenIds);
  const question = normalizeMarketQuestion(raw);

  const prices = inferYesNoPrices(raw, outcomes, outcomePrices);

  const volume = firstFinite(
    toNumber(raw?.volumeNum),
    toNumber(raw?.volumeClob),
    toNumber(raw?.volume),
    0
  );

  const volume24hr = firstFinite(
    toNumber(raw?.volume24hrClob),
    toNumber(raw?.volume24hr),
    toNumber(raw?.events?.[0]?.volume24hr),
    0
  );

  const liquidity = firstFinite(
    toNumber(raw?.liquidityClob),
    toNumber(raw?.liquidityNum),
    toNumber(raw?.liquidity),
    toNumber(raw?.events?.[0]?.liquidity),
    0
  );

  const category = deriveCategory(raw);
  const oneDayPriceChange = normalizeOneDayPriceChange(raw?.oneDayPriceChange);

  const lastUpdated = newestIso(
    raw?.updatedAt,
    raw?.acceptingOrdersTimestamp,
    raw?.readyTimestamp,
    raw?.fundedTimestamp,
    raw?.published_at,
    raw?.events?.map((event) => event?.updatedAt),
    raw?.events?.map((event) => event?.published_at),
    raw?.events?.map((event) => event?.creationDate),
    raw?.createdAt
  );

  const active =
    isExplicitFalse(raw?.active) || isExplicitFalse(raw?.events?.[0]?.active)
      ? false
      : true;
  const closed =
    isExplicitTrue(raw?.closed) ||
    isExplicitTrue(raw?.events?.[0]?.closed) ||
    hasClosedStatus(raw);
  const archived =
    isExplicitTrue(raw?.archived) || isExplicitTrue(raw?.events?.[0]?.archived);
  const resolved =
    isExplicitTrue(raw?.resolved) ||
    isExplicitTrue(raw?.isResolved) ||
    isExplicitTrue(raw?.events?.[0]?.resolved) ||
    hasResolvedStatus(raw);
  const ended =
    isExplicitTrue(raw?.ended) ||
    isExplicitTrue(raw?.isEnded) ||
    isExplicitTrue(raw?.events?.[0]?.ended) ||
    hasClearlyEndedByTime(raw);

  const normalized = {
    id: String(raw?.id || raw?.conditionId || raw?.slug || ""),
    question,
    slug: String(raw?.slug || raw?.id || ""),
    url: buildMarketUrl(raw),
    category,
    active,
    closed,
    archived,
    resolved,
    ended,
    acceptingOrders: readBooleanFlag(raw?.acceptingOrders, true),
    liquidity: roundTo(liquidity, 2) || 0,
    volume: roundTo(volume, 2) || 0,
    volume24hr: roundTo(volume24hr, 2) || 0,
    yesPrice: prices.yesPrice,
    noPrice: prices.noPrice,
    yesPriceLive: prices.yesPrice,
    noPriceLive: prices.noPrice,
    oneDayPriceChange,
    lastUpdated,
    dataSource: "gamma",
    dataFreshness: getMarketDataFreshness(lastUpdated),
    outcomes,
    outcomePrices,
    tokenIds,
    yesOutcomeIndex: prices.yesIndex,
    noOutcomeIndex: prices.noIndex,
    bestBid: prices.bestBid,
    bestAsk: prices.bestAsk,
    midpoint: prices.midpoint,
    lastTradePrice: prices.lastTradePrice,
    negRisk: !!raw?.negRisk || !!raw?.events?.[0]?.negRisk,
    tickSize: firstFinite(
      toNumber(raw?.orderPriceMinTickSize),
      toNumber(raw?.tickSize),
      0.01
    ),
    minOrderSize: firstFinite(
      toNumber(raw?.orderMinSize),
      toNumber(raw?.minOrderSize),
      1
    ),
    eventTitle: raw?.events?.[0]?.title || "",
    eventSlug: raw?.events?.[0]?.slug || "",
    raw,
  };

  const signalBits = calculateConfidenceAndSignal(normalized);

  return {
    ...normalized,
    ...signalBits,
  };
}

function isLiveMarketCandidate(market) {
  if (!market || !market.id || !hasUsableMarketQuestion(market.question)) {
    return false;
  }
  if (market.active === false) return false;
  if (market.acceptingOrders === false) return false;
  if (market.closed || market.archived || market.resolved || market.ended) {
    return false;
  }
  return true;
}

function updatePriceMemory(markets) {
  const now = Date.now();

  for (const market of markets) {
    if (!Number.isFinite(market.yesPriceLive)) continue;

    const existing = priceMemoryByMarketId.get(market.id) || [];
    const lastPoint = existing[existing.length - 1];

    if (
      !lastPoint ||
      now - lastPoint.t >= PRICE_MEMORY_MIN_SAMPLE_GAP_MS ||
      Math.abs(lastPoint.p - market.yesPriceLive) >= 0.002
    ) {
      existing.push({
        t: now,
        p: roundTo(market.yesPriceLive, 4),
      });
    }

    const trimmed = existing.filter(
      (point) => now - point.t <= PRICE_MEMORY_WINDOW_MS
    );
    priceMemoryByMarketId.set(market.id, trimmed);
  }
}

function computeMoverForMarket(market) {
  if (!Number.isFinite(market.yesPriceLive)) return null;

  const history = priceMemoryByMarketId.get(market.id) || [];
  const now = Date.now();
  const sixHoursAgo = now - 6 * 60 * 60 * 1000;
  const targetPoint =
    history.find((point) => point.t >= sixHoursAgo) || history[0];

  let pastPrice = Number.isFinite(targetPoint?.p) ? targetPoint.p : null;

  if (
    (!Number.isFinite(pastPrice) ||
      history.length < 2 ||
      Math.abs(market.yesPriceLive - pastPrice) < 0.002) &&
    Number.isFinite(market.oneDayPriceChange) &&
    Number.isFinite(market.yesPriceLive - market.oneDayPriceChange)
  ) {
    const sourcePast = clamp(
      market.yesPriceLive - market.oneDayPriceChange,
      0.01,
      0.99
    );
    pastPrice = sourcePast;
  }

  if (!Number.isFinite(pastPrice)) return null;

  const priceChange = roundTo(market.yesPriceLive - pastPrice, 4);
  const percentChange =
    Number.isFinite(pastPrice) && pastPrice > 0
      ? roundTo(priceChange / pastPrice, 4)
      : 0;

  return {
    ...market,
    pastPrice: roundTo(pastPrice, 4),
    priceChange,
    percentChange,
  };
}

function buildBiggestMovers(markets) {
  return (Array.isArray(markets) ? markets : [])
    .map(computeMoverForMarket)
    .filter(Boolean)
    .filter((market) => {
      const hasUsefulActivity =
        (market.volume24hr || 0) >= 5_000 || (market.liquidity || 0) >= 5_000;
      const hasMeaningfulMove = Math.abs(market.priceChange || 0) >= 0.01;
      return hasUsefulActivity && hasMeaningfulMove && market.dataFreshness !== "stale";
    })
    .map((market) => ({
      ...market,
      displayReason:
        market.displayReason ||
        "Recent movement suggests traders are repricing new information.",
      marketReason:
        market.marketReason ||
        "Recent movement suggests traders are repricing new information.",
      marketSignal: market.marketSignal || "Moving market",
      moverScore: Math.round(
        Math.abs(market.priceChange || 0) * 100_000 +
          Math.log10((market.volume24hr || 0) + 1) * 1_200 +
          Math.log10((market.liquidity || 0) + 1) * 1_000
      ),
    }))
    .sort((a, b) => (b.moverScore || 0) - (a.moverScore || 0))
    .slice(0, 8);
}

function refreshSignalLog(markets) {
  const nowIso = new Date().toISOString();

  for (const market of markets) {
    const currentYesPrice = market.yesPriceLive;

    if (!Number.isFinite(currentYesPrice)) continue;

    const existing = signalLogByMarketId.get(market.id);

    if (!existing && market.actionSignal !== "WATCH" && market.confidenceScore >= 70) {
      signalLogByMarketId.set(market.id, {
        id: `${market.id}:${Date.now()}`,
        marketId: market.id,
        question: market.question,
        actionSignal: market.actionSignal,
        actionReason: market.actionReason,
        confidenceScore: market.confidenceScore,
        entryYesPrice: currentYesPrice,
        currentYesPrice,
        performancePoints: 0,
        status: "ACTIVE",
        createdAt: nowIso,
      });
      continue;
    }

    if (!existing) continue;

    existing.question = market.question;
    existing.actionReason = market.actionReason;
    existing.confidenceScore = market.confidenceScore;
    existing.currentYesPrice = currentYesPrice;

    const perf =
      existing.actionSignal === "BUY YES"
        ? currentYesPrice - existing.entryYesPrice
        : existing.entryYesPrice - currentYesPrice;

    existing.performancePoints = roundTo(perf, 4);

    const ageHours =
      (Date.now() - new Date(existing.createdAt).getTime()) / 3_600_000;

    if (existing.status === "ACTIVE" && ageHours >= 12 && Math.abs(perf) >= 0.08) {
      existing.status = perf > 0 ? "WIN" : "LOSS";
    }
  }
}

function buildSignalLogArray() {
  return Array.from(signalLogByMarketId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function buildPerformanceStats() {
  const signals = buildSignalLogArray();
  const finished = signals.filter(
    (signal) => signal.status === "WIN" || signal.status === "LOSS"
  );
  const wins = finished.filter((signal) => signal.status === "WIN");
  const losses = finished.filter((signal) => signal.status === "LOSS");

  const avg = (items, selector) =>
    items.length
      ? items.reduce((sum, item) => sum + selector(item), 0) / items.length
      : 0;

  const bySignal = {};
  for (const signal of signals) {
    bySignal[signal.actionSignal] ||= {
      total: 0,
      active: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgPerformance: 0,
    };
    const bucket = bySignal[signal.actionSignal];
    bucket.total += 1;
    if (signal.status === "ACTIVE") bucket.active += 1;
    if (signal.status === "WIN") bucket.wins += 1;
    if (signal.status === "LOSS") bucket.losses += 1;
  }

  for (const [signalType, bucket] of Object.entries(bySignal)) {
    const relevant = signals.filter((signal) => signal.actionSignal === signalType);
    const bucketFinished = relevant.filter(
      (signal) => signal.status === "WIN" || signal.status === "LOSS"
    );
    bucket.winRate = bucketFinished.length ? bucket.wins / bucketFinished.length : 0;
    bucket.avgPerformance = avg(relevant, (signal) => signal.performancePoints || 0);
  }

  const avgWin = avg(wins, (signal) => signal.performancePoints || 0);
  const avgLoss = avg(losses, (signal) => signal.performancePoints || 0);

  return {
    totalSignals: signals.length,
    activeSignals: signals.filter((signal) => signal.status === "ACTIVE").length,
    wins: wins.length,
    losses: losses.length,
    winRate: finished.length ? wins.length / finished.length : 0,
    avgPerformance: avg(signals, (signal) => signal.performancePoints || 0),
    avgWin,
    avgLoss,
    expectancy:
      wins.length + losses.length
        ? avgWin * (wins.length / Math.max(1, wins.length + losses.length)) +
          avgLoss * (losses.length / Math.max(1, wins.length + losses.length))
        : 0,
    bySignal,
  };
}

function buildAlerts(markets) {
  const alerts = [];
  const movers = buildBiggestMovers(markets);

  const topConfidence = [...markets]
    .sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0))
    .slice(0, 2);

  for (const market of topConfidence) {
    alerts.push({
      message: `Top opportunity: ${market.question} • ${market.actionSignal} • ${market.category}`,
      timestamp: market.lastUpdated || new Date().toISOString(),
    });
  }

  for (const mover of movers.slice(0, 2)) {
    alerts.push({
      message: `Mover: ${mover.question} • ${mover.priceChange >= 0 ? "+" : ""}${(
        mover.priceChange * 100
      ).toFixed(2)} pts`,
      timestamp: mover.lastUpdated || new Date().toISOString(),
    });
  }

  return alerts.slice(0, 6);
}

function getBinarySidePrice(positionSide, yesPrice, noPrice) {
  return positionSide === "BUY YES" ? yesPrice : noPrice;
}

function revalueOpenPositions() {
  for (const position of demoState.paper.positions) {
    if (position.status !== "OPEN") continue;

    const market = liveDataState.markets.find(
      (item) => item.id === position.marketId
    );
    if (!market) continue;

    position.currentYesPrice = market.yesPriceLive;
    position.currentNoPrice = market.noPriceLive;

    const currentSidePrice = getBinarySidePrice(
      position.actionSignal,
      market.yesPriceLive,
      market.noPriceLive
    );

    if (!Number.isFinite(currentSidePrice) || !Number.isFinite(position.shares)) {
      continue;
    }

    position.currentValueDollars = roundTo(position.shares * currentSidePrice, 2);
    position.pnlDollars = roundTo(
      position.currentValueDollars - position.positionSizeDollars,
      2
    );
    position.pnlPoints = roundTo(
      position.actionSignal === "BUY YES"
        ? market.yesPriceLive - position.entryYesPrice
        : position.entryYesPrice - market.yesPriceLive,
      4
    );
  }

  const openValue = demoState.paper.positions
    .filter((position) => position.status === "OPEN")
    .reduce((sum, position) => sum + (position.currentValueDollars || 0), 0);

  demoState.paper.bankroll.equity = roundTo(
    demoState.paper.bankroll.cash + openValue,
    2
  );
}

function buildPaperStats() {
  revalueOpenPositions();

  const positions = demoState.paper.positions;
  const openPositions = positions.filter((position) => position.status === "OPEN");
  const closedPositions = positions.filter(
    (position) => position.status === "CLOSED"
  );
  const closedWins = closedPositions.filter(
    (position) => (position.pnlDollars || 0) > 0
  );

  return {
    bankroll: demoState.paper.bankroll,
    totalPositions: positions.length,
    openPositions: openPositions.length,
    closedPositions: closedPositions.length,
    closedWins: closedWins.length,
    closedWinRate: closedPositions.length
      ? closedWins.length / closedPositions.length
      : 0,
    avgOpenPnl: openPositions.length
      ? openPositions.reduce(
          (sum, position) => sum + (position.pnlPoints || 0),
          0
        ) / openPositions.length
      : 0,
    realizedPnl: roundTo(
      closedPositions.reduce(
        (sum, position) => sum + (position.pnlDollars || 0),
        0
      ),
      2
    ),
    unrealizedPnlDollars: roundTo(
      openPositions.reduce(
        (sum, position) => sum + (position.pnlDollars || 0),
        0
      ),
      2
    ),
  };
}

function buildAccountBlockers() {
  const config = getBuilderConfig();
  const blockers = [];

  if (!demoState.account.isConnected) blockers.push("Connect an account first.");
  if (!config.builderApiConfigured) {
    blockers.push("Builder API credentials are not fully configured.");
  }
  if (!config.relayerReady) blockers.push("Relayer configuration is not ready.");
  if (!config.liveRoutingEnabled) blockers.push("Live routing is disabled.");
  if (!config.signedOrderHandoffEnabled) blockers.push("Signed handoff is disabled.");

  return blockers;
}

function buildAccountStateResponse() {
  const config = getBuilderConfig();
  const blockers = buildAccountBlockers();
  const builderReady =
    config.builderApiConfigured &&
    config.relayerReady &&
    config.liveRoutingEnabled &&
    config.signedOrderHandoffEnabled;

  return {
    ...demoState.account,
    canEnableLiveMode: demoState.account.isConnected && builderReady,
    builderReady,
    builderApiConfigured: config.builderApiConfigured,
    relayerReady: config.relayerReady,
    liveRoutingEnabled: config.liveRoutingEnabled,
    signedOrderHandoffEnabled: config.signedOrderHandoffEnabled,
    realLiveSubmitEnabled: config.realLiveSubmitEnabled,
    maxRealSubmitDollars: config.maxRealSubmitDollars,
    builderConfigSource: config.builderConfigSource,
    blockers,
  };
}

function chooseOutcomeTokenId(market, side) {
  if (side === "BUY YES") {
    if (market.yesOutcomeIndex >= 0 && market.tokenIds[market.yesOutcomeIndex]) {
      return market.tokenIds[market.yesOutcomeIndex];
    }
    return market.tokenIds[0] || "";
  }

  if (market.noOutcomeIndex >= 0 && market.tokenIds[market.noOutcomeIndex]) {
    return market.tokenIds[market.noOutcomeIndex];
  }
  return market.tokenIds[1] || market.tokenIds[0] || "";
}

function buildTradeQuote(market, side, sizeDollars, mode) {
  const selectedPrice =
    side === "BUY YES" ? market.yesPriceLive : market.noPriceLive;

  if (!Number.isFinite(selectedPrice) || selectedPrice <= 0) {
    throw new Error("Selected market does not have a usable live price");
  }

  const estimatedShares = roundTo(sizeDollars / selectedPrice, 4);
  const estimatedMaxLoss = roundTo(sizeDollars, 2);
  const potentialProfitIfCorrect = roundTo(
    estimatedShares * (1 - selectedPrice),
    2
  );

  return {
    marketId: market.id,
    question: market.question,
    side,
    sizeDollars: roundTo(sizeDollars, 2),
    selectedPrice: roundTo(selectedPrice, 4),
    estimatedShares,
    estimatedMaxLoss,
    estimatedProfitIfCorrect: potentialProfitIfCorrect,
    confidenceScore: market.confidenceScore,
    actionReason: market.actionReason,
    mode,
  };
}

function buildRealSubmitPolicy() {
  const config = getBuilderConfig();
  return {
    enabled: config.realLiveSubmitEnabled,
    maxSubmitDollars: config.maxRealSubmitDollars,
    confirmText: config.confirmText,
  };
}

function buildPreparedHandoff(market, side, sizeDollars) {
  const account = buildAccountStateResponse();
  const price = side === "BUY YES" ? market.yesPriceLive : market.noPriceLive;
  const tokenID = chooseOutcomeTokenId(market, side);
  const shares = roundTo(sizeDollars / Math.max(price || 0, 0.0001), 4);

  const blockers = [];
  if (!account.isConnected) blockers.push("Account is not connected.");
  if (!account.liveModeEnabled) blockers.push("Live mode is not enabled.");
  if (!account.builderReady) blockers.push("Builder routing is not ready.");
  if (!account.liveRoutingEnabled) blockers.push("Live routing is not enabled.");
  if (!account.signedOrderHandoffEnabled) blockers.push("Signed handoff is disabled.");
  if (!tokenID) blockers.push("No valid outcome token ID is available for this market.");
  if (!Number.isFinite(price) || price <= 0) blockers.push("Selected market price is not usable.");
  if (!Number.isFinite(shares) || shares <= 0) blockers.push("Selected trade size is not usable.");

  const realSubmitPolicy = buildRealSubmitPolicy();
  const withinMaxSubmitSize = sizeDollars <= realSubmitPolicy.maxSubmitDollars;

  const signableOrder = {
    tokenID,
    price: roundTo(price, 4),
    size: shares,
    side: "BUY",
    tickSize: String(roundTo(market.tickSize || 0.01, 2)),
    negRisk: !!market.negRisk,
    feeRateBps: 0,
  };

  return {
    blocked: blockers.length > 0,
    blockedReasons: blockers,
    submissionMode: realSubmitPolicy.enabled
      ? "GUARDED_LIVE_SUBMIT"
      : "SAFE_FALLBACK_ONLY",
    signableOrder,
    orderType: "GTC",
    postOnly: false,
    userAuthSchema: {
      address: "0x...",
      apiKey: "string",
      secret: "string",
      passphrase: "string",
    },
    realSubmitPolicy,
    realSubmitReadiness: {
      requestedSizeDollars: roundTo(sizeDollars, 2),
      withinMaxSubmitSize,
      fallbackMode: !realSubmitPolicy.enabled,
      readyForGuardedSubmit:
        blockers.length === 0 &&
        realSubmitPolicy.enabled &&
        withinMaxSubmitSize,
    },
    notes: [
      "Builder attribution is configured on the server.",
      "User signing remains client-side.",
      realSubmitPolicy.enabled
        ? "Guarded submit may proceed when all final requirements are met."
        : "Real live submit remains protected by server policy and stays in safe fallback mode.",
    ],
  };
}

function buildSubmitBlockedResponse({
  market,
  side,
  sizeDollars,
  signedOrder,
  userAuth,
  confirmText,
  blockedReasons,
}) {
  const config = getBuilderConfig();

  return {
    ok: false,
    blocked: true,
    dryRunFallback: true,
    forwarded: false,
    error: "Guarded submit blocked",
    result: {
      status: "SIGNED_HANDOFF_BLOCKED",
      message: blockedReasons[0] || "Guarded submit blocked by server policy",
      blockedReasons,
      requestSummary: {
        marketId: market?.id || "",
        question: market?.question || "",
        side,
        sizeDollars: roundTo(sizeDollars, 2),
        builderAttributionAttached: config.builderApiConfigured,
        userL2AuthAttached: !!userAuth,
        realSubmissionAttempted: false,
        confirmTextProvided: !!confirmText,
        signedOrderProvided: !!signedOrder,
      },
    },
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGammaMarkets() {
  const collected = [];
  let afterCursor = "";

  for (let page = 0; page < 2; page += 1) {
    const keysetUrl = new URL(`${GAMMA_BASE}/markets/keyset`);
    keysetUrl.searchParams.set("limit", String(LIVE_MARKET_LIMIT));
    keysetUrl.searchParams.set("active", "true");
    keysetUrl.searchParams.set("closed", "false");
    keysetUrl.searchParams.set("archived", "false");
    if (afterCursor) keysetUrl.searchParams.set("after_cursor", afterCursor);

    let payload = null;
    try {
      payload = await fetchJson(keysetUrl.toString());
    } catch (error) {
      if (page > 0) break;

      const fallbackUrl = new URL(`${GAMMA_BASE}/markets`);
      fallbackUrl.searchParams.set("limit", String(LIVE_MARKET_LIMIT));
      fallbackUrl.searchParams.set("active", "true");
      fallbackUrl.searchParams.set("closed", "false");
      fallbackUrl.searchParams.set("archived", "false");
      payload = await fetchJson(fallbackUrl.toString());
    }

    const pageMarkets = Array.isArray(payload?.markets)
      ? payload.markets
      : Array.isArray(payload)
        ? payload
        : [];

    collected.push(...pageMarkets);

    if (!payload?.next_cursor || payload.next_cursor === afterCursor) {
      break;
    }

    afterCursor = payload.next_cursor;
  }

  return collected;
}

async function refreshLiveMarkets(force = false) {
  if (
    !force &&
    liveDataState.markets.length &&
    Date.now() - liveDataState.lastFetchedAt < LIVE_CACHE_MS
  ) {
    return liveDataState.markets;
  }

  const rawMarkets = await fetchGammaMarkets();
  const normalized = rawMarkets
    .map((raw) => {
      try {
        return normalizeMarket(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const filtered = normalized.filter(isLiveMarketCandidate);
  const sorted = filtered.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));

  liveDataState.markets = sorted;
  liveDataState.lastFetchedAt = Date.now();

  console.info("Live market refresh counts", {
    fetchedCount: rawMarkets.length,
    normalizedCount: normalized.length,
    filteredCount: normalized.length - filtered.length,
    returnedCount: sorted.length,
  });

  updatePriceMemory(sorted);
  refreshSignalLog(sorted);
  revalueOpenPositions();

  return sorted;
}

function getMarketById(marketId) {
  return liveDataState.markets.find(
    (market) => String(market.id) === String(marketId)
  );
}

app.get("/api/liveMarkets", async (req, res) => {
  try {
    const markets = await refreshLiveMarkets();
    res.json({
      ok: true,
      count: markets.length,
      lastRefreshedAt: new Date(liveDataState.lastFetchedAt).toISOString(),
      source: "gamma",
      markets,
    });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, error: error.message || "Failed to load live markets" });
  }
});

app.get("/api/biggestMovers", async (req, res) => {
  try {
    const markets = await refreshLiveMarkets();
    const movers = buildBiggestMovers(markets);
    res.json({
      ok: true,
      count: movers.length,
      lastRefreshedAt: new Date(liveDataState.lastFetchedAt).toISOString(),
      source: "gamma",
      markets: movers,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        ok: false,
        error: error.message || "Failed to load biggest movers",
      });
  }
});

app.get("/api/alerts", async (req, res) => {
  try {
    const markets = await refreshLiveMarkets();
    res.json({
      ok: true,
      alerts: buildAlerts(markets),
    });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, error: error.message || "Failed to load alerts" });
  }
});

app.get("/api/signal-log", async (req, res) => {
  try {
    await refreshLiveMarkets();
    res.json({
      ok: true,
      signals: buildSignalLogArray(),
    });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, error: error.message || "Failed to load signal log" });
  }
});

app.get("/api/performance-stats", async (req, res) => {
  try {
    await refreshLiveMarkets();
    res.json({
      ok: true,
      stats: buildPerformanceStats(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to load performance stats",
    });
  }
});

app.get("/api/account-state", (req, res) => {
  res.json({
    ok: true,
    account: buildAccountStateResponse(),
  });
});

app.post("/api/account/connect", (req, res) => {
  const walletAddress = String(req.body?.walletAddress || "").trim();
  if (!walletAddress) {
    return res.status(400).json({ ok: false, error: "walletAddress is required" });
  }

  demoState.account = {
    isConnected: true,
    walletType: String(req.body?.walletType || "EOA"),
    walletAddress,
    proxyWalletAddress: String(req.body?.proxyWalletAddress || "").trim(),
    signatureType: Number(req.body?.signatureType ?? 0) || 0,
    funderAddress: String(req.body?.funderAddress || walletAddress).trim(),
    liveModeEnabled: false,
  };

  return res.json({
    ok: true,
    account: buildAccountStateResponse(),
  });
});

app.post("/api/account/disconnect", (req, res) => {
  demoState.account = createInitialAccountState();
  return res.json({
    ok: true,
    account: buildAccountStateResponse(),
  });
});

app.post("/api/account/live-mode", (req, res) => {
  const enabled = !!req.body?.enabled;
  const account = buildAccountStateResponse();

  if (enabled && !account.canEnableLiveMode) {
    return res.status(400).json({
      ok: false,
      error: account.blockers[0] || "Live mode requirements are not met",
    });
  }

  demoState.account.liveModeEnabled = enabled;

  return res.json({
    ok: true,
    account: buildAccountStateResponse(),
  });
});

app.get("/api/paper-portfolio", async (req, res) => {
  try {
    await refreshLiveMarkets();
    res.json({
      ok: true,
      positions: demoState.paper.positions,
      stats: buildPaperStats(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to load paper portfolio",
    });
  }
});

app.post("/api/paper-portfolio/open", async (req, res) => {
  try {
    await refreshLiveMarkets();

    const marketId = String(req.body?.marketId || "").trim();
    const actionSignal = String(req.body?.actionSignal || "").trim();
    const positionSizeDollars = Number(req.body?.positionSizeDollars || 0);

    const market = getMarketById(marketId);
    if (!market) {
      return res.status(404).json({ ok: false, error: "Market not found" });
    }
    if (!["BUY YES", "BUY NO"].includes(actionSignal)) {
      return res.status(400).json({ ok: false, error: "Invalid actionSignal" });
    }
    if (!Number.isFinite(positionSizeDollars) || positionSizeDollars <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: "positionSizeDollars must be positive" });
    }
    if (positionSizeDollars > demoState.paper.bankroll.cash) {
      return res
        .status(400)
        .json({ ok: false, error: "Not enough paper cash available" });
    }

    const entrySidePrice = getBinarySidePrice(
      actionSignal,
      market.yesPriceLive,
      market.noPriceLive
    );
    if (!Number.isFinite(entrySidePrice) || entrySidePrice <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: "Market price is not usable" });
    }

    const shares = roundTo(positionSizeDollars / entrySidePrice, 4);
    demoState.paper.bankroll.cash = roundTo(
      demoState.paper.bankroll.cash - positionSizeDollars,
      2
    );

    const position = {
      id: `paper_${Date.now()}`,
      marketId: market.id,
      question: market.question,
      source: "MANUAL",
      actionSignal,
      actionReason: market.actionReason,
      confidenceScore: market.confidenceScore,
      positionSizeDollars: roundTo(positionSizeDollars, 2),
      shares,
      entryYesPrice: market.yesPriceLive,
      currentYesPrice: market.yesPriceLive,
      currentNoPrice: market.noPriceLive,
      currentValueDollars: roundTo(positionSizeDollars, 2),
      pnlDollars: 0,
      pnlPoints: 0,
      status: "OPEN",
      openedAt: new Date().toISOString(),
      closeReason: "",
      closedAt: "",
    };

    demoState.paper.positions.unshift(position);
    revalueOpenPositions();

    return res.json({
      ok: true,
      position,
      stats: buildPaperStats(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error.message || "Failed to open position" });
  }
});

app.post("/api/paper-portfolio/close", async (req, res) => {
  try {
    await refreshLiveMarkets();

    const positionId = String(req.body?.positionId || "").trim();
    const reason = String(req.body?.reason || "Manual Close").trim();

    const position = demoState.paper.positions.find((item) => item.id === positionId);
    if (!position) {
      return res.status(404).json({ ok: false, error: "Position not found" });
    }
    if (position.status !== "OPEN") {
      return res.status(400).json({ ok: false, error: "Position is already closed" });
    }

    revalueOpenPositions();

    demoState.paper.bankroll.cash = roundTo(
      demoState.paper.bankroll.cash + (position.currentValueDollars || 0),
      2
    );

    position.status = "CLOSED";
    position.closeReason = reason;
    position.closedAt = new Date().toISOString();

    revalueOpenPositions();

    return res.json({
      ok: true,
      position,
      stats: buildPaperStats(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error.message || "Failed to close position" });
  }
});

app.post("/api/paper-portfolio/reset", (req, res) => {
  const startingBankroll = Number(req.body?.startingBankroll || 1000);
  const defaultPositionSize = Number(req.body?.defaultPositionSize || 50);

  demoState.paper = {
    bankroll: {
      startingBankroll: Number.isFinite(startingBankroll) ? startingBankroll : 1000,
      cash: Number.isFinite(startingBankroll) ? startingBankroll : 1000,
      equity: Number.isFinite(startingBankroll) ? startingBankroll : 1000,
      defaultPositionSize: Number.isFinite(defaultPositionSize)
        ? defaultPositionSize
        : 50,
    },
    positions: [],
  };

  return res.json({
    ok: true,
    stats: buildPaperStats(),
  });
});

app.post("/api/trade/quote", async (req, res) => {
  try {
    await refreshLiveMarkets();

    const marketId = String(req.body?.marketId || "").trim();
    const side = String(req.body?.side || "").trim();
    const sizeDollars = Number(req.body?.sizeDollars || 0);
    const mode = String(req.body?.mode || "PAPER").trim();

    if (!["BUY YES", "BUY NO"].includes(side)) {
      return res.status(400).json({ ok: false, error: "Invalid trade side" });
    }

    const market = getMarketById(marketId);
    if (!market) {
      return res.status(404).json({ ok: false, error: "Market not found" });
    }

    const normalizedSize =
      Number.isFinite(sizeDollars) && sizeDollars > 0
        ? sizeDollars
        : demoState.paper.bankroll.defaultPositionSize;

    return res.json({
      ok: true,
      quote: buildTradeQuote(market, side, normalizedSize, mode),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error.message || "Failed to quote trade" });
  }
});

app.post("/api/trade/execute", async (req, res) => {
  try {
    await refreshLiveMarkets();

    const marketId = String(req.body?.marketId || "").trim();
    const side = String(req.body?.side || "").trim();
    const sizeDollars = Number(req.body?.sizeDollars || 0);
    const mode = String(req.body?.mode || "PAPER").trim();

    if (mode !== "PAPER") {
      return res.status(400).json({ ok: false, error: "Only PAPER execution is enabled" });
    }

    const market = getMarketById(marketId);
    if (!market) {
      return res.status(404).json({ ok: false, error: "Market not found" });
    }
    if (!["BUY YES", "BUY NO"].includes(side)) {
      return res.status(400).json({ ok: false, error: "Invalid trade side" });
    }
    if (!Number.isFinite(sizeDollars) || sizeDollars <= 0) {
      return res.status(400).json({ ok: false, error: "Trade size must be positive" });
    }
    if (sizeDollars > demoState.paper.bankroll.cash) {
      return res.status(400).json({ ok: false, error: "Not enough paper cash available" });
    }

    const entrySidePrice = getBinarySidePrice(
      side,
      market.yesPriceLive,
      market.noPriceLive
    );
    if (!Number.isFinite(entrySidePrice) || entrySidePrice <= 0) {
      return res.status(400).json({ ok: false, error: "Market price is not usable" });
    }

    const shares = roundTo(sizeDollars / entrySidePrice, 4);
    demoState.paper.bankroll.cash = roundTo(
      demoState.paper.bankroll.cash - sizeDollars,
      2
    );

    const position = {
      id: `paper_${Date.now()}`,
      marketId: market.id,
      question: market.question,
      source: "TRADE_TICKET",
      actionSignal: side,
      actionReason: market.actionReason,
      confidenceScore: market.confidenceScore,
      positionSizeDollars: roundTo(sizeDollars, 2),
      shares,
      entryYesPrice: market.yesPriceLive,
      currentYesPrice: market.yesPriceLive,
      currentNoPrice: market.noPriceLive,
      currentValueDollars: roundTo(sizeDollars, 2),
      pnlDollars: 0,
      pnlPoints: 0,
      status: "OPEN",
      openedAt: new Date().toISOString(),
      closeReason: "",
      closedAt: "",
    };

    demoState.paper.positions.unshift(position);
    revalueOpenPositions();

    return res.json({
      ok: true,
      position,
      stats: buildPaperStats(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error.message || "Failed to execute trade" });
  }
});

app.post("/api/trade/prepare", async (req, res) => {
  try {
    await refreshLiveMarkets();

    const marketId = String(req.body?.marketId || "").trim();
    const side = String(req.body?.side || "").trim();
    const sizeDollars = Number(req.body?.sizeDollars || 0);

    const market = getMarketById(marketId);
    if (!market) {
      return res.status(404).json({ ok: false, error: "Market not found" });
    }
    if (!["BUY YES", "BUY NO"].includes(side)) {
      return res.status(400).json({ ok: false, error: "Invalid trade side" });
    }
    if (!Number.isFinite(sizeDollars) || sizeDollars <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid trade size" });
    }

    const ticket = buildTradeQuote(market, side, sizeDollars, "LIVE");
    const signedOrderHandoff = buildPreparedHandoff(market, side, sizeDollars);

    return res.json({
      ok: true,
      preparation: {
        mode: "LIVE",
        status: signedOrderHandoff.blocked
          ? "SIGNED_HANDOFF_BLOCKED"
          : "DRY_RUN_READY",
        builderReady: buildAccountStateResponse().builderReady,
        message: signedOrderHandoff.blocked
          ? "Live trade preparation is blocked until readiness requirements are met."
          : "Builder attribution is configured on the server. Live routing shell is ready for the next integration step.",
        ticket,
        signedOrderHandoff,
        nextSteps: signedOrderHandoff.blocked
          ? ["Resolve the listed blockers, then prepare the trade again."]
          : [
              "Review the signable order payload.",
              "Sign the order client-side with the connected wallet.",
              "Prepare L2 auth inputs for guarded submit.",
            ],
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error.message || "Failed to prepare trade" });
  }
});

app.post("/api/trade/submit-signed", async (req, res) => {
  try {
    await refreshLiveMarkets();

    const marketId = String(req.body?.marketId || "").trim();
    const side = String(req.body?.side || "").trim();
    const sizeDollars = Number(req.body?.sizeDollars || 0);
    const signedOrder = req.body?.signedOrder;
    const userAuth = req.body?.userAuth;
    const confirmText = String(req.body?.confirmText || "").trim();

    const market = getMarketById(marketId);
    if (!market) {
      return res.status(404).json({ ok: false, error: "Market not found" });
    }

    const account = buildAccountStateResponse();
    const policy = buildRealSubmitPolicy();
    const blockedReasons = [];

    if (!account.isConnected) blockedReasons.push("Account is not connected.");
    if (!account.liveModeEnabled) blockedReasons.push("Live mode is not enabled.");
    if (!account.builderReady) blockedReasons.push("Builder routing is not ready.");
    if (!policy.enabled) blockedReasons.push("Real live submit is disabled by server policy.");
    if (!Number.isFinite(sizeDollars) || sizeDollars <= 0) blockedReasons.push("Trade size is invalid.");
    if (sizeDollars > policy.maxSubmitDollars) blockedReasons.push("Trade size exceeds the guarded submit limit.");
    if (!signedOrder || typeof signedOrder !== "object") blockedReasons.push("Signed order payload is missing.");
    if (!userAuth || typeof userAuth !== "object") blockedReasons.push("User L2 auth bundle is missing.");
    if (confirmText !== policy.confirmText) blockedReasons.push("Confirmation text does not match.");

    if (blockedReasons.length > 0) {
      console.log("[guarded-submit] blocked", {
        marketId,
        side,
        sizeDollars,
        reasons: blockedReasons,
      });

      return res.status(403).json(
        buildSubmitBlockedResponse({
          market,
          side,
          sizeDollars,
          signedOrder,
          userAuth,
          confirmText,
          blockedReasons,
        })
      );
    }

    const config = getBuilderConfig();
    console.log("[guarded-submit] allowed", {
      marketId,
      side,
      sizeDollars,
      relayerConfigured: !!config.relayerUrl,
    });

    if (!config.relayerUrl) {
      return res.status(503).json(
        buildSubmitBlockedResponse({
          market,
          side,
          sizeDollars,
          signedOrder,
          userAuth,
          confirmText,
          blockedReasons: ["Relayer URL is not configured."],
        })
      );
    }

    return res.status(503).json(
      buildSubmitBlockedResponse({
        market,
        side,
        sizeDollars,
        signedOrder,
        userAuth,
        confirmText,
        blockedReasons: [
          "Live submit forwarding is intentionally unavailable in this deployment.",
        ],
      })
    );
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to submit signed order",
    });
  }
});

app.post("/api/internal/alerts", async (req, res) => {
  if (!authorizeAlertIngestRequest(req, res)) return;

  try {
    const alertSignal = normalizeAlertSignalInput(req.body);

    if (!alertSignal.alertType) {
      return res.status(400).json({
        ok: false,
        error: "alertType is required.",
      });
    }

    if (!alertSignal.marketQuestion) {
      return res.status(400).json({
        ok: false,
        error: "marketQuestion is required.",
      });
    }

    logAlertSignalStorageMode("ingest start");
    const result = await addAlertSignal(alertSignal);

    return res.status(201).json({
      ok: true,
      status: "created",
      storageMode: result.storageMode,
      alert: toPublicAlertSignal(result.alertSignal),
      message: "Alert signal stored.",
    });
  } catch (error) {
    console.error("[alert-signals] Ingest failed:", error.message);
    return res.status(error.status || 500).json({
      ok: false,
      error: error.status === 503
        ? "Alert signal storage is not configured."
        : "Failed to store alert signal.",
    });
  }
});

app.get("/api/alerts/recent", async (req, res) => {
  try {
    const alerts = await readRecentAlertSignals(PUBLIC_ALERT_SIGNAL_LIMIT);

    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      alerts,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[alert-signals] Recent read failed:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to load recent alert signals.",
    });
  }
});

app.post("/api/events/outbound-click", async (req, res) => {
  try {
    const clickEvent = normalizeOutboundClickInput(req.body);

    if (!clickEvent.marketUrl) {
      return res.status(400).json({
        ok: false,
        error: "A valid Polymarket marketUrl is required.",
      });
    }

    logOutboundClickStorageMode("save start");
    const result = await addOutboundClickEvent(clickEvent);

    return res.status(201).json({
      ok: true,
      status: "created",
      storageMode: result.storageMode,
      message: "Outbound click recorded.",
    });
  } catch (error) {
    console.error("[outbound-clicks] Save failed:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to record outbound click.",
    });
  }
});

app.post("/api/feedback", async (req, res) => {
  try {
    const rawMessage = String(req.body?.message || "").trim();
    const rawEmail = String(req.body?.email || "").trim();
    const feedback = normalizeBetaFeedbackInput(req.body);
    const ratingProvided =
      req.body?.rating !== null &&
      req.body?.rating !== undefined &&
      req.body?.rating !== "";

    if (ratingProvided && feedback.rating === null) {
      return res.status(400).json({
        ok: false,
        error: "Rating must be a number from 1 to 5.",
      });
    }

    if (!rawMessage) {
      return res.status(400).json({
        ok: false,
        error: "Feedback message is required.",
      });
    }

    if (rawMessage.length > 2000) {
      return res.status(400).json({
        ok: false,
        error: "Feedback message must be 2000 characters or less.",
      });
    }

    if (rawEmail.length > 254) {
      return res.status(400).json({
        ok: false,
        error: "Email must be 254 characters or less.",
      });
    }

    if (feedback.email && !isValidWaitlistEmail(feedback.email)) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid email address or leave it blank.",
      });
    }

    logBetaFeedbackStorageMode("save start");
    const result = await addBetaFeedback(feedback);

    return res.status(201).json({
      ok: true,
      status: "created",
      storageMode: result.storageMode,
      message: "Feedback saved. Thank you for trying the beta.",
    });
  } catch (error) {
    console.error("[beta-feedback] Save failed:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to save beta feedback.",
    });
  }
});

app.post("/api/waitlist", async (req, res) => {
  try {
    const email = normalizeWaitlistEmail(req.body?.email);
    const source = normalizeWaitlistSource(req.body?.source);

    if (!isValidWaitlistEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid email address.",
      });
    }

    logWaitlistStorageMode("save start");
    const result = await addWaitlistSubmission({ email, source });

    if (result.status === "existing") {
      return res.json({
        ok: true,
        status: "existing",
        storageMode: result.storageMode,
        message: "Email is already on the PBP Alerts waitlist.",
      });
    }

    return res.status(201).json({
      ok: true,
      status: "created",
      storageMode: result.storageMode,
      message: "You are on the PBP Alerts waitlist.",
    });
  } catch (error) {
    console.error("Waitlist save failed:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to save waitlist signup.",
    });
  }
});

app.get("/api/admin/waitlist", async (req, res) => {
  if (!authorizeAdminRequest(req, res)) return;

  try {
    logWaitlistStorageMode("admin export start");
    const data = await readWaitlistExportData();

    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      storageMode: data.storageMode,
      count: data.submissions.length,
      updatedAt: data.updatedAt,
      submissions: data.submissions,
    });
  } catch (error) {
    console.error("Waitlist export failed:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to load waitlist submissions.",
    });
  }
});

app.get("/api/admin/status", async (req, res) => {
  if (!authorizeAdminRequest(req, res)) return;

  try {
    logWaitlistStorageMode("admin status start");
    logAlertSignalStorageMode("admin status start");
    logOutboundClickStorageMode("admin status start");
    logBetaFeedbackStorageMode("admin status start");
    const [waitlistSummary, alertSignalSummary, outboundClickSummary, feedbackSummary] = await Promise.all([
      readWaitlistStatusSummary(),
      readAlertSignalStatusSummary(),
      readOutboundClickStatusSummary(),
      readBetaFeedbackStatusSummary(),
    ]);
    const checks = {
      waitlistStorage: "ok",
      alertStorage: alertSignalSummary.alertStorage,
      outboundClickStorage: outboundClickSummary.outboundClickStorage,
      feedbackStorage: feedbackSummary.feedbackStorage,
      adminAuth: "ok",
    };
    const statusOk = Object.values(checks).every((value) => value === "ok");

    res.set("Cache-Control", "no-store");
    return res.json({
      ok: statusOk,
      storageMode: waitlistSummary.storageMode,
      waitlist: waitlistSummary.waitlist,
      alertSignals: alertSignalSummary.alertSignals,
      outboundClicks: outboundClickSummary.outboundClicks,
      feedback: feedbackSummary.feedback,
      app: {
        name: "Paid by Polymarket OS",
        feature: "PBP Alerts",
        status: "live",
      },
      checks,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Admin status failed:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to load admin status.",
    });
  }
});

app.post("/api/public-demo/reset", (req, res) => {
  demoState.account = createInitialAccountState();
  demoState.paper = createInitialPaperState();
  signalLogByMarketId.clear();

  return res.json({ ok: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

refreshLiveMarkets(true).catch((error) => {
  console.error("Initial live market refresh failed:", error.message);
});

setInterval(() => {
  refreshLiveMarkets(true).catch((error) => {
    console.error("Background live market refresh failed:", error.message);
  });
}, LIVE_REFRESH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Paid by Polymarket OS running on port ${PORT}`);
  console.log(`Serving public assets from: ${PUBLIC_DIR}`);
});
