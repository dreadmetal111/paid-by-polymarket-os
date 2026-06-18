const POLYMARKET_CLOB_HOST = "https://clob.polymarket.com";
const POLYMARKET_CHAIN_ID = 137;
const POLYGON_HEX_CHAIN_ID = "0x89";
const PBP_ALERTS_WAITLIST_STORAGE_KEY = "pbpAlertsWaitlistEmails";
const HOM_WATCHLIST_STORAGE_KEY = "houseOfMarketsWatchedMarkets";
const HOM_WATCHLIST_EMAIL_STORAGE_KEY = "houseOfMarketsWatchlistEmail";
const PBP_LATEST_ALERT_SIGNALS_LIMIT = 3;
const DISCOVER_RESULT_LIMIT = 8;
const DISCOVER_CANDIDATE_LIMIT = 120;
const QUICK_DISCOVERY_INITIAL_LIMIT = 4;
const QUICK_DISCOVERY_EXPANDED_LIMIT = 8;
// Advanced demo sections stay available for internal testing with ?debug=1 during public beta.
const PBP_PUBLIC_BETA_DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";
const PBP_PUBLIC_BETA_INTERNAL_SECTION_IDS = [
  "tradeExecutionPanel",
  "accountStatePanel",
  "accountControlsPanel",
  "paperPortfolioStatsPanel",
  "paperPortfolioControlsPanel",
  "performanceStatsPanel",
  "signalLogPanel",
  "openPositionsPanel",
  "closedPositionsPanel",
];

const EVENT_DETAIL_SORTS = {
  volume: "Highest volume",
  liquidity: "Most liquid",
  movement: "Biggest movement",
  highProbability: "Highest probability",
  lowProbability: "Lowest probability",
};

const PBP_ALERT_TYPE_LABELS = {
  new_high_volume: "New high-activity market",
  probability_movement: "Market movement",
  volume_liquidity_spike: "Volume/liquidity spike",
};

const DISCOVER_VIEWS = {
  opportunities: {
    label: "Top Opportunities",
    description: "Best blend of confidence, liquidity, and current activity.",
    empty: "No top opportunities found for the current filter.",
    type: "market",
  },
  movers: {
    label: "Biggest Movers",
    description: "Markets moving the most versus recent tracked pricing.",
    empty: "Mover data is still warming up for the current filter.",
    type: "mover",
  },
  volume: {
    label: "Highest Volume",
    description: "Markets attracting the most current trading activity.",
    empty: "No high-volume markets found for the current filter.",
    type: "market",
  },
  liquid: {
    label: "Most Liquid",
    description: "Markets with deeper liquidity for cleaner entry and exit.",
    empty: "No liquid markets found for the current filter.",
    type: "market",
  },
  new: {
    label: "New / Emerging",
    description: "Recently updated markets beginning to build activity.",
    empty: "No emerging markets found for the current filter.",
    type: "market",
  },
};

const PUBLIC_BROWSE_CATEGORIES = [
  { key: "ALL", label: "All" },
  { key: "SPORTS", label: "Sports" },
  { key: "POLITICS", label: "Politics" },
  { key: "CRYPTO", label: "Crypto" },
  { key: "ECONOMY", label: "Economy" },
  { key: "CULTURE_NEWS", label: "Culture/News" },
  { key: "OTHER", label: "Other" },
];

let hotMarketsCache = [];
let liveMarketsCache = [];
let biggestMoversCache = [];
let lastHomepageDiscoveryRefreshAt = "";
let activeHomepageCategory = "ALL";
let currentTopLevelView = "discover";
let currentDiscoverView = "opportunities";
let activeTopDiscoveryTab = "trending";
let quickDiscoveryExpanded = false;
let activeMarketDetailId = "";
let activeMarketDetailTab = "overview";
let currentMarketPageId = "";
let currentEventSlug = "";
let currentEventSort = "volume";
let currentTradeTicket = null;
let accountStateCache = null;
let currentLivePreparation = null;
let currentClientSignedOrder = null;
let currentUserAuthDraft = createEmptyUserAuthDraft();
let currentUserAuthUiState = createEmptyUserAuthUiState();
let walletConnectionSource = "NONE";
let browserWalletEventsBound = false;
let marketDetailOpenersBound = false;
let marketPageLinksBound = false;
let polymarketBrowserModulesPromise = null;
let latestAlertSignalsFallbackHtml = "";
let latestAlertSignalTimestamp = "";
let publicConfig = {
  discordInviteEnabled: false,
  discordInviteUrl: "",
};

function createEmptyUserAuthDraft() {
  return {
    address: "",
    apiKey: "",
    secret: "",
    passphrase: "",
    rawJson: "",
    lockEmptyAddress: false,
  };
}

function createEmptyUserAuthUiState() {
  return {
    type: "",
    message: "",
  };
}

function getFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getNonNegativeNumber(value) {
  const numeric = getFiniteNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function hasUsableProbability(value) {
  const numeric = getFiniteNumber(value);
  return numeric !== null && numeric >= 0 && numeric <= 1;
}

function getMarketProbabilityMeta(value) {
  const numeric = getFiniteNumber(value);
  if (numeric === null || numeric < 0 || numeric > 1) {
    return { label: "Probability unavailable", note: "YES" };
  }

  const precision = numeric > 0 && numeric < 0.01 ? 2 : 1;
  return {
    label: `${(numeric * 100).toFixed(precision)}%`,
    note: numeric <= 0.01 ? "Long shot" : "YES",
  };
}

// Missing values use explicit fallbacks so market windows never show NaN,
// undefined, null, impossible percentages, or broken bar labels.
function formatProbability(value, fallback = "Probability unavailable") {
  const numeric = getFiniteNumber(value);
  if (numeric === null || numeric < 0 || numeric > 1) return fallback;
  return getMarketProbabilityMeta(numeric).label;
}

function formatChangeAsProbability(value, fallback = "No movement data yet") {
  const numeric = getFiniteNumber(value);
  if (numeric === null) return fallback;
  const pct = numeric * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)} pts`;
}

function formatPercentChange(value, fallback = "No movement data yet") {
  const numeric = getFiniteNumber(value);
  if (numeric === null) return fallback;
  const pct = numeric * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatMoney(value, fallback = "Unavailable") {
  const numeric = getNonNegativeNumber(value);
  if (numeric === null) return fallback;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatTimestamp(value, fallback = "Updated recently") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

function formatPoints(value, fallback = "No movement data yet") {
  const numeric = getFiniteNumber(value);
  if (numeric === null) return fallback;
  const pts = numeric * 100;
  return `${pts >= 0 ? "+" : ""}${pts.toFixed(2)} pts`;
}

function shortAddress(value) {
  const address = String(value || "").trim();
  if (!address || address.length < 10) return address || "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeText(value, fallback = "") {
  const text = value === null || value === undefined || value === "" ? fallback : value;
  return escapeHtml(text);
}

function safeAttr(value, fallback = "") {
  return safeText(value, fallback);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return escapeHtml(url.href);
    }
  } catch {}
  return "#";
}

function normalizeOutboundSourceSection(value) {
  return String(value || "market-discovery")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "market-discovery";
}

function getMarketTrackingId(market) {
  return market?.id || market?.marketId || market?.conditionId || market?.slug || "";
}

function getOutboundMarketClickPayload(link) {
  return {
    marketId: link.dataset.marketId || "",
    marketSlug: link.dataset.marketSlug || "",
    marketQuestion: link.dataset.marketQuestion || "",
    marketUrl: link.dataset.marketUrl || link.href || "",
    sourceSection: normalizeOutboundSourceSection(link.dataset.sourceSection),
    cta: link.dataset.cta || "view-on-polymarket",
  };
}

function sendOutboundMarketClick(payload) {
  const body = JSON.stringify(payload);

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/events/outbound-click", blob)) {
        return;
      }
    }
  } catch {}

  try {
    fetch("/api/events/outbound-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

let outboundClickTrackingBound = false;
let watchlistInterestTrackingBound = false;
let pendingWatchlistInterest = null;

function bindOutboundClickTracking() {
  if (outboundClickTrackingBound) return;
  outboundClickTrackingBound = true;

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target?.closest?.("[data-outbound-click='polymarket']");
      if (!link) return;

      sendOutboundMarketClick(getOutboundMarketClickPayload(link));
    },
    { capture: true }
  );
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getStoredAlertsWaitlistEmails() {
  try {
    const raw = window.localStorage?.getItem(PBP_ALERTS_WAITLIST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string" && isValidEmail(item))
      : [];
  } catch {
    return [];
  }
}

function storeAlertsWaitlistEmails(emails) {
  try {
    window.localStorage?.setItem(
      PBP_ALERTS_WAITLIST_STORAGE_KEY,
      JSON.stringify(Array.from(new Set(emails)))
    );
    return true;
  } catch {
    return false;
  }
}

function getStoredWatchlistEmail() {
  try {
    const email = String(window.localStorage?.getItem(HOM_WATCHLIST_EMAIL_STORAGE_KEY) || "").trim().toLowerCase();
    return isValidEmail(email) ? email : "";
  } catch {
    return "";
  }
}

function storeWatchlistEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!isValidEmail(normalized)) return false;

  try {
    window.localStorage?.setItem(HOM_WATCHLIST_EMAIL_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

function getBestWatchlistEmail() {
  const watchlistEmail = getStoredWatchlistEmail();
  if (watchlistEmail) return watchlistEmail;

  const waitlistEmails = getStoredAlertsWaitlistEmails();
  return waitlistEmails[waitlistEmails.length - 1] || "";
}

function getStoredWatchedMarketKeys() {
  try {
    const raw = window.localStorage?.getItem(HOM_WATCHLIST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string" && item.trim())
      : [];
  } catch {
    return [];
  }
}

function storeWatchedMarketKey(key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return false;

  try {
    const keys = new Set(getStoredWatchedMarketKeys());
    keys.add(normalizedKey);
    window.localStorage?.setItem(HOM_WATCHLIST_STORAGE_KEY, JSON.stringify(Array.from(keys)));
    return true;
  } catch {
    return false;
  }
}

function getWatchlistMarketKey(market) {
  return String(
    getMarketDetailId(market) ||
      market?.marketFamilyKey ||
      market?.slug ||
      market?.question ||
      ""
  ).trim();
}

function isMarketWatched(marketOrKey) {
  const key = typeof marketOrKey === "string" ? marketOrKey : getWatchlistMarketKey(marketOrKey);
  return !!key && getStoredWatchedMarketKeys().includes(key);
}

function setWatchlistButtonStateForKey(key, status = "watching") {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;

  document.querySelectorAll(".watchlist-action-btn").forEach((button) => {
    if (button.dataset.watchlistKey !== normalizedKey) return;
    button.classList.toggle("is-watching", status === "watching");
    button.textContent = status === "watching" ? "Watching" : "Notify me";
    button.setAttribute("aria-label", status === "watching" ? "Already watching this market" : "Notify me about this market");
  });
}

function showWatchlistStatus(message, type = "success") {
  let toast = document.getElementById("watchlistInterestToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "watchlistInterestToast";
    toast.className = "watchlist-toast";
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  toast.classList.remove("success", "error");
  toast.classList.add(type);
  toast.textContent = message;
  toast.classList.add("is-visible");

  window.clearTimeout(showWatchlistStatus.timeoutId);
  showWatchlistStatus.timeoutId = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2600);
}

function ensureWatchlistEmailPrompt() {
  let prompt = document.getElementById("watchlistEmailPrompt");
  if (prompt) return prompt;

  prompt = document.createElement("div");
  prompt.id = "watchlistEmailPrompt";
  prompt.className = "watchlist-prompt-shell watchlist-prompt-hidden";
  prompt.setAttribute("aria-hidden", "true");
  prompt.innerHTML = `
    <div class="watchlist-prompt-backdrop" data-watchlist-prompt-close="true"></div>
    <div class="watchlist-prompt-card" role="dialog" aria-modal="true" aria-labelledby="watchlistPromptTitle">
      <button class="watchlist-prompt-close" type="button" data-watchlist-prompt-close="true" aria-label="Close watchlist prompt">Close</button>
      <p class="market-small">Market alerts beta</p>
      <h2 id="watchlistPromptTitle">Where should we send market alerts?</h2>
      <p class="alert-time">Notify/Watchlist is alert interest only. It does not place a trade.</p>
      <form id="watchlistEmailPromptForm" class="watchlist-prompt-form">
        <label class="meta-label" for="watchlistPromptEmail">Email</label>
        <input id="watchlistPromptEmail" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required />
        <button type="submit">Submit</button>
      </form>
      <p id="watchlistPromptStatus" class="pbp-alert-waitlist-status" aria-live="polite"></p>
    </div>
  `;
  document.body.appendChild(prompt);

  prompt.addEventListener("click", (event) => {
    if (event.target?.closest?.("[data-watchlist-prompt-close='true']")) {
      closeWatchlistEmailPrompt();
    }
  });

  prompt.querySelector("#watchlistEmailPromptForm")?.addEventListener("submit", handleWatchlistEmailPromptSubmit);
  return prompt;
}

function setWatchlistPromptStatus(type, message) {
  const status = document.getElementById("watchlistPromptStatus");
  if (!status) return;
  status.classList.remove("success", "error");
  if (type) status.classList.add(type);
  status.textContent = message;
}

function openWatchlistEmailPrompt(request) {
  pendingWatchlistInterest = request;
  const prompt = ensureWatchlistEmailPrompt();
  const input = document.getElementById("watchlistPromptEmail");
  const storedEmail = getBestWatchlistEmail();

  if (input) input.value = storedEmail;
  setWatchlistPromptStatus("", "");
  prompt.classList.remove("watchlist-prompt-hidden");
  prompt.setAttribute("aria-hidden", "false");
  window.setTimeout(() => input?.focus(), 50);
}

function closeWatchlistEmailPrompt() {
  const prompt = document.getElementById("watchlistEmailPrompt");
  if (!prompt) return;
  prompt.classList.add("watchlist-prompt-hidden");
  prompt.setAttribute("aria-hidden", "true");
  pendingWatchlistInterest = null;
}

async function handleWatchlistEmailPromptSubmit(event) {
  event.preventDefault();

  const input = document.getElementById("watchlistPromptEmail");
  const email = String(input?.value || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    setWatchlistPromptStatus("error", "Enter a valid email address.");
    return;
  }

  if (!pendingWatchlistInterest) {
    setWatchlistPromptStatus("error", "Choose a market first.");
    return;
  }

  setWatchlistPromptStatus("", "Adding this market...");
  await submitWatchlistInterest(pendingWatchlistInterest.market, pendingWatchlistInterest.source, email, {
    closePrompt: true,
  });
}

function setAlertsWaitlistStatus(type, message) {
  const status = document.getElementById("pbpAlertsWaitlistStatus");
  if (!status) return;

  status.classList.remove("success", "error");
  if (type) status.classList.add(type);
  status.textContent = message;
}

function renderDiscordBetaCta(show = false) {
  const container = document.getElementById("pbpDiscordBetaCta");
  const content = document.getElementById("pbpDiscordBetaCtaContent");
  if (!container || !content) return;

  container.classList.toggle("is-hidden", !show);
  if (!show) return;

  if (publicConfig.discordInviteEnabled && publicConfig.discordInviteUrl) {
    content.innerHTML = `
      <p class="alert-time">You are on the alerts beta waitlist. You can also join the first free Discord alerts beta now.</p>
      <a
        class="market-link market-link-primary pbp-discord-beta-link"
        href="${safeUrl(publicConfig.discordInviteUrl)}"
        target="_blank"
        rel="noopener noreferrer"
      >Join free Discord alerts beta</a>
    `;
  } else {
    content.innerHTML = `
      <p class="alert-time">You are on the alerts beta waitlist. Discord beta invite coming soon.</p>
    `;
  }
}

async function loadPublicConfig() {
  try {
    const res = await fetch("/api/public-config", { cache: "no-store" });
    const data = await res.json();
    publicConfig = {
      discordInviteEnabled: !!data?.discordInviteEnabled,
      discordInviteUrl: data?.discordInviteEnabled && data?.discordInviteUrl
        ? String(data.discordInviteUrl)
        : "",
    };
  } catch {
    publicConfig = {
      discordInviteEnabled: false,
      discordInviteUrl: "",
    };
  }
}

async function handleAlertsWaitlistSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const input = document.getElementById("pbpAlertsEmail");
  const submitButton = form?.querySelector('button[type="submit"]');
  const email = String(input?.value || "").trim().toLowerCase();

  if (!isValidEmail(email)) {
    setAlertsWaitlistStatus("error", "Enter a valid email to join the alerts beta.");
    return;
  }

  if (submitButton) submitButton.disabled = true;
  setAlertsWaitlistStatus("", "Saving your waitlist spot...");

  try {
    const data = await postJson("/api/waitlist", {
      email,
      source: "pbp-alerts-homepage",
    });

    const storedEmails = getStoredAlertsWaitlistEmails();
    const savedLocally = storeAlertsWaitlistEmails([...storedEmails, email]);
    const localMemoryNote = savedLocally
      ? ""
      : " Server saved it, but this browser could not remember the signup locally.";

    if (input) input.value = "";

    if (data.status === "existing") {
      setAlertsWaitlistStatus(
        "success",
        `You are already on the House of Markets alerts beta waitlist.${localMemoryNote}`
      );
    } else {
      setAlertsWaitlistStatus(
        "success",
        `You are on the alerts beta waitlist.${localMemoryNote}`
      );
    }
    renderDiscordBetaCta(true);
  } catch (err) {
    const remembered = getStoredAlertsWaitlistEmails().includes(email);
    if (remembered) {
      setAlertsWaitlistStatus(
        "success",
        "This browser remembers a previous successful signup, but the waitlist server could not be reached right now."
      );
      renderDiscordBetaCta(true);
    } else {
      setAlertsWaitlistStatus(
        "error",
        err.message || "Could not save your waitlist signup. Please try again."
      );
    }
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function bindAlertsWaitlistForm() {
  const form = document.getElementById("pbpAlertsWaitlistForm");
  if (!form) return;

  form.addEventListener("submit", handleAlertsWaitlistSubmit);

  const storedCount = getStoredAlertsWaitlistEmails().length;
  if (storedCount > 0) {
    setAlertsWaitlistStatus(
      "success",
      `This browser remembers ${storedCount} previous waitlist signup${storedCount === 1 ? "" : "s"}. Submit again to confirm with the server.`
    );
    renderDiscordBetaCta(true);
  }
}

function setBetaFeedbackStatus(type, message) {
  const status = document.getElementById("pbpBetaFeedbackStatus");
  if (!status) return;

  status.classList.remove("success", "error");
  if (type) status.classList.add(type);
  status.textContent = message;
}

async function handleBetaFeedbackSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const ratingInput = document.getElementById("pbpFeedbackRating");
  const messageInput = document.getElementById("pbpFeedbackMessage");
  const emailInput = document.getElementById("pbpFeedbackEmail");
  const submitButton = form?.querySelector('button[type="submit"]');
  const rating = String(ratingInput?.value || "").trim();
  const message = String(messageInput?.value || "").trim();
  const email = String(emailInput?.value || "").trim().toLowerCase();

  if (!message) {
    setBetaFeedbackStatus("error", "Add a short note before sending feedback.");
    return;
  }

  if (message.length > 2000) {
    setBetaFeedbackStatus("error", "Feedback must be 2000 characters or less.");
    return;
  }

  if (email && !isValidEmail(email)) {
    setBetaFeedbackStatus("error", "Enter a valid email address or leave it blank.");
    return;
  }

  if (submitButton) submitButton.disabled = true;
  setBetaFeedbackStatus("", "Sending feedback...");

  try {
    await postJson("/api/feedback", {
      rating,
      message,
      email,
      source: "public-beta",
    });

    if (ratingInput) ratingInput.value = "";
    if (messageInput) messageInput.value = "";
    if (emailInput) emailInput.value = "";

    setBetaFeedbackStatus("success", "Feedback saved. Thank you for trying the beta.");
  } catch (err) {
    setBetaFeedbackStatus(
      "error",
      err.message || "Could not save feedback. Please try again."
    );
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function bindBetaFeedbackForm() {
  const form = document.getElementById("pbpBetaFeedbackForm");
  if (!form) return;

  form.addEventListener("submit", handleBetaFeedbackSubmit);
}

function getLatestAlertSignalsElements() {
  return {
    list: document.getElementById("pbpLatestAlertSignalsList"),
    badge: document.getElementById("pbpLatestAlertSignalsBadge"),
  };
}

function captureLatestAlertSignalsFallback(list) {
  if (!list || latestAlertSignalsFallbackHtml) return;
  latestAlertSignalsFallbackHtml = list.innerHTML;
}

function restoreLatestAlertSignalsFallback() {
  const { list, badge } = getLatestAlertSignalsElements();
  if (!list) return;

  captureLatestAlertSignalsFallback(list);
  if (latestAlertSignalsFallbackHtml) {
    list.innerHTML = latestAlertSignalsFallbackHtml;
  }
  if (badge) {
    badge.textContent = "Example alerts shown";
    badge.classList.remove("live");
    badge.classList.add("soft");
  }
  latestAlertSignalTimestamp = "";
  updateMarketIntelligenceStrip();
}

function getAlertTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Alert signal";

  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (PBP_ALERT_TYPE_LABELS[key]) return PBP_ALERT_TYPE_LABELS[key];

  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Alert signal";
}

function getAlertSeverityClass(value) {
  const severity = String(value || "").trim().toLowerCase();
  if (["high", "medium", "low"].includes(severity)) return severity;
  return "low";
}

function formatLatestAlertTimestamp(value) {
  if (!value) return "Recent alert";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent alert";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function normalizeLatestAlertSignal(alert) {
  const alertType = alert?.alertType ?? alert?.alert_type;
  const marketQuestion = alert?.marketQuestion ?? alert?.market_question;
  const createdAt = alert?.createdAt ?? alert?.created_at;

  return {
    alertType: getAlertTypeLabel(alertType),
    marketQuestion: String(marketQuestion || "").trim() || "Market signal",
    reason: String(alert?.reason || "").trim() || "Signal detected from recent market activity.",
    severity: String(alert?.severity || "").trim(),
    createdAt,
  };
}

function renderLatestAlertSignalCard(alert) {
  const normalized = normalizeLatestAlertSignal(alert);
  const severityHtml = normalized.severity
    ? `
      <div class="pbp-live-alert-meta">
        <span class="pbp-alert-severity pbp-alert-severity-${escapeHtml(getAlertSeverityClass(normalized.severity))}">
          ${escapeHtml(getAlertTypeLabel(normalized.severity))}
        </span>
      </div>
    `
    : "";

  return `
    <div class="alert-item pbp-example-alert pbp-live-alert">
      <div class="pbp-example-alert-topline">
        <span class="pbp-alert-type">${escapeHtml(normalized.alertType)}</span>
        <span class="alert-time">${escapeHtml(formatLatestAlertTimestamp(normalized.createdAt))}</span>
      </div>
      <div class="alert-message">${escapeHtml(normalized.marketQuestion)}</div>
      <div class="alert-time">Reason: ${escapeHtml(normalized.reason)}</div>
      ${severityHtml}
    </div>
  `;
}

async function loadLatestAlertSignals() {
  const { list, badge } = getLatestAlertSignalsElements();
  if (!list) return;

  captureLatestAlertSignalsFallback(list);

  try {
    const res = await fetch("/api/alerts/recent", {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();

    if (!res.ok || !data.ok || !Array.isArray(data.alerts)) {
      throw new Error("Invalid recent alerts response");
    }

    const alerts = data.alerts
      .filter((alert) => alert && (alert.marketQuestion || alert.market_question))
      .slice(0, PBP_LATEST_ALERT_SIGNALS_LIMIT);

    if (!alerts.length) {
      restoreLatestAlertSignalsFallback();
      return;
    }

    latestAlertSignalTimestamp = normalizeLatestAlertSignal(alerts[0]).createdAt || "";
    list.innerHTML = alerts.map(renderLatestAlertSignalCard).join("");
    if (badge) {
      badge.textContent = "Live alerts active";
      badge.classList.add("live");
      badge.classList.remove("soft");
    }
    updateMarketIntelligenceStrip();
  } catch {
    console.warn("Latest alert signals unavailable; showing static examples.");
    restoreLatestAlertSignalsFallback();
  }
}

function stringifyJsonForUi(value) {
  return JSON.stringify(
    value ?? {},
    (_, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue),
    2
  );
}

function formatJsonBlock(value) {
  return escapeHtml(stringifyJsonForUi(value));
}

function normalizeCategoryValue(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed.toUpperCase() : "UNCATEGORIZED";
}

function getCategoryDisplayLabel(value) {
  const trimmed = String(value || "").trim();
  return trimmed || "Uncategorized";
}

function getPublicCategoryKey(market) {
  const category = normalizeCategoryValue(market?.displayCategory || market?.category);
  const text = [
    market?.category,
    market?.displayCategory,
    market?.eventGroup,
    market?.eventTitle,
    market?.marketTopic,
    market?.question,
    market?.slug,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Politics/election words intentionally override sports terms like "win"
  // or "House" collisions so public category filters stay trustworthy.
  if (category.includes("POLITIC") || /\b(election|elections|midterm|midterms|president|presidential|senate|house|party|republican|democrat|governor|congress|government|minister|prime minister|parliament|mayor|trump|biden|vote|referendum)\b/.test(text)) {
    return "POLITICS";
  }
  if (category.includes("SPORT") || /\b(nba|wnba|nfl|mlb|nhl|fifa|uefa|champions league|ufc|mma|soccer|football|baseball|basketball|hockey|tennis|golf|world cup|team|player|game)\b/.test(text)) {
    return "SPORTS";
  }
  if (category.includes("CRYPTO") || /\b(bitcoin|btc|ethereum|eth|solana|crypto|blockchain|web3|defi|stablecoin)\b/.test(text)) {
    return "CRYPTO";
  }
  if (category.includes("BUSINESS") || category.includes("ECON") || category.includes("FINANCE") || /\b(fed|rates?|rate cut|inflation|cpi|gdp|recession|tariff|earnings|stocks?|treasury)\b/.test(text)) {
    return "ECONOMY";
  }
  if (category.includes("CULTURE") || category.includes("NEWS") || /\b(movie|film|tv|album|music|celebrity|oscars?|grammys?|headline|news)\b/.test(text)) {
    return "CULTURE_NEWS";
  }
  return "OTHER";
}

function getPublicCategoryLabel(marketOrKey) {
  const key =
    typeof marketOrKey === "string"
      ? marketOrKey
      : getPublicCategoryKey(marketOrKey);
  return PUBLIC_BROWSE_CATEGORIES.find((category) => category.key === key)?.label || "Other";
}

function getMarketEventGroup(market) {
  const explicit = String(market?.eventGroup || market?.marketTopic || "").trim();
  if (explicit) return explicit;

  const text = [
    market?.eventTitle,
    market?.eventSlug,
    market?.slug,
    market?.question,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(2026 fifa world cup|fifa world cup|world cup)\b/.test(text)) return "2026 FIFA World Cup";
  if (/\b(nhl|stanley cup|hockey)\b/.test(text)) return "NHL / Stanley Cup";
  if (/\b(nfl|super bowl|football)\b/.test(text)) return "NFL";
  if (/\b(nba|basketball)\b/.test(text)) return "NBA";
  if (/\b(prime minister|minister|government|parliament|leadership|out as|resign|removed)\b/.test(text) && !/\b(election|elections|midterm|midterms|vote)\b/.test(text)) return "Government leadership";
  if (/\b(election|presidential|president|senate|house|governor|mayor|congress|vote|referendum)\b/.test(text)) return "Election";
  if (/\b(bitcoin|btc|ethereum|eth|solana|crypto|blockchain|web3|defi)\b/.test(text)) return "Crypto";
  if (/\b(fed|fomc|rate cut|rate cuts|interest rate|interest rates|cpi|inflation)\b/.test(text)) return "Fed / Rates";
  if (/\b(movie|film|tv|album|music|celebrity|oscars?|grammys?|emmys?|headline|news)\b/.test(text)) return "Culture/News";

  return "";
}

function getMarketFamilyKey(market) {
  const explicit = String(market?.marketFamilyKey || "").trim();
  if (explicit) return explicit;

  const group = getMarketEventGroup(market);
  if (!group) return "";

  return `${getPublicCategoryKey(market).toLowerCase()}:${group
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function getMarketOutcomeLabel(market) {
  const explicit = String(market?.outcomeLabel || market?.shortQuestion || "").trim();
  if (explicit) return explicit;

  const question = String(market?.question || "").trim();
  const worldCupMatch = question.match(/^Will\s+(.+?)\s+win\s+the\s+2026\s+FIFA\s+World\s+Cup\??$/i);
  if (worldCupMatch?.[1]) return worldCupMatch[1].trim();

  return question.replace(/^Will\s+/i, "").replace(/\?$/, "").trim() || question;
}

function getCategoryOptionLabel(value) {
  if (value === "ALL") return "All";
  return getPublicCategoryLabel(value);
}

function getAvailableHomepageCategories(markets) {
  const categoryMap = new Map();

  (Array.isArray(markets) ? markets : []).forEach((market) => {
    const key = getPublicCategoryKey(market);
    const label = getPublicCategoryLabel(key);
    if (!categoryMap.has(key)) {
      categoryMap.set(key, label);
    }
  });

  return Array.from(categoryMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
}

function getCategoryCounts(markets) {
  const counts = new Map();

  (Array.isArray(markets) ? markets : []).forEach((market) => {
    const key = getPublicCategoryKey(market);
    const label = getPublicCategoryLabel(key);
    const existing = counts.get(key) || { label, count: 0 };
    existing.count += 1;
    counts.set(key, existing);
  });

  return PUBLIC_BROWSE_CATEGORIES
    .filter((category) => category.key !== "ALL")
    .map((category) => ({
      value: category.key,
      label: category.label,
      count: counts.get(category.key)?.count || 0,
    }));
}

function getCategoryFilteredMarkets(markets) {
  const base = Array.isArray(markets) ? markets : [];
  if (activeHomepageCategory === "ALL") return base;
  return base.filter(
    (market) => getPublicCategoryKey(market) === activeHomepageCategory
  );
}

function getUsableHomepageMarkets() {
  return getCategoryFilteredMarkets(liveMarketsCache).filter(
    (market) => market && market.question && market.url
  );
}

function getMarketDisplayReason(market) {
  return (
    market?.displayReason ||
    market?.marketReason ||
    market?.signalReason ||
    market?.actionReason ||
    "High activity makes this market worth watching."
  );
}

function getMarketSignalLabel(market) {
  return market?.marketSignal || "Worth watching";
}

function getMarketOpportunityScore(market) {
  const score = market?.opportunityScore ?? market?.confidenceScore;
  return Number.isFinite(Number(score)) ? Number(score) : null;
}

function formatActivityScore(market) {
  const score = getMarketOpportunityScore(market);
  return score === null ? "Activity unavailable" : `${score}/100`;
}

function getMarketFreshnessLabel(market) {
  if (market?.dataFreshness === "fresh") return "Fresh";
  if (market?.dataFreshness === "stale") return "Limited";
  return "Unknown";
}

function getActiveGroupedEventCount(markets = liveMarketsCache) {
  const eventKeys = new Set();
  (Array.isArray(markets) ? markets : [])
    .filter((market) => market && market.question && market.url && isDiscoveryQualityMarket(market))
    .forEach((market) => {
      const familyKey = getMarketFamilyKey(market);
      if (familyKey) eventKeys.add(familyKey);
    });
  return eventKeys.size;
}

function updateMarketIntelligenceStrip() {
  const liveCountEl = document.getElementById("marketIntelLiveCount");
  const eventCountEl = document.getElementById("marketIntelEventCount");
  const latestSignalEl = document.getElementById("marketIntelLatestSignal");

  const activeMarkets = (Array.isArray(liveMarketsCache) ? liveMarketsCache : [])
    .filter((market) => market && market.question && market.url && isDiscoveryQualityMarket(market));
  if (liveCountEl) liveCountEl.textContent = activeMarkets.length ? String(activeMarkets.length) : "--";
  if (eventCountEl) {
    const groupedCount = getActiveGroupedEventCount(activeMarkets);
    eventCountEl.textContent = groupedCount ? String(groupedCount) : "--";
  }
  if (latestSignalEl) {
    latestSignalEl.textContent = latestAlertSignalTimestamp
      ? formatLatestAlertTimestamp(latestAlertSignalTimestamp)
      : "Awaiting signal";
  }
}

function getMarketHeatBadges(market) {
  const badges = [];
  const volume = getNonNegativeNumber(market?.volume24hr) ?? 0;
  const liquidity = getNonNegativeNumber(market?.liquidity) ?? 0;
  const movement = hasMarketMovementData(market) ? Math.abs(getMarketMovementValue(market)) : 0;
  const opportunityScore = getMarketOpportunityScore(market) || 0;
  const hotScore = getNonNegativeNumber(market?.hotScore) ?? 0;

  if (hotScore > 800000 || opportunityScore >= 80) badges.push({ label: "Hot", type: "hot" });
  if (movement >= 0.04) badges.push({ label: "Moving", type: "moving" });
  if (volume >= 250000) badges.push({ label: "High volume", type: "volume" });
  if (liquidity >= 150000) badges.push({ label: "Liquid", type: "liquid" });
  if (market?.dataFreshness === "fresh" || market?.lastUpdated) badges.push({ label: "New signal", type: "new" });

  return badges.slice(0, 4);
}

function getGroupHeatBadges(group) {
  const children = Array.isArray(group?.children) ? group.children : [];
  const totalVolume = children.reduce((sum, market) => sum + (getNonNegativeNumber(market.volume24hr) ?? 0), 0);
  const totalLiquidity = children.reduce((sum, market) => sum + (getNonNegativeNumber(market.liquidity) ?? 0), 0);
  const maxMovement = children.reduce(
    (best, market) => Math.max(best, hasMarketMovementData(market) ? Math.abs(getMarketMovementValue(market)) : 0),
    0
  );
  const maxScore = children.reduce(
    (best, market) => Math.max(best, getMarketOpportunityScore(market) || 0, (getNonNegativeNumber(market.hotScore) ?? 0) / 10000),
    0
  );
  const badges = [];

  if (maxScore >= 80 || totalVolume >= 1000000) badges.push({ label: "Hot", type: "hot" });
  if (maxMovement >= 0.04) badges.push({ label: "Moving", type: "moving" });
  if (totalVolume >= 500000) badges.push({ label: "High volume", type: "volume" });
  if (totalLiquidity >= 300000) badges.push({ label: "Liquid", type: "liquid" });
  if (children.some((market) => market?.dataFreshness === "fresh" || market?.lastUpdated)) {
    badges.push({ label: "New signal", type: "new" });
  }

  return badges.slice(0, 4);
}

function renderHeatBadges(badges = []) {
  const safeBadges = Array.isArray(badges) ? badges.filter((badge) => badge?.label) : [];
  if (!safeBadges.length) return "";

  return `
    <div class="heat-badge-row">
      ${safeBadges
        .map(
          (badge) => `
            <span class="heat-badge heat-badge-${safeAttr(badge.type || "neutral")}">
              ${safeText(badge.label)}
            </span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMovementVisual(market) {
  const movement = getMarketMovementValue(market);
  if (!hasMarketMovementData(market) || !movement) return "";

  const direction = movement > 0 ? "up" : "down";
  const width = Math.max(8, Math.min(100, Math.abs(movement) * 1000));
  const arrow = movement > 0 ? "+" : "-";

  return `
    <div class="movement-visual movement-${direction}" aria-label="Recent movement ${safeAttr(formatChangeAsProbability(movement))}">
      <span class="movement-arrow">${safeText(arrow)}</span>
      <span class="movement-track"><span style="width:${safeAttr(width)}%;"></span></span>
      <span class="movement-label">${safeText(formatChangeAsProbability(movement))}</span>
    </div>
  `;
}

function getMarketByDetailId(detailId) {
  const target = String(detailId || "").trim();
  if (!target) return null;

  return (Array.isArray(liveMarketsCache) ? liveMarketsCache : []).find((market) => {
    const ids = [
      getMarketDetailId(market),
      getMarketTrackingId(market),
      market?.id,
      market?.marketId,
      market?.conditionId,
      market?.slug,
    ].map((value) => String(value || "").trim());
    return ids.includes(target);
  }) || null;
}

function getMarketDetailId(market) {
  return String(
    getMarketTrackingId(market) ||
      market?.id ||
      market?.marketId ||
      market?.conditionId ||
      market?.slug ||
      ""
  ).trim();
}

function buildWatchlistInterestPayload(market, source, email) {
  return {
    email,
    marketId: getWatchlistMarketKey(market),
    marketQuestion: String(market?.question || ""),
    eventTitle: getMarketEventGroup(market) || "",
    category: getPublicCategoryLabel(market),
    yesProbability: hasUsableProbability(market?.yesPriceLive) ? getFiniteNumber(market.yesPriceLive) : null,
    volume: getNonNegativeNumber(market?.volume24hr),
    liquidity: getNonNegativeNumber(market?.liquidity),
    source,
    timestamp: new Date().toISOString(),
  };
}

async function submitWatchlistInterest(market, source, email, options = {}) {
  const key = getWatchlistMarketKey(market);
  if (!market || !key) {
    showWatchlistStatus("Could not identify this market.", "error");
    return;
  }

  if (isMarketWatched(key)) {
    setWatchlistButtonStateForKey(key, "watching");
    showWatchlistStatus("Already watching");
    if (options.closePrompt) closeWatchlistEmailPrompt();
    return;
  }

  if (!isValidEmail(email)) {
    openWatchlistEmailPrompt({ market, source });
    return;
  }

  try {
    await postJson("/api/watchlist-interest", buildWatchlistInterestPayload(market, source, email));
    storeWatchlistEmail(email);
    storeWatchedMarketKey(key);
    setWatchlistButtonStateForKey(key, "watching");
    showWatchlistStatus("Added to watchlist");
    if (options.closePrompt) closeWatchlistEmailPrompt();
  } catch (error) {
    const message = error.message || "Could not add this market yet.";
    if (options.closePrompt) {
      setWatchlistPromptStatus("error", message);
    } else {
      showWatchlistStatus(message, "error");
    }
  }
}

function renderWatchlistButton(market, source = "market-card") {
  const key = getWatchlistMarketKey(market);
  if (!key || !market?.question) return "";

  const watching = isMarketWatched(key);
  return `
    <button
      class="watchlist-action-btn ${watching ? "is-watching" : ""}"
      type="button"
      data-watchlist-key="${safeAttr(key)}"
      data-market-detail-id="${safeAttr(getMarketDetailId(market))}"
      data-watchlist-source="${safeAttr(source)}"
      aria-label="${watching ? "Already watching this market" : "Notify me about this market"}"
    >${watching ? "Watching" : "Notify me"}</button>
  `;
}

function bindWatchlistInterestTracking() {
  if (watchlistInterestTrackingBound) return;
  watchlistInterestTrackingBound = true;

  document.addEventListener("click", async (event) => {
    const button = event.target?.closest?.(".watchlist-action-btn");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const key = button.dataset.watchlistKey || button.dataset.marketDetailId || "";
    const market = getMarketByDetailId(button.dataset.marketDetailId) ||
      (Array.isArray(liveMarketsCache) ? liveMarketsCache : []).find((item) => getWatchlistMarketKey(item) === key);
    const source = button.dataset.watchlistSource || "market-card";

    if (!market) {
      showWatchlistStatus("Could not identify this market.", "error");
      return;
    }

    if (isMarketWatched(key)) {
      setWatchlistButtonStateForKey(key, "watching");
      showWatchlistStatus("Already watching");
      return;
    }

    const email = getBestWatchlistEmail();
    if (email) {
      await submitWatchlistInterest(market, source, email);
      return;
    }

    openWatchlistEmailPrompt({ market, source });
  });
}

function getStrengthPercent(value, scale) {
  const numeric = getNonNegativeNumber(value);
  const safeScale = getFiniteNumber(scale);
  if (numeric === null || numeric <= 0 || safeScale === null || safeScale <= 0) return 0;
  return Math.max(4, Math.min(100, (numeric / safeScale) * 100));
}

function renderMetricBar(label, valueLabel, percent, className = "") {
  const safePercent = Math.max(0, Math.min(100, getFiniteNumber(percent) ?? 0));

  return `
    <div class="market-detail-metric-bar ${safeAttr(className)} ${safePercent <= 0 ? "is-empty" : ""}">
      <div class="market-detail-metric-bar-top">
        <span>${safeText(label)}</span>
        <strong>${safeText(valueLabel)}</strong>
      </div>
      <div class="market-detail-bar-track">
        <span style="width:${safeAttr(safePercent)}%;"></span>
      </div>
    </div>
  `;
}

function getMarketSignalScore(market) {
  return Math.max(0, Math.min(100, Math.round(getDiscoveryRankScore(market))));
}

function renderSignalMeter(market) {
  const score = getMarketSignalScore(market);
  const activeSegments = Math.max(1, Math.min(5, Math.ceil(score / 20)));

  return `
    <div class="signal-meter" aria-label="Signal heat ${safeAttr(activeSegments)} of 5">
      ${Array.from({ length: 5 })
        .map((_, index) => `<span class="${index < activeSegments ? "active" : ""}"></span>`)
        .join("")}
      <strong>${safeText(score)}/100 signal heat</strong>
    </div>
  `;
}

function getWhyMarketIsInteresting(market) {
  const reasons = [];
  const movement = hasMarketMovementData(market) ? Math.abs(getMarketMovementValue(market)) : 0;
  const volume = getNonNegativeNumber(market?.volume24hr) ?? 0;
  const liquidity = getNonNegativeNumber(market?.liquidity) ?? 0;
  const eventGroup = getMarketEventGroup(market);
  const yesPrice = getFiniteNumber(market?.yesPriceLive);

  if (volume >= 250000) {
    reasons.push("High volume: many traders are watching this market.");
  }
  if (movement >= 0.04) {
    reasons.push("Strong movement: odds recently shifted.");
  }
  if (liquidity >= 150000) {
    reasons.push("High liquidity: the market may be easier to enter or exit.");
  }
  if (yesPrice !== null && yesPrice >= 0.75 && yesPrice <= 1) {
    reasons.push("High YES probability: the market is pricing this outcome as more likely right now.");
  }
  if (yesPrice !== null && yesPrice >= 0 && yesPrice <= 0.25) {
    reasons.push("Low YES probability: the market is pricing this outcome as less likely right now.");
  }
  if (eventGroup) {
    reasons.push("Related event: compare connected markets in the event view.");
  }
  if (market?.dataFreshness === "fresh" || market?.lastUpdated) {
    reasons.push("New signal: recent updates make this market worth a fresh look.");
  }

  return reasons.length
    ? reasons.slice(0, 4)
    : ["This market is active enough to appear in the current discovery feed."];
}

function ensureMarketDetailDrawer() {
  let drawer = document.getElementById("marketDetailDrawer");
  if (drawer) return drawer;

  drawer = document.createElement("div");
  drawer.id = "marketDetailDrawer";
  drawer.className = "market-detail-drawer-shell market-detail-drawer-hidden";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="market-detail-backdrop" data-market-detail-close="true"></div>
    <aside class="market-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="marketDetailTitle">
      <div id="marketDetailContent"></div>
    </aside>
  `;
  document.body.appendChild(drawer);
  return drawer;
}

// The drawer snapshot is a current-signal meter, not a fake price-history chart.
function renderMarketDetailOverview(market) {
  const probability = hasUsableProbability(market?.yesPriceLive) ? getFiniteNumber(market.yesPriceLive) : null;
  const probabilityPercent = probability !== null ? Math.max(0, Math.min(100, probability * 100)) : 0;
  const volumePercent = getStrengthPercent(market?.volume24hr, 1000000);
  const liquidityPercent = getStrengthPercent(market?.liquidity, 500000);
  const movement = getMarketMovementValue(market);
  const hasMovement = hasMarketMovementData(market);
  const movementPercent = hasMovement && movement
    ? Math.max(4, Math.min(100, Math.abs(movement) * 1000))
    : 0;

  return `
    <div class="market-detail-snapshot-card">
      <div class="market-detail-section-heading">
        <p class="market-small">Signal snapshot</p>
        <h3>Current market signals</h3>
        <p class="alert-time">This is not price history. It is a CSS-only snapshot from current probability, movement, volume, and liquidity fields.</p>
      </div>
      ${renderSignalMeter(market)}
      <div class="market-detail-visual-stack">
        ${renderMetricBar("YES probability", formatProbability(market.yesPriceLive), probabilityPercent, "probability")}
        ${renderMetricBar("Movement", hasMovement ? formatChangeAsProbability(movement) : "No movement data yet", movementPercent, movement > 0 ? "moving-up" : movement < 0 ? "moving-down" : "")}
        ${renderMetricBar("Volume", formatMoney(market.volume24hr, "Volume unavailable"), volumePercent, "volume")}
        ${renderMetricBar("Liquidity", formatMoney(market.liquidity, "Liquidity unavailable"), liquidityPercent, "liquidity")}
      </div>
    </div>

    <div class="market-detail-why">
      <h3>Why this is interesting</h3>
      <div class="alerts-list">
        ${getWhyMarketIsInteresting(market)
          .map(
            (reason) => `
              <div class="alert-item">
                <div class="alert-message">${safeText(reason)}</div>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderMarketDetailMarketTab(market) {
  const eventGroup = getMarketEventGroup(market);
  const movement = getMarketMovementValue(market);
  const hasMovement = hasMarketMovementData(market);

  return `
    <div class="market-meta market-detail-meta-grid">
      <div class="meta-box"><span class="meta-label">Full Question</span><span class="meta-value">${safeText(market.question)}</span></div>
      <div class="meta-box"><span class="meta-label">Event / Group</span><span class="meta-value">${safeText(eventGroup || "Event unavailable")}</span></div>
      <div class="meta-box"><span class="meta-label">Category</span><span class="meta-value">${safeText(getPublicCategoryLabel(market))}</span></div>
      <div class="meta-box"><span class="meta-label">YES Probability</span><span class="meta-value">${safeText(formatProbability(market.yesPriceLive))}</span></div>
      <div class="meta-box"><span class="meta-label">24h Volume</span><span class="meta-value">${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</span></div>
      <div class="meta-box"><span class="meta-label">Liquidity</span><span class="meta-value">${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))}</span></div>
      <div class="meta-box"><span class="meta-label">Movement</span><span class="meta-value">${safeText(hasMovement ? formatChangeAsProbability(movement) : "No movement data yet")}</span></div>
      <div class="meta-box"><span class="meta-label">Updated</span><span class="meta-value">${safeText(formatTimestamp(market.lastUpdated))}</span></div>
    </div>
  `;
}

function getMarketShareCopy(market) {
  const eventGroup = getMarketEventGroup(market);
  const shortQuestion = getMarketOutcomeLabel(market) || market.question;
  const movement = getMarketMovementValue(market);
  const detailParts = [
    hasUsableProbability(market.yesPriceLive) ? `YES is around ${formatProbability(market.yesPriceLive)}` : "",
    getNonNegativeNumber(market.volume24hr) !== null ? `${formatMoney(market.volume24hr)} 24h volume` : "",
    getNonNegativeNumber(market.liquidity) !== null ? `${formatMoney(market.liquidity)} liquidity` : "",
    hasMarketMovementData(market) ? `${formatChangeAsProbability(movement)} recent movement` : "",
  ].filter(Boolean);
  const hook = "This prediction market is moving.";
  const caption = [
    `Watching this on House of Markets: "${market.question}"`,
    detailParts.length ? detailParts.join(" with ") + "." : "",
    "Not financial advice. Real market action happens on Polymarket.",
  ].filter(Boolean).join("\n");
  const storyCaption = `Market watch: ${shortQuestion} - see what is moving on House of Markets.`;

  return {
    eventGroup,
    shortQuestion,
    hook,
    caption,
    storyCaption,
  };
}

function renderMarketSocialShareCard(market, ids = {}) {
  const share = getMarketShareCopy(market);
  const textareaId = ids.textareaId || "marketDetailShareText";
  const buttonId = ids.buttonId || "copyMarketShareTextBtn";
  const statusId = ids.statusId || "marketDetailCopyStatus";

  return `
    <div class="market-detail-social-card">
      <div class="market-detail-section-heading">
        <p class="market-small">Share copy</p>
        <h3>${safeText(share.hook)}</h3>
        <p class="alert-time">${safeText(share.eventGroup ? `${share.eventGroup}: ` : "")}${safeText(share.shortQuestion)}</p>
      </div>

      <label class="market-detail-share-field">
        <span class="meta-label">Ready-to-copy caption</span>
        <textarea id="${safeAttr(textareaId)}" rows="5" readonly>${safeText(share.caption)}</textarea>
      </label>

      <div class="market-detail-share-box">
        <span class="meta-label">Story caption</span>
        <p>${safeText(share.storyCaption)}</p>
      </div>

      <div class="market-footer market-detail-share-actions">
        <button id="${safeAttr(buttonId)}" type="button">Copy share text</button>
        <span id="${safeAttr(statusId)}" class="alert-time" aria-live="polite"></span>
      </div>
    </div>
  `;
}

function renderMarketDetailSocialTab(market) {
  return renderMarketSocialShareCard(market);
}

function renderMarketDetailTabContent(market) {
  if (activeMarketDetailTab === "market") return renderMarketDetailMarketTab(market);
  if (activeMarketDetailTab === "social") return renderMarketDetailSocialTab(market);
  return renderMarketDetailOverview(market);
}

function renderMarketDetailDrawer(market) {
  const eventGroup = getMarketEventGroup(market);
  const content = document.getElementById("marketDetailContent");
  if (!content) return;
  const probabilityMeta = getMarketProbabilityMeta(market.yesPriceLive);

  content.innerHTML = `
    <div class="market-detail-header">
      <div>
        <p class="market-small">Market window</p>
        <h2 id="marketDetailTitle">${safeText(market.question)}</h2>
        <div class="market-context-row">
          <span>${safeText(getPublicCategoryLabel(market))}</span>
          ${eventGroup ? `<span>${safeText(eventGroup)}</span>` : ""}
        </div>
      </div>
      <button class="market-detail-close-btn" type="button" data-market-detail-close="true" aria-label="Close market detail">Close</button>
    </div>

    ${renderHeatBadges(getMarketHeatBadges(market))}
    ${renderMovementVisual(market)}

    <div class="market-detail-primary-stats">
      <span><strong>${safeText(probabilityMeta.label)}</strong><small>${safeText(probabilityMeta.note)}</small></span>
      <span><strong>${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</strong><small>24h vol</small></span>
      <span><strong>${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))}</strong><small>liquidity</small></span>
    </div>

    <div class="market-detail-tabs" role="tablist" aria-label="Market detail tabs">
      ${["overview", "market", "social"]
        .map(
          (tab) => `
            <button
              class="${activeMarketDetailTab === tab ? "active" : ""}"
              type="button"
              data-market-detail-tab="${safeAttr(tab)}"
              role="tab"
              aria-selected="${activeMarketDetailTab === tab ? "true" : "false"}"
            >${safeText(tab[0].toUpperCase() + tab.slice(1))}</button>
          `
        )
        .join("")}
    </div>

    <div class="market-detail-tab-panel">
      ${renderMarketDetailTabContent(market)}
    </div>

    <div class="market-footer market-detail-actions">
      <a
        class="market-link market-link-primary"
        href="${safeUrl(market.url)}"
        target="_blank"
        rel="noopener noreferrer"
        data-outbound-click="polymarket"
        data-market-id="${safeAttr(getMarketTrackingId(market))}"
        data-market-slug="${safeAttr(market.slug)}"
        data-market-question="${safeAttr(market.question)}"
        data-market-url="${safeAttr(market.url)}"
        data-source-section="market-detail-drawer"
        data-cta="view-on-polymarket"
      >View on Polymarket</a>
      ${renderMarketPageLink(market)}
      ${renderWatchlistButton(market, "market-detail-drawer")}
      <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY YES">Preview YES</button>
      <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY NO">Preview NO</button>
    </div>
  `;

  bindMarketDetailControls();
  bindTradeActionButtons();
}

function openMarketDetailDrawer(detailId) {
  const market = getMarketByDetailId(detailId);
  if (!market) return;

  activeMarketDetailId = String(detailId || getMarketTrackingId(market));
  activeMarketDetailTab = "overview";

  const drawer = ensureMarketDetailDrawer();
  drawer.classList.remove("market-detail-drawer-hidden");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("market-detail-open");
  renderMarketDetailDrawer(market);
}

function closeMarketDetailDrawer() {
  const drawer = document.getElementById("marketDetailDrawer");
  if (!drawer) return;

  drawer.classList.add("market-detail-drawer-hidden");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("market-detail-open");
  activeMarketDetailId = "";
  activeMarketDetailTab = "overview";
}

function bindMarketDetailControls() {
  const drawer = ensureMarketDetailDrawer();
  const copyShareBtn = drawer.querySelector("#copyMarketShareTextBtn");
  const shareText = drawer.querySelector("#marketDetailShareText");
  const copyStatus = drawer.querySelector("#marketDetailCopyStatus");

  drawer.querySelectorAll("[data-market-detail-close]").forEach((element) => {
    element.onclick = closeMarketDetailDrawer;
  });

  drawer.querySelectorAll("[data-market-detail-tab]").forEach((button) => {
    button.onclick = () => {
      const nextTab = button.dataset.marketDetailTab || "overview";
      const market = getMarketByDetailId(activeMarketDetailId);
      if (!market) return;
      activeMarketDetailTab = nextTab;
      renderMarketDetailDrawer(market);
    };
  });

  if (copyShareBtn && shareText) {
    copyShareBtn.onclick = async () => {
      const text = shareText.value || "";
      try {
        await navigator.clipboard.writeText(text);
        if (copyStatus) copyStatus.textContent = "Copied.";
      } catch {
        shareText.focus();
        shareText.select();
        if (copyStatus) copyStatus.textContent = "Select the text above to copy.";
      }
    };
  }
}

function bindMarketDetailOpeners() {
  if (marketDetailOpenersBound) return;
  marketDetailOpenersBound = true;

  const interactiveSelector = [
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "label",
    "summary",
    "details",
    "[role='button']:not([data-market-detail-id])",
    "[data-top-discovery-tab]",
    "[data-category-value]",
    "[data-discover-view]",
    "[data-market-detail-tab]",
    "[data-market-detail-close]",
    ".trade-action-btn",
    ".market-link",
    ".event-detail-open-btn",
  ].join(", ");

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.(interactiveSelector)) return;
    const card = event.target?.closest?.("[data-market-detail-id]");
    if (!card) return;
    openMarketDetailDrawer(card.dataset.marketDetailId);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target?.closest?.(interactiveSelector)) return;
    const card = event.target?.closest?.("[data-market-detail-id]");
    if (!card) return;
    event.preventDefault();
    openMarketDetailDrawer(card.dataset.marketDetailId);
  });
}

function bindMarketDetailGlobalControls() {
  ensureMarketDetailDrawer();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMarketDetailDrawer();
  });
}

function getTopDiscoveryCategory(tab = activeTopDiscoveryTab) {
  const map = {
    trending: "ALL",
    sports: "SPORTS",
    politics: "POLITICS",
    crypto: "CRYPTO",
    culture: "CULTURE_NEWS",
  };
  return map[tab] || "ALL";
}

function getTopDiscoveryTabForCategory(category = activeHomepageCategory) {
  const map = {
    ALL: "trending",
    SPORTS: "sports",
    POLITICS: "politics",
    CRYPTO: "crypto",
    CULTURE_NEWS: "culture",
  };
  return map[category] || "trending";
}

function renderPublicTopDiscoveryTabs() {
  document.querySelectorAll("[data-top-discovery-tab]").forEach((button) => {
    const tab = button.dataset.topDiscoveryTab || "trending";
    button.classList.toggle("active", tab === activeTopDiscoveryTab);
    button.setAttribute("aria-pressed", tab === activeTopDiscoveryTab ? "true" : "false");
  });
}

function getQuickDiscoveryMarkets() {
  const category = getTopDiscoveryCategory();
  const source = (Array.isArray(liveMarketsCache) ? liveMarketsCache : [])
    .filter((market) => market && market.question && market.url && isDiscoveryQualityMarket(market));
  const filtered = category === "ALL"
    ? source
    : source.filter((market) => getPublicCategoryKey(market) === category);

  return filtered
    .sort((a, b) => getDiscoveryRankScore(b) - getDiscoveryRankScore(a))
    .slice(0, DISCOVER_CANDIDATE_LIMIT);
}

function getQuestionClarityScore(market) {
  const question = String(market?.question || "").trim();
  if (!question) return -80;

  let score = 0;
  if (question.length >= 35 && question.length <= 150) score += 18;
  if (question.length > 190) score -= 24;
  if (question.length > 240) score -= 40;
  if ((question.match(/[?,;:]/g) || []).length > 5) score -= 10;
  if (/^(will|who|which|what|when|how)\b/i.test(question)) score += 8;
  return score;
}

function isWeakFeaturedCandidate(market) {
  const probability = getFiniteNumber(market?.yesPriceLive);
  const volume = getNonNegativeNumber(market?.volume24hr);
  const liquidity = getNonNegativeNumber(market?.liquidity);
  const question = String(market?.question || "").trim();

  return (
    !hasUsableProbability(probability) ||
    probability <= 0.01 ||
    volume === null ||
    liquidity === null ||
    question.length > 220 ||
    (market?.dataFreshness === "stale" && (volume || 0) < 250000 && (liquidity || 0) < 100000)
  );
}

function getFeaturedMarketScore(market) {
  const probability = hasUsableProbability(market?.yesPriceLive) ? getFiniteNumber(market.yesPriceLive) : null;
  const volume = getNonNegativeNumber(market?.volume24hr) ?? 0;
  const liquidity = getNonNegativeNumber(market?.liquidity) ?? 0;
  const movement = hasMarketMovementData(market) ? Math.abs(getMarketMovementValue(market)) : 0;
  const probabilityFit = probability === null
    ? -35
    : Math.max(0, 28 - Math.abs(probability - 0.5) * 56);

  return (
    getDiscoveryRankScore(market) +
    getQuestionClarityScore(market) +
    Math.log10(volume + 1) * 6 +
    Math.log10(liquidity + 1) * 6 +
    movement * 220 +
    probabilityFit +
    (getMarketEventGroup(market) ? 12 : 0) +
    (market?.dataFreshness === "fresh" ? 8 : 0) -
    (isWeakFeaturedCandidate(market) ? 80 : 0)
  );
}

function getFeaturedMarket() {
  const markets = getQuickDiscoveryMarkets();
  const strongMarkets = markets.filter((market) => !isWeakFeaturedCandidate(market));
  const source = strongMarkets.length ? strongMarkets : markets;

  // Featured Market is the first impression, so it avoids weak or awkward
  // long-shot cards when there are stronger, clearer markets available.
  return [...source].sort((a, b) => getFeaturedMarketScore(b) - getFeaturedMarketScore(a))[0] || null;
}

function getPlayfulDiscoveryLabel(market) {
  const movement = hasMarketMovementData(market) ? Math.abs(getMarketMovementValue(market)) : 0;
  const volume = getNonNegativeNumber(market?.volume24hr) ?? 0;
  const liquidity = getNonNegativeNumber(market?.liquidity) ?? 0;

  if (movement >= 0.05) return "Big mover";
  if (volume >= 500000) return "High-volume event";
  if (liquidity >= 250000) return "Crowd is watching";
  if (getMarketEventGroup(market)) return "Hot right now";
  if (market?.dataFreshness === "fresh" || market?.lastUpdated) return "New signal";
  return "Weird but active";
}

function renderCompactMarketActions(market, sourceSection) {
  const trackingSource = normalizeOutboundSourceSection(sourceSection);

  return `
    <div class="market-footer quick-market-actions">
      <a
        class="market-link market-link-primary"
        href="${safeUrl(market.url)}"
        target="_blank"
        rel="noopener noreferrer"
        data-outbound-click="polymarket"
        data-market-id="${safeAttr(getMarketTrackingId(market))}"
        data-market-slug="${safeAttr(market.slug)}"
        data-market-question="${safeAttr(market.question)}"
        data-market-url="${safeAttr(market.url)}"
        data-source-section="${safeAttr(trackingSource)}"
        data-cta="view-on-polymarket"
      >View on Polymarket</a>
      ${renderMarketPageLink(market)}
      ${renderWatchlistButton(market, sourceSection)}
      <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY YES">Preview YES</button>
      <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY NO">Preview NO</button>
    </div>
  `;
}

function renderFeaturedMarketPanel(market) {
  if (!market) {
    return `<p class="empty">No featured market is available for this tab yet.</p>`;
  }

  const eventGroup = getMarketEventGroup(market);
  const probabilityMeta = getMarketProbabilityMeta(market.yesPriceLive);

  return `
    <div
      class="featured-market-content market-detail-clickable"
      data-market-detail-id="${safeAttr(getMarketDetailId(market))}"
      role="button"
      tabindex="0"
      aria-label="Open market detail for ${safeAttr(market.question)}"
    >
      <div class="market-context-row">
        <span>${safeText(getPublicCategoryLabel(market))}</span>
        ${eventGroup ? `<span>${safeText(eventGroup)}</span>` : ""}
      </div>
      <div class="playful-label">${safeText(getPlayfulDiscoveryLabel(market))}</div>
      <h2>${safeText(market.question)}</h2>
      ${renderHeatBadges(getMarketHeatBadges(market))}
      ${renderMovementVisual(market)}
      <div class="quick-market-stat-row">
        <span><strong>${safeText(probabilityMeta.label)}</strong><small>${safeText(probabilityMeta.note)}</small></span>
        <span><strong>${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</strong><small>24h vol</small></span>
        <span><strong>${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))}</strong><small>liquidity</small></span>
      </div>
      ${renderCompactMarketActions(market, "featured-market")}
    </div>
  `;
}

function renderQuickDiscoveryCard(market) {
  const eventGroup = getMarketEventGroup(market);
  const probabilityMeta = getMarketProbabilityMeta(market.yesPriceLive);

  return `
    <article
      class="quick-market-card market-detail-clickable"
      data-market-detail-id="${safeAttr(getMarketDetailId(market))}"
      role="button"
      tabindex="0"
      aria-label="Open market detail for ${safeAttr(market.question)}"
    >
      <div>
        <div class="quick-market-topline">
          <span class="playful-label">${safeText(getPlayfulDiscoveryLabel(market))}</span>
          <span>${safeText(getPublicCategoryLabel(market))}</span>
        </div>
        <h3>${safeText(market.question)}</h3>
        ${eventGroup ? `<p class="alert-time">${safeText(eventGroup)}</p>` : ""}
      </div>
      ${renderMovementVisual(market)}
      <div class="quick-market-stat-row">
        <span><strong>${safeText(probabilityMeta.label)}</strong><small>${safeText(probabilityMeta.note)}</small></span>
        <span><strong>${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</strong><small>vol</small></span>
      </div>
      ${renderCompactMarketActions(market, "trending-now")}
    </article>
  `;
}

function renderHomepageQuickDiscovery() {
  renderPublicTopDiscoveryTabs();

  const featuredEl = document.getElementById("featuredMarketPanel");
  const feedEl = document.getElementById("quickDiscoveryFeed");
  const toggleBtn = document.getElementById("quickDiscoveryToggle");
  if (!featuredEl || !feedEl) return;

  const markets = getQuickDiscoveryMarkets();
  const featured = getFeaturedMarket();
  const feedMarkets = markets
    .filter((market) => market !== featured)
    .slice(0, quickDiscoveryExpanded ? QUICK_DISCOVERY_EXPANDED_LIMIT : QUICK_DISCOVERY_INITIAL_LIMIT);

  featuredEl.innerHTML = renderFeaturedMarketPanel(featured);
  if (featured) {
    featuredEl.classList.add("market-detail-clickable");
    featuredEl.dataset.marketDetailId = getMarketDetailId(featured);
    featuredEl.setAttribute("role", "button");
    featuredEl.setAttribute("tabindex", "0");
    featuredEl.setAttribute("aria-label", `Open market detail for ${featured.question || "featured market"}`);
  } else {
    featuredEl.classList.remove("market-detail-clickable");
    delete featuredEl.dataset.marketDetailId;
    featuredEl.removeAttribute("role");
    featuredEl.removeAttribute("tabindex");
    featuredEl.removeAttribute("aria-label");
  }
  feedEl.innerHTML = feedMarkets.length
    ? feedMarkets.map(renderQuickDiscoveryCard).join("")
    : `<p class="empty">No trending markets found for this tab yet.</p>`;

  if (toggleBtn) {
    const canExpand = markets.length > QUICK_DISCOVERY_INITIAL_LIMIT + 1;
    toggleBtn.hidden = !canExpand;
    toggleBtn.textContent = quickDiscoveryExpanded ? "Show less" : "Show more";
    toggleBtn.onclick = () => {
      quickDiscoveryExpanded = !quickDiscoveryExpanded;
      renderHomepageQuickDiscovery();
    };
  }

  bindTradeActionButtons();
  bindMarketDetailOpeners();
}

function bindPublicTopDiscoveryTabs() {
  document.querySelectorAll("[data-top-discovery-tab]").forEach((button) => {
    button.onclick = () => {
      const tab = button.dataset.topDiscoveryTab || "trending";
      if (tab === "alerts") {
        document.getElementById("pbpAlertsComingSoon")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      activeTopDiscoveryTab = tab;
      quickDiscoveryExpanded = false;
      activeHomepageCategory = getTopDiscoveryCategory(tab);
      currentDiscoverView = "opportunities";
      renderHomepageQuickDiscovery();
      renderHomepageCategoryChipRail();
      renderDiscoverPrimaryView();
      document.getElementById("homepageQuickDiscovery")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
}

function getDiscoveryRankScore(market) {
  const opportunityScore = getMarketOpportunityScore(market) || 0;
  const volumeScore = Math.log10((getNonNegativeNumber(market?.volume24hr) ?? 0) + 1) * 8;
  const liquidityScore = Math.log10((getNonNegativeNumber(market?.liquidity) ?? 0) + 1) * 7;
  const moveScore = Math.abs(getMarketMovementValue(market)) * 180;
  const freshnessBoost = market?.dataFreshness === "fresh" ? 8 : market?.dataFreshness === "stale" ? -14 : 0;
  return opportunityScore + volumeScore + liquidityScore + moveScore + freshnessBoost;
}

function isDiscoveryQualityMarket(market) {
  if (!market || market.active === false || market.closed || market.archived || market.resolved || market.ended) {
    return false;
  }
  if (market.dataFreshness === "stale" && (getNonNegativeNumber(market.volume24hr) ?? 0) < 100000 && (getNonNegativeNumber(market.liquidity) ?? 0) < 100000) {
    return false;
  }
  return true;
}

function getDiscoveryBaseMarkets() {
  return getUsableHomepageMarkets().filter(
    (market) => isDiscoveryQualityMarket(market)
  );
}

function updateHomepageLastRefreshedLabel() {
  const label = document.getElementById("homepageLastRefreshed");
  if (!label) return;
  label.textContent = lastHomepageDiscoveryRefreshAt
    ? `Data refreshed: ${formatTimestamp(lastHomepageDiscoveryRefreshAt)}`
    : "Data refreshed: —";
}

function renderHomepageCategoryChipRail() {
  const rail = document.getElementById("homepageCategoryChipRail");
  if (!rail) return;

  const categories = getCategoryCounts(
    (Array.isArray(liveMarketsCache) ? liveMarketsCache : []).filter(
      (market) => isDiscoveryQualityMarket(market)
    )
  );
  const allCount = categories.reduce((sum, category) => sum + category.count, 0);

  const buttons = [
    `<button class="control-chip ${activeHomepageCategory === "ALL" ? "active" : ""}" data-category-value="ALL" type="button">All <span>${safeText(allCount)}</span></button>`,
    ...categories.map(
      (category) => `
        <button
          class="control-chip ${activeHomepageCategory === category.value ? "active" : ""}"
          data-category-value="${escapeHtml(category.value)}"
          type="button"
        >
          ${escapeHtml(category.label)} <span>${safeText(category.count)}</span>
        </button>
      `
    ),
  ];

  rail.innerHTML = buttons.join("");

  rail.querySelectorAll("[data-category-value]").forEach((button) => {
    button.onclick = () => {
      activeHomepageCategory = button.dataset.categoryValue || "ALL";
      activeTopDiscoveryTab = getTopDiscoveryTabForCategory(activeHomepageCategory);
      quickDiscoveryExpanded = false;
      renderHomepageCategoryChipRail();
      renderHomepageQuickDiscovery();
      renderDiscoverPrimaryView();
    };
  });
}

function renderHomepageDiscoverViewRail() {
  const rail = document.getElementById("homepageDiscoverViewRail");
  if (!rail) return;

  rail.innerHTML = Object.entries(DISCOVER_VIEWS)
    .map(
      ([key, view]) => `
        <button
          class="control-chip ${currentDiscoverView === key ? "active" : ""}"
          data-discover-view="${key}"
          type="button"
        >
          ${escapeHtml(view.label)}
        </button>
      `
    )
    .join("");

  rail.querySelectorAll("[data-discover-view]").forEach((button) => {
    button.onclick = () => {
      setDiscoverView(button.dataset.discoverView);
    };
  });
}

function getDiscoverViewMeta(viewKey = currentDiscoverView) {
  return DISCOVER_VIEWS[viewKey] || DISCOVER_VIEWS.opportunities;
}

function getEmergingMarkets(markets) {
  const now = Date.now();

  const scored = (Array.isArray(markets) ? markets : [])
    .map((market) => {
      const updatedTs = market.lastUpdated ? new Date(market.lastUpdated).getTime() : 0;
      const hoursOld = updatedTs ? (now - updatedTs) / 3600000 : 9999;
      const recencyScore = Math.max(0, 72 - hoursOld);
      const volumeScore = Math.log10((market.volume24hr || 0) + 1) * 8;
      const liquidityScore = Math.log10((market.liquidity || 0) + 1) * 6;
      const opportunityScore = (getMarketOpportunityScore(market) || 0) / 4;

      return {
        ...market,
        _emergingScore: recencyScore + volumeScore + liquidityScore + opportunityScore,
      };
    })
    .filter((market) => isDiscoveryQualityMarket(market) && (market.lastUpdated || market.volume24hr || market.liquidity));

  return scored
    .sort((a, b) => b._emergingScore - a._emergingScore)
    .slice(0, DISCOVER_CANDIDATE_LIMIT);
}

function shouldGroupCurrentDiscoverView() {
  return ["opportunities", "volume", "liquid", "new", "movers"].includes(currentDiscoverView);
}

function getMarketSortScoreForView(market, viewKey = currentDiscoverView) {
  if (viewKey === "movers") {
    return Math.abs(market?.priceChange || market?.oneDayPriceChange || 0) * 1000;
  }
  if (viewKey === "volume") return market?.volume24hr || 0;
  if (viewKey === "liquid") return market?.liquidity || 0;
  if (viewKey === "new") return market?._emergingScore || getDiscoveryRankScore(market);
  return getDiscoveryRankScore(market);
}

function getMarketFamilyReason(groupName) {
  if (groupName === "2026 FIFA World Cup") {
    return "Team winner markets grouped together for easier scanning.";
  }
  if (groupName === "NHL / Stanley Cup") {
    return "Related hockey futures grouped together for easier scanning.";
  }
  if (groupName === "NFL") {
    return "Related football markets grouped together for easier scanning.";
  }
  if (groupName === "Election / Midterms" || groupName === "Election") {
    return "Related election markets grouped together for easier scanning.";
  }
  if (groupName === "Government leadership") {
    return "Related political leadership markets grouped together for easier scanning.";
  }
  if (groupName === "Fed / Rates") {
    return "Related rates and inflation markets grouped together for easier scanning.";
  }
  if (groupName === "Crypto") {
    return "Related crypto markets grouped together for easier scanning.";
  }
  if (groupName === "NBA") {
    return "Related basketball markets grouped together for easier scanning.";
  }
  if (groupName === "Culture/News") {
    return "Related culture and news markets grouped together for easier scanning.";
  }
  return "Related markets grouped together for easier scanning.";
}

function slugifyEventValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function getEventSlugFromParts(eventGroup, familyKey = "") {
  const groupSlug = slugifyEventValue(eventGroup);
  if (groupSlug) return groupSlug;
  return slugifyEventValue(familyKey);
}

function getMarketEventSlug(market) {
  return getEventSlugFromParts(getMarketEventGroup(market), getMarketFamilyKey(market));
}

function getRequestedEventSlug() {
  try {
    return slugifyEventValue(new URLSearchParams(window.location.search).get("event"));
  } catch {
    return "";
  }
}

function setEventUrlParam(eventSlug, options = {}) {
  try {
    const url = new URL(window.location.href);
    if (eventSlug) {
      url.searchParams.set("event", eventSlug);
      url.searchParams.delete("market");
    } else {
      url.searchParams.delete("event");
    }
    const method = options.replace ? "replaceState" : "pushState";
    window.history[method]({}, "", url);
  } catch {}
}

function getRequestedMarketId() {
  try {
    return String(new URLSearchParams(window.location.search).get("market") || "").trim();
  } catch {
    return "";
  }
}

function getMarketPageHref(market) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("market", getMarketDetailId(market));
    url.searchParams.delete("event");
    return url.pathname + url.search + url.hash;
  } catch {
    return `?market=${encodeURIComponent(getMarketDetailId(market))}`;
  }
}

function setMarketUrlParam(marketId, options = {}) {
  try {
    const url = new URL(window.location.href);
    if (marketId) {
      url.searchParams.set("market", marketId);
      url.searchParams.delete("event");
    } else {
      url.searchParams.delete("market");
    }
    const method = options.replace ? "replaceState" : "pushState";
    window.history[method]({}, "", url);
  } catch {}
}

function renderMarketPageLink(market, label = "Open full market page") {
  const marketId = getMarketDetailId(market);
  if (!marketId) return "";

  return `
    <a
      class="market-link market-page-link"
      href="${safeUrl(getMarketPageHref(market))}"
      data-market-page-id="${safeAttr(marketId)}"
    >${safeText(label)}</a>
  `;
}

function getEventMarkets(eventSlugOrFamilyKey) {
  const requested = String(eventSlugOrFamilyKey || "").trim();
  if (!requested) return [];

  const requestedSlug = slugifyEventValue(requested);
  const requestedRaw = requested.toLowerCase();

  return (Array.isArray(liveMarketsCache) ? liveMarketsCache : [])
    .filter((market) => market && market.question && market.url && isDiscoveryQualityMarket(market))
    .filter((market) => {
    const familyKey = String(getMarketFamilyKey(market) || "").toLowerCase();
    const eventSlug = getMarketEventSlug(market);
    return familyKey === requestedRaw || eventSlug === requestedSlug;
  });
}

function getEventSummary(markets) {
  const children = Array.isArray(markets) ? markets : [];
  const first = children[0] || {};
  const eventGroup = getMarketEventGroup(first) || "Market event";
  const familyKey = getMarketFamilyKey(first);

  return {
    eventGroup,
    eventSlug: getEventSlugFromParts(eventGroup, familyKey),
    category: getPublicCategoryLabel(first),
    reason: getMarketFamilyReason(eventGroup),
    count: children.length,
    totalVolume: children.reduce((sum, market) => sum + (getNonNegativeNumber(market.volume24hr) ?? 0), 0),
    totalLiquidity: children.reduce((sum, market) => sum + (getNonNegativeNumber(market.liquidity) ?? 0), 0),
  };
}

function getMarketMovementValue(market) {
  const values = [
    market?.priceChange,
    market?.oneDayPriceChange,
    market?.percentChange,
  ]
    .map(getFiniteNumber)
    .filter((value) => value !== null);

  return values.length ? values[0] : 0;
}

function hasMarketMovementData(market) {
  return [
    market?.priceChange,
    market?.oneDayPriceChange,
    market?.percentChange,
  ].some((value) => getFiniteNumber(value) !== null);
}

function getMarketMovementLabel(market) {
  const movement = getMarketMovementValue(market);
  if (!hasMarketMovementData(market)) return "Movement: No movement data yet";
  return `Movement: ${formatChangeAsProbability(movement)}`;
}

function getSortedEventMarkets(markets, sortKey = currentEventSort) {
  const source = [...(Array.isArray(markets) ? markets : [])];

  return source.sort((a, b) => {
    if (sortKey === "liquidity") return (getNonNegativeNumber(b.liquidity) ?? 0) - (getNonNegativeNumber(a.liquidity) ?? 0);
    if (sortKey === "movement") return Math.abs(getMarketMovementValue(b)) - Math.abs(getMarketMovementValue(a));
    if (sortKey === "highProbability") return (getFiniteNumber(b.yesPriceLive) ?? -1) - (getFiniteNumber(a.yesPriceLive) ?? -1);
    if (sortKey === "lowProbability") return (getFiniteNumber(a.yesPriceLive) ?? 2) - (getFiniteNumber(b.yesPriceLive) ?? 2);
    return (getNonNegativeNumber(b.volume24hr) ?? 0) - (getNonNegativeNumber(a.volume24hr) ?? 0);
  });
}

function getDiscoverItemCategoryKey(item) {
  if (item?.type === "group") {
    return PUBLIC_BROWSE_CATEGORIES.find((category) => category.label === item.category)?.key || "OTHER";
  }
  return getPublicCategoryKey(item?.market || item);
}

function getDiscoverItemScore(item) {
  return Number.isFinite(Number(item?.score)) ? Number(item.score) : 0;
}

function getDiscoverItemFamilyKey(item) {
  if (item?.type === "group") return item.key;
  const market = item?.market || item || {};
  return getMarketFamilyKey(market) || `single:${market.id || market.slug || market.question || "unknown"}`;
}

function canSelectDiscoverItem(item, selected, familySingleCounts) {
  if (item?.type === "group") {
    return !selected.some((selectedItem) => selectedItem?.type === "group" && selectedItem.key === item.key);
  }

  const familyKey = getDiscoverItemFamilyKey(item);
  return (familySingleCounts.get(familyKey) || 0) < 2;
}

function rememberSelectedDiscoverItem(item, familySingleCounts) {
  if (item?.type === "group") return;
  const familyKey = getDiscoverItemFamilyKey(item);
  familySingleCounts.set(familyKey, (familySingleCounts.get(familyKey) || 0) + 1);
}

// Diversity is applied after quality/ranking, so weak markets are not forced
// onto the page. In the All view, the first pass reserves space for multiple
// categories/events, then fills remaining slots by score.
function selectDiverseDiscoverItems(items, limit = DISCOVER_RESULT_LIMIT) {
  const sorted = [...(Array.isArray(items) ? items : [])].sort((a, b) => b.score - a.score);
  const selected = [];
  const familySingleCounts = new Map();
  const maxScore = sorted.reduce((best, item) => Math.max(best, getDiscoverItemScore(item)), 0);
  const qualityFloor = maxScore > 0 ? maxScore * 0.22 : 0;

  const addItem = (item) => {
    if (!item || selected.length >= limit || selected.includes(item)) return false;
    if (!canSelectDiscoverItem(item, selected, familySingleCounts)) return false;
    selected.push(item);
    rememberSelectedDiscoverItem(item, familySingleCounts);
    return true;
  };

  if (activeHomepageCategory === "ALL") {
    PUBLIC_BROWSE_CATEGORIES
      .filter((category) => category.key !== "ALL")
      .forEach((category) => {
        const candidate =
          sorted.find(
            (item) =>
              getDiscoverItemCategoryKey(item) === category.key &&
              getDiscoverItemScore(item) >= qualityFloor
          ) ||
          sorted.find((item) => getDiscoverItemCategoryKey(item) === category.key);
        addItem(candidate);
      });
  }

  sorted.forEach(addItem);

  return selected.slice(0, limit);
}

// Grouping is intentionally conservative: only obvious repeated market
// families become grouped cards, and every child still keeps a direct
// Polymarket link plus the full market question for accuracy.
function buildGroupedDiscoverItems(markets, viewKey = currentDiscoverView) {
  const source = Array.isArray(markets) ? markets : [];
  const familyMap = new Map();
  const singles = [];

  source.forEach((market) => {
    const familyKey = getMarketFamilyKey(market);
    const groupName = getMarketEventGroup(market);
    if (!familyKey || !groupName) {
      singles.push(market);
      return;
    }

    const existing = familyMap.get(familyKey) || {
      type: "group",
      key: familyKey,
      eventSlug: getEventSlugFromParts(groupName, familyKey),
      eventGroup: groupName,
      category: getPublicCategoryLabel(market),
      reason: getMarketFamilyReason(groupName),
      children: [],
      score: 0,
    };

    existing.children.push(market);
    existing.score = Math.max(existing.score, getMarketSortScoreForView(market, viewKey));
    familyMap.set(familyKey, existing);
  });

  const groups = [];

  familyMap.forEach((group) => {
    const minGroupSize = viewKey === "movers" ? 3 : 2;
    if (group.children.length < minGroupSize) {
      singles.push(...group.children);
      return;
    }

    group.children = group.children
      .sort((a, b) => getMarketSortScoreForView(b, viewKey) - getMarketSortScoreForView(a, viewKey));
    groups.push(group);
  });

  const candidates = [
    ...groups,
    ...singles.map((market) => ({
      type: "market",
      market,
      score: getMarketSortScoreForView(market, viewKey),
    })),
  ].sort((a, b) => b.score - a.score);

  return selectDiverseDiscoverItems(candidates, DISCOVER_RESULT_LIMIT);
}

function getDiscoverMarketsForCurrentView() {
  const baseMarkets = getDiscoveryBaseMarkets();

  switch (currentDiscoverView) {
    case "movers":
      return getCategoryFilteredMarkets(biggestMoversCache).slice(0, DISCOVER_CANDIDATE_LIMIT);
    case "volume":
      return [...baseMarkets]
        .sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0))
        .slice(0, DISCOVER_CANDIDATE_LIMIT);
    case "liquid":
      return [...baseMarkets]
        .sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0))
        .slice(0, DISCOVER_CANDIDATE_LIMIT);
    case "new":
      return getEmergingMarkets(baseMarkets);
    case "opportunities":
    default:
      return [...baseMarkets]
        .sort((a, b) => getDiscoveryRankScore(b) - getDiscoveryRankScore(a))
        .slice(0, DISCOVER_CANDIDATE_LIMIT);
  }
}

function getDiscoverFilteredCount() {
  if (currentDiscoverView === "movers") {
    return getCategoryFilteredMarkets(biggestMoversCache).length;
  }
  return getDiscoveryBaseMarkets().length;
}

function renderDiscoverPrimaryView() {
  ensureHomepageStrategyLayer();
  renderHomepageCategoryChipRail();
  renderHomepageDiscoverViewRail();
  updateHomepageLastRefreshedLabel();
  updateMarketIntelligenceStrip();
  renderHomepageQuickDiscovery();

  const titleEl = document.getElementById("discoverPrimaryViewLabel");
  const descriptionEl = document.getElementById("discoverPrimaryViewDescription");
  const summaryEl = document.getElementById("discoverPrimaryViewSummary");
  const resultsEl = document.getElementById("discoverPrimaryResults");

  if (!titleEl || !descriptionEl || !summaryEl || !resultsEl) return;

  const meta = getDiscoverViewMeta();
  titleEl.textContent = meta.label;
  descriptionEl.textContent = meta.description;

  const totalCount = getDiscoverFilteredCount();
  const categoryLabel =
    activeHomepageCategory === "ALL"
      ? "all categories"
      : getCategoryOptionLabel(activeHomepageCategory);

  summaryEl.textContent = `Showing ${Math.min(totalCount, 8)} of ${totalCount} active markets from ${categoryLabel}. Open the best matches on Polymarket, or preview a paper trade first.`;

  if (currentDiscoverView === "movers" && !biggestMoversCache.length) {
    resultsEl.innerHTML = `<p class="loading">Loading biggest movers...</p>`;
    return;
  }

  const rawItems = getDiscoverMarketsForCurrentView();
  const items = shouldGroupCurrentDiscoverView()
    ? buildGroupedDiscoverItems(rawItems, currentDiscoverView)
    : rawItems;

  if (!Array.isArray(items) || items.length === 0) {
    resultsEl.innerHTML = `<p class="empty">${meta.empty}</p>`;
    return;
  }

  resultsEl.innerHTML = items
    .map((item) => {
      if (item?.type === "group") {
        return renderMarketFamilyCard(item, currentDiscoverView);
      }

      const market = item?.type === "market" ? item.market : item;
      return meta.type === "mover"
        ? renderMoverCard(market, currentDiscoverView)
        : renderHotCard(market, currentDiscoverView);
    })
    .join("");

  bindTradeActionButtons();
  bindEventOpenButtons();
  applyTopLevelView();
}

function setDiscoverView(nextView) {
  if (!DISCOVER_VIEWS[nextView]) return;
  currentDiscoverView = nextView;
  renderHomepageDiscoverViewRail();

  if (nextView === "movers" && biggestMoversCache.length === 0) {
    const resultsEl = document.getElementById("discoverPrimaryResults");
    if (resultsEl) {
      resultsEl.innerHTML = `<p class="loading">Loading biggest movers...</p>`;
    }
    loadBiggestMovers();
    return;
  }

  renderDiscoverPrimaryView();
}

function ensureTopLevelNavStyles() {
  if (document.getElementById("pbpTopLevelNavStyles")) return;

  const style = document.createElement("style");
  style.id = "pbpTopLevelNavStyles";
  style.textContent = `
    #pbpTopLevelTabsSection .pbp-top-tabs {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
    }

    #pbpTopLevelTabsSection .pbp-top-tab-btn {
      min-width: 120px;
    }

    #pbpTopLevelTabsSection .pbp-top-tab-btn.active {
      outline: 2px solid rgba(148, 163, 184, 0.45);
      outline-offset: 1px;
    }

    .pbp-tab-section-hidden {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function getWorkspaceTabsAnchorSection() {
  const explicitSelectors = [
    "#hero",
    "#heroSection",
    "#pageHero",
    "#homeHero",
    "#siteHero",
    "#headerSection",
    "#pageHeader",
  ];

  for (const selector of explicitSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element.closest("section") || element;
    }
  }

  const firstMainSection =
    document.querySelector("main > section") ||
    document.querySelector("main section") ||
    document.querySelector(".container > section") ||
    document.querySelector("section");

  return firstMainSection ? firstMainSection.closest("section") || firstMainSection : null;
}

function getClosestSectionByElementId(id) {
  const element = document.getElementById(id);
  return element ? element.closest("section") : null;
}

function uniqueSections(sections) {
  const seen = new Set();
  const result = [];

  sections.forEach((section) => {
    if (!section || seen.has(section)) return;
    seen.add(section);
    result.push(section);
  });

  return result;
}

function hideLegacyDiscoverSections() {
  ["alertsPanel", "topOpportunities", "biggestMovers", "hotMarkets"].forEach((id) => {
    const section = getClosestSectionByElementId(id);
    if (section) section.classList.add("pbp-tab-section-hidden");
  });
}

function getPublicBetaInternalSections() {
  return uniqueSections(
    PBP_PUBLIC_BETA_INTERNAL_SECTION_IDS.map((id) => getClosestSectionByElementId(id))
  );
}

function applyPublicBetaInternalVisibility() {
  document.body.classList.toggle("pbp-debug-mode", PBP_PUBLIC_BETA_DEBUG_MODE);

  getPublicBetaInternalSections().forEach((section) => {
    section.classList.toggle("pbp-tab-section-hidden", !PBP_PUBLIC_BETA_DEBUG_MODE);
  });

  const tabsSection = document.getElementById("pbpTopLevelTabsSection");
  if (tabsSection && !PBP_PUBLIC_BETA_DEBUG_MODE) {
    tabsSection.remove();
  }
}

function getManagedTopLevelSections() {
  const discoverSections = uniqueSections([document.getElementById("homepageStrategyLayer")]);

  const tradeSections = uniqueSections([
    getClosestSectionByElementId("tradeModeSelect"),
    getClosestSectionByElementId("tradeTicketPanel"),
    getClosestSectionByElementId("tradeExecutionPanel"),
    getClosestSectionByElementId("accountStatePanel"),
    getClosestSectionByElementId("accountControlsPanel"),
  ]);

  const portfolioSections = uniqueSections([
    getClosestSectionByElementId("paperPortfolioStatsPanel"),
    getClosestSectionByElementId("paperPortfolioControlsPanel"),
    getClosestSectionByElementId("performanceStatsPanel"),
    getClosestSectionByElementId("signalLogPanel"),
    getClosestSectionByElementId("openPositionsPanel"),
    getClosestSectionByElementId("closedPositionsPanel"),
  ]);

  return {
    discover: discoverSections,
    trade: tradeSections,
    portfolio: portfolioSections,
  };
}

function updateTopLevelTabButtons() {
  const buttonMap = {
    discover: document.getElementById("pbpTabDiscoverBtn"),
    trade: document.getElementById("pbpTabTradeBtn"),
    portfolio: document.getElementById("pbpTabPortfolioBtn"),
  };

  Object.entries(buttonMap).forEach(([view, button]) => {
    if (!button) return;
    const isActive = currentTopLevelView === view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function applyTopLevelView() {
  if (!PBP_PUBLIC_BETA_DEBUG_MODE) {
    hideLegacyDiscoverSections();
    applyPublicBetaInternalVisibility();
    return;
  }

  const groups = getManagedTopLevelSections();
  const activeSections = new Set(groups[currentTopLevelView] || []);
  const allSections = new Set([
    ...groups.discover,
    ...groups.trade,
    ...groups.portfolio,
  ]);

  allSections.forEach((section) => {
    const shouldShow = activeSections.has(section);
    section.classList.toggle("pbp-tab-section-hidden", !shouldShow);
  });

  hideLegacyDiscoverSections();
  updateTopLevelTabButtons();
}

function setTopLevelView(nextView) {
  if (!["discover", "trade", "portfolio"].includes(nextView)) return;
  currentTopLevelView = nextView;
  applyTopLevelView();
}

function ensureTopLevelTabs() {
  ensureTopLevelNavStyles();

  if (!PBP_PUBLIC_BETA_DEBUG_MODE) {
    applyPublicBetaInternalVisibility();
    return;
  }

  const existing = document.getElementById("pbpTopLevelTabsSection");
  if (existing) {
    applyTopLevelView();
    return;
  }

  const groups = getManagedTopLevelSections();
  const firstManagedSection =
    groups.discover[0] || groups.trade[0] || groups.portfolio[0];

  const preferredAnchorSection = document.getElementById("homepageStrategyLayer");
  const fallbackAnchorSection = getWorkspaceTabsAnchorSection();
  const insertionAnchor = preferredAnchorSection || fallbackAnchorSection || firstManagedSection;

  if (!insertionAnchor?.parentElement) return;

  const tabsSection = document.createElement("section");
  tabsSection.id = "pbpTopLevelTabsSection";
  tabsSection.innerHTML = `
    <div class="market-grid">
      <article class="market-card advanced-demo-card">
        <p class="market-small">Optional</p>
        <h3>Advanced Demo</h3>
        <div class="alert-item">
          <div class="alert-message">The public product starts with market discovery and Polymarket links.</div>
          <div class="alert-time">Use these tabs when you want to preview paper trades, portfolio tracking, or the Builder workflow demo.</div>
        </div>
        <div class="pbp-top-tabs" role="tablist" aria-label="Top-level product views">
          <button id="pbpTabDiscoverBtn" class="pbp-top-tab-btn" role="tab" type="button">Market Discovery</button>
          <button id="pbpTabTradeBtn" class="pbp-top-tab-btn" role="tab" type="button">Builder Demo</button>
          <button id="pbpTabPortfolioBtn" class="pbp-top-tab-btn" role="tab" type="button">Paper Portfolio</button>
        </div>
      </article>
    </div>
  `;

  insertionAnchor.insertAdjacentElement("afterend", tabsSection);

  const discoverBtn = document.getElementById("pbpTabDiscoverBtn");
  const tradeBtn = document.getElementById("pbpTabTradeBtn");
  const portfolioBtn = document.getElementById("pbpTabPortfolioBtn");

  if (discoverBtn) discoverBtn.onclick = () => setTopLevelView("discover");
  if (tradeBtn) tradeBtn.onclick = () => setTopLevelView("trade");
  if (portfolioBtn) portfolioBtn.onclick = () => setTopLevelView("portfolio");

  applyTopLevelView();
}

function ensureHomepageStrategyLayer() {
  if (document.getElementById("homepageStrategyLayer")) {
    renderHomepageCategoryChipRail();
    renderHomepageDiscoverViewRail();
    updateHomepageLastRefreshedLabel();
    bindHomepageStrategyLayerControls();
    hideLegacyDiscoverSections();
    ensureTopLevelTabs();
    applyTopLevelView();
    return;
  }

  const fallbackAnchor = getWorkspaceTabsAnchorSection();
  const tabsSection = document.getElementById("pbpTopLevelTabsSection");
  const insertionAnchor = fallbackAnchor || tabsSection;

  if (!insertionAnchor) return;

  const strategySection = document.createElement("section");
  strategySection.id = "homepageStrategyLayer";
  strategySection.innerHTML = `
    <div class="market-grid">
      <article class="market-card discover-front-door-card">
        <p class="market-small">Live discovery</p>
        <h3>Live Market Signals</h3>
        <div class="alerts-list">
          <div class="alert-item">
            <div class="alert-message">House of Markets helps you scan active prediction markets, spot movement faster, and open the markets that matter.</div>
          </div>
          <div class="alert-item">
            <div class="alert-message">Use categories and views to narrow the live feed into a focused board.</div>
          </div>
          <div class="alert-item">
            <div class="alert-message">View promising markets on Polymarket first; preview a paper trade only when you want more context.</div>
          </div>
        </div>
      </article>

      <article class="market-card discover-control-card">
        <h3>Market Discovery</h3>
        <div class="discover-control-stack">
          <div>
            <div class="rail-label">Categories</div>
            <div id="homepageCategoryChipRail" class="control-chip-rail"></div>
          </div>

          <div>
            <div class="rail-label">Views</div>
            <div id="homepageDiscoverViewRail" class="control-chip-rail"></div>
          </div>

          <div class="discover-utility-row">
            <button id="refreshHomepageStrategyLayer" type="button">Refresh Discovery</button>
            <span id="homepageLastRefreshed" class="market-small">Last refreshed: —</span>
          </div>

          <div class="discover-inline-notes">
            <div class="alert-time">Start with Top Opportunities for a quick scan. Switch to Movers, Volume, Liquid, or New when you want a different lens.</div>
          </div>
        </div>
      </article>
    </div>

    <div class="market-grid discover-board-shell" style="margin-top: 18px;">
      <article class="market-card">
        <div class="discover-results-header">
          <div>
            <h3 id="discoverPrimaryViewLabel">Top Opportunities</h3>
            <div id="discoverPrimaryViewDescription" class="alert-time">Best blend of confidence, liquidity, and current activity.</div>
          </div>
        </div>
        <div id="discoverPrimaryViewSummary" class="discover-primary-summary"></div>
        <div id="discoverPrimaryResults" class="market-grid discover-results-grid" style="margin-top: 14px;"></div>
      </article>
    </div>

    <div class="market-grid discover-notes-shell" style="margin-top: 18px;">
      <article class="market-card">
        <h3>Market Signals</h3>
        <div class="alert-time">Short notes from the current market feed. The main action is still opening high-signal markets on Polymarket.</div>
        <div id="extraDiscoveryAlerts" class="alerts-list" style="margin-top: 14px;"></div>
      </article>
    </div>
  `;

  insertionAnchor.insertAdjacentElement("afterend", strategySection);

  renderHomepageCategoryChipRail();
  renderHomepageDiscoverViewRail();
  updateHomepageLastRefreshedLabel();
  bindHomepageStrategyLayerControls();
  hideLegacyDiscoverSections();
  ensureTopLevelTabs();
  applyTopLevelView();
}

function bindHomepageStrategyLayerControls() {
  const refreshBtn = document.getElementById("refreshHomepageStrategyLayer");
  if (refreshBtn) {
    refreshBtn.onclick = () => loadHomepageDiscoveryData(true);
  }
}

function setHomepageDiscoveryLoadingState() {
  const container = document.getElementById("discoverPrimaryResults");
  if (!container) return;

  const loadingLabel =
    currentDiscoverView === "movers"
      ? "Loading biggest movers..."
      : "Loading discovery view...";

  container.innerHTML = `<p class="loading">${loadingLabel}</p>`;
}

async function loadHomepageDiscoveryData() {
  ensureHomepageStrategyLayer();
  setHomepageDiscoveryLoadingState();

  try {
    const res = await fetch("/api/liveMarkets");
    const data = await res.json();
    const markets = Array.isArray(data) ? data : data.markets;
    const responseOk = Array.isArray(data) ? res.ok : data.ok;

    if (!responseOk || !Array.isArray(markets)) {
      throw new Error("Invalid live markets response");
    }

    liveMarketsCache = markets;
    hotMarketsCache = markets;
    lastHomepageDiscoveryRefreshAt = Array.isArray(data)
      ? new Date().toISOString()
      : data.lastRefreshedAt || new Date().toISOString();

    renderHomepageCategoryChipRail();

    if (currentDiscoverView === "movers") {
      await loadBiggestMovers();
    } else {
      renderDiscoverPrimaryView();
    }

    const renderedMarket = renderRequestedMarketFromUrl({ scroll: false });
    if (!renderedMarket) renderRequestedEventFromUrl({ scroll: false });
    if (activeMarketDetailId) {
      const activeMarket = getMarketByDetailId(activeMarketDetailId);
      if (activeMarket) renderMarketDetailDrawer(activeMarket);
    }
    applyTopLevelView();
  } catch (err) {
    console.error("Homepage discovery load error:", err);
    const resultsEl = document.getElementById("discoverPrimaryResults");
    if (resultsEl) {
      resultsEl.innerHTML = `<p class="empty">Failed to load discovery markets.</p>`;
    }
  }
}

function hasBrowserWalletProvider() {
  return typeof window !== "undefined" && !!window.ethereum?.request;
}

function getCurrentTradeMode() {
  const modeSelect = document.getElementById("tradeModeSelect");
  return modeSelect?.value || "PAPER";
}

function parseJsonText(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function getPreferredUserAuthAddress() {
  const signedOrderAddress =
    currentClientSignedOrder?.maker ||
    currentClientSignedOrder?.signer ||
    currentClientSignedOrder?.owner ||
    "";
  const connectedAddress = accountStateCache?.walletAddress || "";
  return String(signedOrderAddress || connectedAddress || "").trim();
}

function resetUserAuthDraft() {
  currentUserAuthDraft = createEmptyUserAuthDraft();
  clearUserAuthInlineStatus();
}

function hydrateUserAuthDraftDefaults() {
  if (!currentUserAuthDraft.address && !currentUserAuthDraft.lockEmptyAddress) {
    currentUserAuthDraft.address = getPreferredUserAuthAddress();
  }
}

function captureUserAuthDraftFromUi() {
  const addressInput = document.getElementById("userAuthAddressInput");
  const apiKeyInput = document.getElementById("userAuthApiKeyInput");
  const secretInput = document.getElementById("userAuthSecretInput");
  const passphraseInput = document.getElementById("userAuthPassphraseInput");
  const rawJsonInput = document.getElementById("userAuthJsonInput");

  if (addressInput) {
    currentUserAuthDraft.address = addressInput.value.trim();
    currentUserAuthDraft.lockEmptyAddress = currentUserAuthDraft.address === "";
  }
  if (apiKeyInput) currentUserAuthDraft.apiKey = apiKeyInput.value.trim();
  if (secretInput) currentUserAuthDraft.secret = secretInput.value.trim();
  if (passphraseInput) currentUserAuthDraft.passphrase = passphraseInput.value.trim();
  if (rawJsonInput) currentUserAuthDraft.rawJson = rawJsonInput.value.trim();
}

function restoreUserAuthDraftToUi() {
  hydrateUserAuthDraftDefaults();

  const addressInput = document.getElementById("userAuthAddressInput");
  const apiKeyInput = document.getElementById("userAuthApiKeyInput");
  const secretInput = document.getElementById("userAuthSecretInput");
  const passphraseInput = document.getElementById("userAuthPassphraseInput");
  const rawJsonInput = document.getElementById("userAuthJsonInput");

  if (addressInput) addressInput.value = currentUserAuthDraft.address || "";
  if (apiKeyInput) apiKeyInput.value = currentUserAuthDraft.apiKey || "";
  if (secretInput) secretInput.value = currentUserAuthDraft.secret || "";
  if (passphraseInput) passphraseInput.value = currentUserAuthDraft.passphrase || "";
  if (rawJsonInput) rawJsonInput.value = currentUserAuthDraft.rawJson || "";
}

function setUserAuthInlineStatus(type, message) {
  currentUserAuthUiState = {
    type: String(type || "").trim(),
    message: String(message || "").trim(),
  };
  updateUserAuthInlineStatusUi();
}

function clearUserAuthInlineStatus() {
  currentUserAuthUiState = createEmptyUserAuthUiState();
  updateUserAuthInlineStatusUi();
}

function updateUserAuthInlineStatusUi() {
  const container = document.getElementById("userAuthInlineStatus");
  if (!container) return;

  if (!currentUserAuthUiState.message) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }

  const messageClass =
    currentUserAuthUiState.type === "error"
      ? "negative"
      : currentUserAuthUiState.type === "success"
        ? "positive"
        : "";

  container.style.display = "block";
  container.innerHTML = `
    <div class="alert-item">
      <div class="alert-message ${messageClass}">${escapeHtml(currentUserAuthUiState.message)}</div>
    </div>
  `;
}

function fillUserAuthAddressFromConnectedWallet() {
  const nextAddress = getPreferredUserAuthAddress();
  currentUserAuthDraft.address = nextAddress;
  currentUserAuthDraft.lockEmptyAddress = nextAddress === "";

  const addressInput = document.getElementById("userAuthAddressInput");
  if (addressInput) addressInput.value = nextAddress;

  clearUserAuthInlineStatus();
}

function normalizeAndValidateUserAuth(userAuth) {
  const normalized = {
    address: String(userAuth?.address || "").trim(),
    apiKey: String(userAuth?.apiKey || "").trim(),
    secret: String(userAuth?.secret || "").trim(),
    passphrase: String(userAuth?.passphrase || "").trim(),
  };

  if (!normalized.address) throw new Error("User auth address is required");
  if (!normalized.apiKey) throw new Error("User auth API key is required");
  if (!normalized.secret) throw new Error("User auth secret is required");
  if (!normalized.passphrase) throw new Error("User auth passphrase is required");

  return normalized;
}

function applyUserAuthObjectToDraft(userAuthObject) {
  const normalized = normalizeAndValidateUserAuth(userAuthObject);

  currentUserAuthDraft.address = normalized.address;
  currentUserAuthDraft.apiKey = normalized.apiKey;
  currentUserAuthDraft.secret = normalized.secret;
  currentUserAuthDraft.passphrase = normalized.passphrase;
  currentUserAuthDraft.lockEmptyAddress = false;
}

function clearUserAuthFieldsInDraft() {
  currentUserAuthDraft = {
    ...createEmptyUserAuthDraft(),
    lockEmptyAddress: true,
  };
}

function readResolvedUserAuthFromUi() {
  captureUserAuthDraftFromUi();

  if (currentUserAuthDraft.rawJson) {
    const parsed = parseJsonText(currentUserAuthDraft.rawJson, "User auth JSON");
    return normalizeAndValidateUserAuth(parsed);
  }

  return normalizeAndValidateUserAuth({
    address: currentUserAuthDraft.address,
    apiKey: currentUserAuthDraft.apiKey,
    secret: currentUserAuthDraft.secret,
    passphrase: currentUserAuthDraft.passphrase,
  });
}

function clearBrowserDemoState() {
  const keysToRemove = [
    "pbp_currentTradeTicket",
    "pbp_currentLivePreparation",
    "pbp_demo_state",
    "paidByPolymarket_demo_state",
  ];

  try {
    keysToRemove.forEach((key) => window.localStorage?.removeItem(key));
  } catch {}

  try {
    keysToRemove.forEach((key) => window.sessionStorage?.removeItem(key));
  } catch {}
}

function resetFrontendDemoUiState() {
  hotMarketsCache = [];
  liveMarketsCache = [];
  biggestMoversCache = [];
  lastHomepageDiscoveryRefreshAt = "";
  activeHomepageCategory = "ALL";
  currentTopLevelView = "discover";
  currentDiscoverView = "opportunities";
  currentTradeTicket = null;
  currentLivePreparation = null;
  currentClientSignedOrder = null;
  accountStateCache = null;
  walletConnectionSource = "NONE";
  resetUserAuthDraft();

  const tradeModeSelect = document.getElementById("tradeModeSelect");
  const tradeTicketSize = document.getElementById("tradeTicketSize");
  const minVolume = document.getElementById("minVolume");
  const minPrice = document.getElementById("minPrice");
  const maxPrice = document.getElementById("maxPrice");

  if (tradeModeSelect) tradeModeSelect.value = "PAPER";
  if (tradeTicketSize) tradeTicketSize.value = "";
  if (minVolume) minVolume.value = "";
  if (minPrice) minPrice.value = "";
  if (maxPrice) maxPrice.value = "";

  renderTradeTicketPanel();
  renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);
}

async function beginCleanPublicLoad() {
  clearBrowserDemoState();
  resetFrontendDemoUiState();

  try {
    await postJson("/api/public-demo/reset", {});
  } catch (err) {
    console.error("Public demo reset failed:", err);
  }
}

async function syncAppAccountFromWalletAddress(walletAddress, source = "BROWSER") {
  const normalized = String(walletAddress || "").trim();
  if (!normalized) {
    throw new Error("Wallet address is required");
  }

  await postJson("/api/account/connect", {
    walletAddress: normalized,
    walletType: "EOA",
    proxyWalletAddress: "",
    signatureType: 0,
    funderAddress: normalized,
  });

  walletConnectionSource = source;
  currentClientSignedOrder = null;
  currentLivePreparation = null;
  resetUserAuthDraft();
  renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);
  await loadAccountState();
}

async function clearAppWalletConnection() {
  await postJson("/api/account/disconnect", {});
  walletConnectionSource = "NONE";
  currentTradeTicket = null;
  currentLivePreparation = null;
  currentClientSignedOrder = null;
  resetUserAuthDraft();
  renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);
  renderTradeTicketPanel();
  await loadAccountState();
}

async function handleBrowserWalletAccountsChanged(accounts) {
  if (walletConnectionSource !== "BROWSER") {
    return;
  }

  const nextAddress = Array.isArray(accounts) ? String(accounts[0] || "").trim() : "";

  try {
    if (!nextAddress) {
      await clearAppWalletConnection();
      return;
    }

    await syncAppAccountFromWalletAddress(nextAddress, "BROWSER");
  } catch (err) {
    console.error("accountsChanged sync error:", err);
  }
}

async function handleBrowserWalletChainChanged() {
  if (walletConnectionSource !== "BROWSER" || !hasBrowserWalletProvider()) {
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    const nextAddress = Array.isArray(accounts) ? String(accounts[0] || "").trim() : "";

    if (!nextAddress) {
      await clearAppWalletConnection();
      return;
    }

    currentClientSignedOrder = null;
    currentLivePreparation = null;
    resetUserAuthDraft();
    renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);
    await syncAppAccountFromWalletAddress(nextAddress, "BROWSER");
  } catch (err) {
    console.error("chainChanged sync error:", err);
  }
}

function setupBrowserWalletEventSync() {
  if (browserWalletEventsBound || !hasBrowserWalletProvider()) {
    return;
  }

  window.ethereum.on("accountsChanged", handleBrowserWalletAccountsChanged);
  window.ethereum.on("chainChanged", handleBrowserWalletChainChanged);
  browserWalletEventsBound = true;
}

async function ensurePolygonBrowserWalletChain() {
  if (!hasBrowserWalletProvider()) {
    throw new Error("No browser wallet provider detected");
  }

  const currentChainId = await window.ethereum.request({ method: "eth_chainId" });

  if (String(currentChainId).toLowerCase() === POLYGON_HEX_CHAIN_ID) {
    return;
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: POLYGON_HEX_CHAIN_ID }],
    });
  } catch (err) {
    throw new Error(
      err?.message || "Switch the browser wallet to Polygon mainnet before signing"
    );
  }
}

async function loadPolymarketBrowserSigningModules() {
  if (!polymarketBrowserModulesPromise) {
    polymarketBrowserModulesPromise = Promise.all([
      import("https://esm.sh/@polymarket/clob-client-v2?bundle"),
      import("https://esm.sh/viem?bundle"),
      import("https://esm.sh/viem/chains?bundle"),
    ]).then(([clobModule, viemModule, viemChainsModule]) => ({
      clobModule,
      viemModule,
      viemChainsModule,
    }));
  }

  return polymarketBrowserModulesPromise;
}

function buildPreparedBrowserUserOrder(signableOrder, sideEnum) {
  const nextOrder = {
    tokenID: String(signableOrder.tokenID || ""),
    price: Number(signableOrder.price),
    size: Number(signableOrder.size),
    side:
      String(signableOrder.side || "").toUpperCase() === "SELL"
        ? sideEnum.SELL
        : sideEnum.BUY,
  };

  if (!nextOrder.tokenID) {
    throw new Error("Prepared order is missing tokenID");
  }

  if (!Number.isFinite(nextOrder.price) || nextOrder.price <= 0) {
    throw new Error("Prepared order price is invalid");
  }

  if (!Number.isFinite(nextOrder.size) || nextOrder.size <= 0) {
    throw new Error("Prepared order size is invalid");
  }

  if (signableOrder.expiration !== undefined && signableOrder.expiration !== null) {
    nextOrder.expiration = Number(signableOrder.expiration);
  }

  if (signableOrder.feeRateBps !== undefined && signableOrder.feeRateBps !== null) {
    nextOrder.feeRateBps = Number(signableOrder.feeRateBps);
  }

  if (signableOrder.taker) {
    nextOrder.taker = String(signableOrder.taker);
  }

  if (signableOrder.nonce !== undefined && signableOrder.nonce !== null) {
    nextOrder.nonce = Number(signableOrder.nonce);
  }

  return nextOrder;
}

async function buildBrowserWalletClobClient(walletAddress) {
  const { clobModule, viemModule, viemChainsModule } =
    await loadPolymarketBrowserSigningModules();

  const { ClobClient } = clobModule;
  const { createWalletClient, custom } = viemModule;
  const { polygon } = viemChainsModule;

  const walletClient = createWalletClient({
    account: String(walletAddress || "").trim(),
    chain: polygon,
    transport: custom(window.ethereum),
  });

  return {
    clobClient: new ClobClient({
      host: POLYMARKET_CLOB_HOST,
      chain: POLYMARKET_CHAIN_ID,
      signer: walletClient,
      signatureType: 0,
      funderAddress: String(walletAddress || "").trim(),
    }),
    clobModule,
  };
}

async function signPreparedOrderClientSide() {
  if (!hasBrowserWalletProvider()) {
    throw new Error("No browser wallet provider detected");
  }

  if (walletConnectionSource !== "BROWSER") {
    throw new Error("Connect with the browser wallet flow to sign in-browser");
  }

  const walletAddress = String(accountStateCache?.walletAddress || "").trim();
  if (!walletAddress) {
    throw new Error("No active browser wallet address is connected");
  }

  const signableOrder = currentLivePreparation?.signedOrderHandoff?.signableOrder;
  if (!signableOrder) {
    throw new Error("No prepared signable order is available");
  }

  await ensurePolygonBrowserWalletChain();

  const { clobClient, clobModule } = await buildBrowserWalletClobClient(walletAddress);
  const userOrder = buildPreparedBrowserUserOrder(signableOrder, clobModule.Side);

  const signedOrder = await clobClient.createOrder(userOrder, {
    tickSize: String(signableOrder.tickSize || "0.01"),
    negRisk: !!signableOrder.negRisk,
  });

  return signedOrder;
}

function renderAlertItem(alert) {
  return `
    <div class="alert-item">
      <div class="alert-message">${safeText(alert.message)}</div>
      <div class="alert-time">${safeText(formatTimestamp(alert.timestamp))}</div>
    </div>
  `;
}

function renderSignalLogItem(signal) {
  const perf = signal.performancePoints ?? 0;
  const perfClass = perf > 0 ? "positive" : perf < 0 ? "negative" : "";

  const status = signal.status || "ACTIVE";
  const statusClass = status === "WIN" ? "positive" : status === "LOSS" ? "negative" : "";
  const statusLabel = status === "WIN" ? "✅ WIN" : status === "LOSS" ? "❌ LOSS" : "⏳ ACTIVE";

  return `
    <div class="alert-item">
      <div class="alert-message">${safeText(signal.actionSignal)}: ${safeText(signal.question)}</div>
      <div class="alert-time">Logged: ${safeText(formatTimestamp(signal.createdAt))}</div>
      <div class="alert-time">Why it stood out: ${safeText(signal.actionReason)}</div>
      <div class="alert-time">Confidence: ${safeText(signal.confidenceScore)}/100</div>
      <div class="alert-time">Entry: ${safeText(formatProbability(signal.entryYesPrice))}</div>
      <div class="alert-time">Current: ${safeText(formatProbability(signal.currentYesPrice))}</div>
      <div class="alert-time ${perfClass}">Performance: ${safeText(formatPoints(perf))}</div>
      <div class="alert-time ${statusClass}">Status: ${safeText(statusLabel)}</div>
    </div>
  `;
}

function renderPerformanceStats(stats) {
  const winRatePct = ((stats.winRate || 0) * 100).toFixed(1);
  const avgPerfLabel = formatPoints(stats.avgPerformance || 0);
  const avgWinLabel = formatPoints(stats.avgWin || 0);
  const avgLossLabel = formatPoints(stats.avgLoss || 0);
  const expectancyLabel = formatPoints(stats.expectancy || 0);

  const signalBreakdown = Object.entries(stats.bySignal || {})
    .map(
      ([signalType, data]) => `
      <article class="market-card">
        <h3>${safeText(signalType)}</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Total</span><span class="meta-value">${safeText(data.total ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Active</span><span class="meta-value">${safeText(data.active ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Wins</span><span class="meta-value">${safeText(data.wins ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Losses</span><span class="meta-value">${safeText(data.losses ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Win Rate</span><span class="meta-value">${safeText(((data.winRate || 0) * 100).toFixed(1))}%</span></div>
          <div class="meta-box"><span class="meta-label">Avg Perf</span><span class="meta-value">${safeText(formatPoints(data.avgPerformance || 0))}</span></div>
        </div>
      </article>
    `
    )
    .join("");

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Performance Summary</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Total Signals</span><span class="meta-value">${safeText(stats.totalSignals ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Active</span><span class="meta-value">${safeText(stats.activeSignals ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Wins</span><span class="meta-value">${safeText(stats.wins ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Losses</span><span class="meta-value">${safeText(stats.losses ?? 0)}</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>Edge Summary</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Win Rate</span><span class="meta-value">${safeText(winRatePct)}%</span></div>
          <div class="meta-box"><span class="meta-label">Avg Performance</span><span class="meta-value">${safeText(avgPerfLabel)}</span></div>
          <div class="meta-box"><span class="meta-label">Avg Win</span><span class="meta-value">${safeText(avgWinLabel)}</span></div>
          <div class="meta-box"><span class="meta-label">Avg Loss</span><span class="meta-value">${safeText(avgLossLabel)}</span></div>
          <div class="meta-box"><span class="meta-label">Expectancy</span><span class="meta-value">${safeText(expectancyLabel)}</span></div>
        </div>
      </article>
    </div>

    <div class="market-grid" style="margin-top: 18px;">
      ${signalBreakdown || `<p class="empty">No signal breakdown yet.</p>`}
    </div>
  `;
}

function renderAccountPanel(account) {
  const blockers = (account.blockers || []).map((b) => `<div class="alert-time">• ${safeText(b)}</div>`).join("");
  const liveToggleDisabled = !account.canEnableLiveMode ? "disabled" : "";
  const liveChecked = account.liveModeEnabled ? "checked" : "";

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Account Status</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Connected</span><span class="meta-value">${account.isConnected ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Wallet Type</span><span class="meta-value">${safeText(account.walletType, "NONE")}</span></div>
          <div class="meta-box"><span class="meta-label">Wallet</span><span class="meta-value">${safeText(account.walletAddress, "—")}</span></div>
          <div class="meta-box"><span class="meta-label">Proxy Wallet</span><span class="meta-value">${safeText(account.proxyWalletAddress, "—")}</span></div>
          <div class="meta-box"><span class="meta-label">Signature Type</span><span class="meta-value">${safeText(account.signatureType ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Funder</span><span class="meta-value">${safeText(account.funderAddress, "—")}</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>Live Readiness</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Can Enable Live</span><span class="meta-value">${account.canEnableLiveMode ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder Ready</span><span class="meta-value">${account.builderReady ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder API</span><span class="meta-value">${account.builderApiConfigured ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Relayer</span><span class="meta-value">${account.relayerReady ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Signed Handoff</span><span class="meta-value">${account.signedOrderHandoffEnabled ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Real Live Submit</span><span class="meta-value">${account.realLiveSubmitEnabled ? "ON" : "SAFE FALLBACK"}</span></div>
          <div class="meta-box"><span class="meta-label">Max Live Submit</span><span class="meta-value">${safeText(formatMoney(account.maxRealSubmitDollars || 0))}</span></div>
        </div>
        <div class="alert-item" style="margin-top: 10px;">
          <div class="alert-message">Live Mode</div>
          <label class="alert-time" style="display:flex; gap:10px; align-items:center;">
            <input type="checkbox" id="liveModeToggle" ${liveChecked} ${liveToggleDisabled} style="width:auto;" />
            Enable Live Mode
          </label>
          ${blockers ? `<div style="margin-top:10px;">${blockers}</div>` : `<div class="alert-time">No blockers detected.</div>`}
        </div>
      </article>
    </div>
  `;
}

function renderDisconnectedWalletShell(account = {}) {
  const providerAvailable = hasBrowserWalletProvider();

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Connect Wallet</h3>
        <div class="alert-item">
          <div class="alert-message">Use a browser wallet for the cleanest connection flow.</div>
          <div class="alert-time">This keeps the product feeling closer to a real Polymarket-style workflow while preserving the current safe backend architecture.</div>
        </div>

        <div style="margin-top: 14px; display:flex; gap:12px; flex-wrap:wrap;">
          <button id="browserWalletConnectBtn" ${providerAvailable ? "" : "disabled"}>
            ${providerAvailable ? "Connect Browser Wallet" : "Browser Wallet Not Detected"}
          </button>
        </div>

        <div class="alert-item" style="margin-top: 14px;">
          <div class="alert-message">${providerAvailable ? "Wallet provider detected in this browser." : "No browser wallet provider detected."}</div>
          <div class="alert-time">${providerAvailable ? "You can connect with your injected wallet and keep the rest of the live flow unchanged." : "You can still use the manual fallback below for safe demo and testing flows."}</div>
        </div>

        <details style="margin-top: 16px;">
          <summary style="cursor:pointer; font-weight:600;">Use manual fallback instead</summary>
          <div style="margin-top: 14px;">
            <div class="market-meta">
              <div class="meta-box">
                <span class="meta-label">Wallet Address</span>
                <input id="connectWalletAddress" type="text" placeholder="0x..." />
              </div>
              <div class="meta-box">
                <span class="meta-label">Funder Address</span>
                <input id="connectFunderAddress" type="text" placeholder="Defaults to wallet address" />
              </div>
            </div>

            <details style="margin-top: 14px;">
              <summary style="cursor:pointer; font-weight:600;">Advanced wallet fields</summary>
              <div class="market-meta" style="margin-top: 14px;">
                <div class="meta-box">
                  <span class="meta-label">Wallet Type</span>
                  <select id="connectWalletType">
                    <option value="EOA">EOA</option>
                    <option value="POLYMARKET_PROXY">POLYMARKET_PROXY</option>
                  </select>
                </div>
                <div class="meta-box">
                  <span class="meta-label">Proxy Wallet</span>
                  <input id="connectProxyWallet" type="text" placeholder="Optional / required for proxy mode" />
                </div>
                <div class="meta-box">
                  <span class="meta-label">Signature Type</span>
                  <input id="connectSignatureType" type="number" min="0" step="1" placeholder="0" />
                </div>
              </div>
            </details>

            <div style="margin-top: 14px;">
              <button id="connectAccountBtn">Use Manual Connection</button>
            </div>
          </div>
        </details>
      </article>

      <article class="market-card">
        <h3>Connection Behavior</h3>
        <div class="alerts-list">
          <div class="alert-item">
            <div class="alert-message">Server-side builder readiness stays unchanged.</div>
          </div>
          <div class="alert-item">
            <div class="alert-message">Real submit remains in safe fallback mode.</div>
          </div>
          <div class="alert-item">
            <div class="alert-message">Manual fallback remains available for beginner-safe testing.</div>
          </div>
          <div class="alert-item">
            <div class="alert-message">Once connected, the existing account-state, live-mode, and execution-prep flows continue to work as before.</div>
          </div>
          <div class="alert-item">
            <div class="alert-message">Builder API</div>
            <div class="alert-time">${account.builderApiConfigured ? "READY" : "NOT READY"}</div>
          </div>
          <div class="alert-item">
            <div class="alert-message">Relayer</div>
            <div class="alert-time">${account.relayerReady ? "READY" : "NOT READY"}</div>
          </div>
        </div>
      </article>
    </div>
  `;
}

function renderConnectedWalletShell(account = {}) {
  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Wallet Connected</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Wallet</span><span class="meta-value">${safeText(shortAddress(account.walletAddress))}</span></div>
          <div class="meta-box"><span class="meta-label">Wallet Type</span><span class="meta-value">${safeText(account.walletType, "EOA")}</span></div>
          <div class="meta-box"><span class="meta-label">Proxy Wallet</span><span class="meta-value">${account.proxyWalletAddress ? safeText(shortAddress(account.proxyWalletAddress)) : "—"}</span></div>
          <div class="meta-box"><span class="meta-label">Funder</span><span class="meta-value">${account.funderAddress ? safeText(shortAddress(account.funderAddress)) : "—"}</span></div>
        </div>

        <div class="alert-item" style="margin-top: 14px;">
          <div class="alert-message">Your wallet connection shell is active.</div>
          <div class="alert-time">This keeps the existing backend readiness and signed-handoff flow intact while making the UI feel more product-like.</div>
        </div>

        <div style="margin-top: 14px;">
          <button id="disconnectAccountBtn">Clear Wallet Connection</button>
        </div>
      </article>

      <article class="market-card">
        <h3>Builder Server Status</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Config Source</span><span class="meta-value">${safeText(account.builderConfigSource, "SERVER_ENV")}</span></div>
          <div class="meta-box"><span class="meta-label">Builder API</span><span class="meta-value">${account.builderApiConfigured ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Relayer</span><span class="meta-value">${account.relayerReady ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Live Routing</span><span class="meta-value">${account.liveRoutingEnabled ? "ON" : "OFF"}</span></div>
          <div class="meta-box"><span class="meta-label">Signed Handoff</span><span class="meta-value">${account.signedOrderHandoffEnabled ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Real Submit</span><span class="meta-value">${account.realLiveSubmitEnabled ? "ON" : "SAFE FALLBACK"}</span></div>
          <div class="meta-box"><span class="meta-label">Max Submit</span><span class="meta-value">${safeText(formatMoney(account.maxRealSubmitDollars || 0))}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">Builder readiness is read-only.</div>
          <div class="alert-time">This status comes from Render environment variables and backend checks, not frontend toggles.</div>
        </div>
      </article>
    </div>
  `;
}

function renderAccountControls(account = {}) {
  return account.isConnected
    ? renderConnectedWalletShell(account)
    : renderDisconnectedWalletShell(account);
}

function renderPaperPortfolioStats(stats) {
  const bankroll = stats.bankroll || {};
  const closedWinRate = ((stats.closedWinRate || 0) * 100).toFixed(1);

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Bankroll</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Starting</span><span class="meta-value">${safeText(formatMoney(bankroll.startingBankroll || 0))}</span></div>
          <div class="meta-box"><span class="meta-label">Cash</span><span class="meta-value">${safeText(formatMoney(bankroll.cash || 0))}</span></div>
          <div class="meta-box"><span class="meta-label">Equity</span><span class="meta-value">${safeText(formatMoney(bankroll.equity || 0))}</span></div>
          <div class="meta-box"><span class="meta-label">Default Size</span><span class="meta-value">${safeText(formatMoney(bankroll.defaultPositionSize || 0))}</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>Paper Trading Summary</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Total Positions</span><span class="meta-value">${safeText(stats.totalPositions ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Open</span><span class="meta-value">${safeText(stats.openPositions ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Closed</span><span class="meta-value">${safeText(stats.closedPositions ?? 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Closed Win Rate</span><span class="meta-value">${safeText(closedWinRate)}%</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>P&amp;L</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Avg Open P&amp;L</span><span class="meta-value">${safeText(formatPoints(stats.avgOpenPnl || 0))}</span></div>
          <div class="meta-box"><span class="meta-label">Realized P&amp;L</span><span class="meta-value">${safeText(formatMoney(stats.realizedPnl || 0))}</span></div>
          <div class="meta-box"><span class="meta-label">Unrealized P&amp;L</span><span class="meta-value">${safeText(formatMoney(stats.unrealizedPnlDollars || 0))}</span></div>
          <div class="meta-box"><span class="meta-label">Closed Wins</span><span class="meta-value">${safeText(stats.closedWins ?? 0)}</span></div>
        </div>
      </article>
    </div>
  `;
}

function renderPaperPositionItem(position) {
  const pnl = position.pnlPoints ?? 0;
  const pnlDollar = position.pnlDollars ?? 0;
  const pnlClass = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";
  const statusClass =
    position.status === "OPEN" ? "" : pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";

  const closeButton =
    position.status === "OPEN"
      ? `<button class="close-position-btn" data-position-id="${safeAttr(position.id)}">Close Position</button>`
      : "";

  return `
    <div class="alert-item">
      <div class="alert-message">${safeText(position.actionSignal)}: ${safeText(position.question)}</div>
      <div class="alert-time">Source: ${safeText(position.source, "AUTO")}</div>
      <div class="alert-time">Opened: ${safeText(formatTimestamp(position.openedAt))}</div>
      <div class="alert-time">Why it was opened: ${safeText(position.actionReason)}</div>
      <div class="alert-time">Confidence: ${safeText(position.confidenceScore)}/100</div>
      <div class="alert-time">Size: ${safeText(formatMoney(position.positionSizeDollars || 0))}</div>
      <div class="alert-time">Entry: ${safeText(formatProbability(position.entryYesPrice))}</div>
      <div class="alert-time">Current: ${safeText(formatProbability(position.currentYesPrice))}</div>
      <div class="alert-time ${pnlClass}">P&amp;L Points: ${safeText(formatPoints(pnl))}</div>
      <div class="alert-time ${pnlClass}">P&amp;L Dollars: ${safeText(formatMoney(pnlDollar))}</div>
      <div class="alert-time ${statusClass}">Status: ${safeText(position.status)}</div>
      ${position.closeReason ? `<div class="alert-time">Close Reason: ${safeText(position.closeReason)}</div>` : ""}
      ${position.closedAt ? `<div class="alert-time">Closed: ${safeText(formatTimestamp(position.closedAt))}</div>` : ""}
      ${closeButton}
    </div>
  `;
}

function renderManualTradeControls() {
  return `
    <div class="market-card">
      <h3>Manual Paper Entry</h3>
      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Market ID</span><input id="manualMarketId" type="text" placeholder="Enter market ID" /></div>
        <div class="meta-box"><span class="meta-label">Signal Side</span>
          <select id="manualActionSignal">
            <option value="BUY YES">BUY YES</option>
            <option value="BUY NO">BUY NO</option>
          </select>
        </div>
        <div class="meta-box"><span class="meta-label">Position Size ($)</span><input id="manualPositionSize" type="number" min="1" step="1" placeholder="50" /></div>
        <div class="meta-box"><span class="meta-label">Action</span><button id="openManualPositionBtn">Open Position</button></div>
      </div>
    </div>
  `;
}

function renderResetControls() {
  return `
    <div class="market-card">
      <h3>Portfolio Reset</h3>
      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Starting Bankroll</span><input id="resetStartingBankroll" type="number" min="1" step="1" placeholder="1000" /></div>
        <div class="meta-box"><span class="meta-label">Default Position Size</span><input id="resetDefaultPositionSize" type="number" min="1" step="1" placeholder="50" /></div>
        <div class="meta-box"><span class="meta-label">Action</span><button id="resetPaperPortfolioBtn">Reset Portfolio</button></div>
      </div>
    </div>
  `;
}

function renderTradeTicket(quote) {
  const mode = getCurrentTradeMode();
  const liveBlocked = mode === "LIVE" && !(accountStateCache?.canEnableLiveMode);

  const liveActionButton = liveBlocked
    ? `<button id="prepareLiveTradeBtn" disabled>Advanced Requirements Not Met</button>`
    : `<button id="prepareLiveTradeBtn">${mode === "LIVE" ? "Prepare Advanced Demo" : "Preview Trade"}</button>`;

  return `
    <div class="market-card">
      <h3>Trade Preview</h3>
      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Question</span><span class="meta-value">${safeText(quote.question)}</span></div>
        <div class="meta-box"><span class="meta-label">Mode</span><span class="meta-value">${safeText(mode)}</span></div>
        <div class="meta-box"><span class="meta-label">Side</span><span class="meta-value">${safeText(quote.side)}</span></div>
        <div class="meta-box"><span class="meta-label">Selected Price</span><span class="meta-value">${safeText(formatProbability(quote.selectedPrice))}</span></div>
        <div class="meta-box"><span class="meta-label">Size</span><span class="meta-value">${safeText(formatMoney(quote.sizeDollars))}</span></div>
        <div class="meta-box"><span class="meta-label">Estimated Shares</span><span class="meta-value">${safeText(quote.estimatedShares)}</span></div>
        <div class="meta-box"><span class="meta-label">Estimated Max Loss</span><span class="meta-value">${safeText(formatMoney(quote.estimatedMaxLoss))}</span></div>
        <div class="meta-box"><span class="meta-label">Potential Profit</span><span class="meta-value">${safeText(formatMoney(quote.estimatedProfitIfCorrect))}</span></div>
        <div class="meta-box"><span class="meta-label">Confidence</span><span class="meta-value">${safeText(quote.confidenceScore)}/100</span></div>
        <div class="meta-box"><span class="meta-label">Why this trade</span><span class="meta-value">${safeText(quote.actionReason)}</span></div>
      </div>

      ${liveBlocked ? `<div class="alert-item"><div class="alert-message">Live mode is blocked.</div><div class="alert-time">Connect an account and clear readiness blockers first.</div></div>` : ""}

      <div class="market-footer">
        <button id="executePaperTradeBtn" ${mode === "LIVE" ? "style='display:none;'" : ""}>Execute Paper Trade</button>
        ${liveActionButton}
      </div>
    </div>
  `;
}

function renderSignedOrderSubmitResult(response, isError = false) {
  const result = response?.result || {};
  const summary = result.requestSummary || {};
  const clobResponse = result.clobResponse || null;
  const blockedReasons = result.blockedReasons || [];

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>${isError ? "Signed Handoff Error" : "Real Submit Result"}</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Status</span><span class="meta-value">${safeText(result.status || (isError ? "ERROR" : "DONE"))}</span></div>
          <div class="meta-box"><span class="meta-label">Forwarded</span><span class="meta-value">${response?.forwarded ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Blocked</span><span class="meta-value">${response?.blocked ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Safe Fallback</span><span class="meta-value">${response?.dryRunFallback ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Real Submission</span><span class="meta-value">${summary.realSubmissionAttempted ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder Attribution</span><span class="meta-value">${summary.builderAttributionAttached ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">User L2 Auth</span><span class="meta-value">${summary.userL2AuthAttached ? "YES" : "NO"}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">${safeText(result.message || response?.error || "No response message provided.")}</div>
        </div>
      </article>

      <article class="market-card">
        <h3>Request Summary</h3>
        <div class="alert-item">
          <pre style="margin:0; white-space:pre-wrap; word-break:break-word; font-size:0.82rem; line-height:1.5; color:#cbd5e1;">${formatJsonBlock(summary)}</pre>
        </div>
      </article>
    </div>

    ${blockedReasons.length ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>Why this is blocked</h3>
          <div class="alerts-list">
            ${blockedReasons
              .map(
                (reason) => `
              <div class="alert-item">
                <div class="alert-message">${safeText(reason)}</div>
              </div>
            `
              )
              .join("")}
          </div>
        </article>
      </div>
    ` : ""}

    ${clobResponse ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>CLOB Response</h3>
          <div class="alert-item">
            <pre style="margin:0; white-space:pre-wrap; word-break:break-word; font-size:0.82rem; line-height:1.5; color:#cbd5e1;">${formatJsonBlock(clobResponse)}</pre>
          </div>
        </article>
      </div>
    ` : ""}
  `;
}

function renderLivePreparation(preparation) {
  const ticket = preparation.ticket || {};
  const handoff = preparation.signedOrderHandoff || {};
  const blockedReasons = handoff.blockedReasons || [];
  const nextSteps = preparation.nextSteps || [];
  const realSubmitPolicy = handoff.realSubmitPolicy || {};
  const realSubmitReadiness = handoff.realSubmitReadiness || {};

  const handoffBlocked = !!handoff.blocked;
  const fallbackMode = !!realSubmitReadiness.fallbackMode;
  const guardedReady = !!realSubmitReadiness.readyForGuardedSubmit;
  const showPayload = !handoffBlocked;
  const showAuthPrep = showPayload;
  const showSubmitSection = showPayload;
  const showBlockedSection = handoffBlocked && blockedReasons.length > 0;
  const showFallbackSection = !handoffBlocked && fallbackMode;
  const showSafetyNotes = Array.isArray(handoff.notes) && handoff.notes.length > 0;
  const showNextSteps = !handoffBlocked && Array.isArray(nextSteps) && nextSteps.length > 0;

  const canSignClientSide =
    showPayload &&
    hasBrowserWalletProvider() &&
    walletConnectionSource === "BROWSER" &&
    !!accountStateCache?.walletAddress;

  hydrateUserAuthDraftDefaults();

  let stateLabel = "Review";
  let stateMessage = preparation.message || "Live preparation complete.";

  if (handoffBlocked) {
    stateLabel = "Blocked";
  } else if (fallbackMode) {
    stateLabel = "Safety Guard Active";
    stateMessage =
      "This live path is intentionally held in safe fallback mode. The backend is protecting real submission until server policy is explicitly enabled.";
  } else if (guardedReady) {
    stateLabel = "Guarded Submit Ready";
  }

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Execution Prep Status</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Mode</span><span class="meta-value">${safeText(preparation.mode, "LIVE")}</span></div>
          <div class="meta-box"><span class="meta-label">Status</span><span class="meta-value">${safeText(preparation.status, "—")}</span></div>
          <div class="meta-box"><span class="meta-label">Current State</span><span class="meta-value">${safeText(stateLabel)}</span></div>
          <div class="meta-box"><span class="meta-label">Builder Ready</span><span class="meta-value">${preparation.builderReady ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Submission Mode</span><span class="meta-value">${safeText(handoff.submissionMode, "SAFE_FALLBACK_ONLY")}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">${safeText(stateMessage)}</div>
          <div class="alert-time">Question: ${safeText(ticket.question, "—")}</div>
          <div class="alert-time">Side: ${safeText(ticket.side, "—")}</div>
          <div class="alert-time">Size: ${safeText(formatMoney(ticket.sizeDollars || 0))}</div>
          <div class="alert-time">Selected Price: ${safeText(formatProbability(ticket.selectedPrice))}</div>
        </div>
      </article>

      <article class="market-card">
        <h3>Real Submit Guardrails</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Server Enabled</span><span class="meta-value">${realSubmitPolicy.enabled ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Safe Fallback</span><span class="meta-value">${fallbackMode ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Requested Size</span><span class="meta-value">${safeText(formatMoney(realSubmitReadiness.requestedSizeDollars || 0))}</span></div>
          <div class="meta-box"><span class="meta-label">Max Submit Size</span><span class="meta-value">${safeText(formatMoney(realSubmitPolicy.maxSubmitDollars || 0))}</span></div>
          <div class="meta-box"><span class="meta-label">Within Max Size</span><span class="meta-value">${realSubmitReadiness.withinMaxSubmitSize ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Guarded Ready</span><span class="meta-value">${guardedReady ? "YES" : "NO"}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">Confirmation text required before real submit</div>
          <div class="alert-time">${safeText(realSubmitPolicy.confirmText, "—")}</div>
        </div>
      </article>
    </div>

    ${showBlockedSection ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>Why this is blocked</h3>
          <div class="alerts-list">
            ${blockedReasons
              .map(
                (reason) => `
              <div class="alert-item">
                <div class="alert-message">${safeText(reason)}</div>
              </div>
            `
              )
              .join("")}
          </div>
        </article>
      </div>
    ` : ""}

    ${showFallbackSection ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>Intentional Safety Guard</h3>
          <div class="alert-item">
            <div class="alert-message">Real live submit is intentionally off right now.</div>
            <div class="alert-time">You can still prepare signing and user auth inputs now, but actual submission remains blocked until guarded readiness is explicitly available.</div>
          </div>
        </article>
      </div>
    ` : ""}

    ${showPayload ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>Signable Order Payload</h3>
          <div class="alert-item">
            <div class="alert-message">Review the prepared order payload.</div>
            <div class="alert-time">This app does not move the user private key to the server.</div>
            <pre style="margin:12px 0 0; white-space:pre-wrap; word-break:break-word; font-size:0.82rem; line-height:1.5; color:#cbd5e1;">${formatJsonBlock(handoff.signableOrder)}</pre>
          </div>
        </article>
      </div>
    ` : ""}

    ${showPayload ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>Client-Side Order Signing</h3>
          <div class="alert-item">
            <div class="alert-message">
              ${canSignClientSide
                ? "Sign the prepared order payload with your connected browser wallet."
                : "Browser-wallet order signing is not available in the current connection state."}
            </div>
            <div class="alert-time">
              ${canSignClientSide
                ? "This signs the actual prepared order object client-side using the browser wallet flow. No private keys move to the server."
                : walletConnectionSource === "MANUAL"
                  ? "Use the browser wallet connection flow to create a true in-browser signed order. Manual connection remains available as a fallback."
                  : "Connect a browser wallet to sign the prepared order in-browser."}
            </div>
          </div>

          <div style="margin-top: 14px;">
            <button id="signPreparedOrderBtn" ${canSignClientSide ? "" : "disabled"}>
              ${canSignClientSide ? "Sign Prepared Order" : "Browser Wallet Signing Unavailable"}
            </button>
          </div>

          ${currentClientSignedOrder ? `
            <div class="alert-item" style="margin-top: 14px;">
              <div class="alert-message">Client-side signed order created.</div>
              <div class="alert-time">This signed JSON is the order object to use in the guarded submit handoff.</div>
              <pre style="margin:12px 0 0; white-space:pre-wrap; word-break:break-word; font-size:0.82rem; line-height:1.5; color:#cbd5e1;">${formatJsonBlock(currentClientSignedOrder)}</pre>
            </div>
          ` : ""}
        </article>
      </div>
    ` : ""}

    ${showAuthPrep ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>Guarded Submit Auth Prep</h3>
          <div class="alert-item">
            <div class="alert-message">Prepare user L2 auth now.</div>
            <div class="alert-time">
              ${guardedReady
                ? "This auth bundle will be used by the guarded handoff if you proceed."
                : "This is preparation only while the app remains in safe fallback mode. Actual submission stays disabled."}
            </div>
          </div>

          <details style="margin-top: 14px;">
            <summary style="cursor:pointer; font-weight:600;">What these fields are</summary>
            <div class="alerts-list" style="margin-top: 12px;">
              <div class="alert-item">
                <div class="alert-message">Address</div>
                <div class="alert-time">The wallet address tied to the Polymarket L2 auth credentials you plan to use.</div>
              </div>
              <div class="alert-item">
                <div class="alert-message">API Key</div>
                <div class="alert-time">Your Polymarket L2 API key used for authenticated order-routing requests.</div>
              </div>
              <div class="alert-item">
                <div class="alert-message">Secret</div>
                <div class="alert-time">Your Polymarket L2 API secret paired with the API key.</div>
              </div>
              <div class="alert-item">
                <div class="alert-message">Passphrase</div>
                <div class="alert-time">Your Polymarket L2 passphrase paired with the same credential set.</div>
              </div>
              <div class="alert-item">
                <div class="alert-message">Important safety note</div>
                <div class="alert-time">These are sensitive Polymarket L2 auth credentials. Do not include them in screenshots and do not share them publicly.</div>
              </div>
              <div class="alert-item">
                <div class="alert-message">How this app handles them</div>
                <div class="alert-time">This app keeps them in current browser memory only for preparation in this session and does not store them in localStorage.</div>
              </div>
              <div class="alert-item">
                <div class="alert-message">Current state</div>
                <div class="alert-time">This is preparation for guarded submit only. It does not mean active real submission is on.</div>
              </div>
            </div>
          </details>

          <div id="userAuthInlineStatus" style="display:none; margin-top: 12px;"></div>

          <div class="market-meta" style="margin-top: 12px;">
            <div class="meta-box">
              <span class="meta-label">Auth Address</span>
              <input id="userAuthAddressInput" type="text" placeholder="0x..." autocomplete="off" />
            </div>
            <div class="meta-box">
              <span class="meta-label">API Key</span>
              <input id="userAuthApiKeyInput" type="password" placeholder="Paste API key" autocomplete="off" />
            </div>
            <div class="meta-box">
              <span class="meta-label">Secret</span>
              <input id="userAuthSecretInput" type="password" placeholder="Paste secret" autocomplete="off" />
            </div>
            <div class="meta-box">
              <span class="meta-label">Passphrase</span>
              <input id="userAuthPassphraseInput" type="password" placeholder="Paste passphrase" autocomplete="off" />
            </div>
          </div>

          <div style="margin-top: 12px; display:flex; gap:12px; flex-wrap:wrap;">
            <button id="fillUserAuthAddressBtn" type="button">Use Connected Wallet Address</button>
            <button id="clearUserAuthFieldsBtn" type="button">Clear Auth Fields</button>
          </div>

          <details style="margin-top: 14px;">
            <summary style="cursor:pointer; font-weight:600;">Use raw JSON fallback instead</summary>
            <div class="alert-item" style="margin-top: 12px;">
              <div class="alert-message">Raw user auth JSON fallback</div>
              <div class="alert-time">Paste one full Polymarket L2 auth JSON bundle here, then apply it to the structured fields for this browser session only.</div>
              <textarea
                id="userAuthJsonInput"
                rows="8"
                placeholder="Paste user auth JSON here"
                style="width:100%; margin-top:10px; padding:12px; border-radius:12px; border:1px solid #1e293b; background:#020817; color:#f8fafc; font-size:0.9rem; line-height:1.5;"
              ></textarea>
              <div style="margin-top: 12px; display:flex; gap:12px; flex-wrap:wrap;">
                <button id="applyUserAuthJsonBtn" type="button">Apply Auth JSON to Fields</button>
              </div>
              <div class="alert-time" style="margin-top: 10px;">After a successful apply, the raw JSON box is cleared so the structured fields become the active session source.</div>
              <pre style="margin:12px 0 0; white-space:pre-wrap; word-break:break-word; font-size:0.8rem; line-height:1.45; color:#94a3b8;">${formatJsonBlock(handoff.userAuthSchema)}</pre>
            </div>
          </details>
        </article>
      </div>
    ` : ""}

    ${showSubmitSection ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>${guardedReady ? "Submit Signed Order Handoff" : "Guarded Submit Preparation"}</h3>
          <div class="alert-item">
            <div class="alert-message">Signed order JSON</div>
            <div class="alert-time">
              ${guardedReady
                ? "This field is auto-filled after a successful browser-wallet signing step, but manual paste remains available."
                : "You can prepare the signed order and auth inputs now, but actual guarded submission remains disabled in safe fallback mode."}
            </div>
            <textarea
              id="signedOrderInput"
              rows="10"
              placeholder="Paste signed order JSON here"
              style="width:100%; margin-top:10px; padding:12px; border-radius:12px; border:1px solid #1e293b; background:#020817; color:#f8fafc; font-size:0.9rem; line-height:1.5;"
            ></textarea>
          </div>

          <div class="alert-item" style="margin-top: 12px;">
            <div class="alert-message">Type the confirmation text exactly</div>
            <div class="alert-time">${safeText(realSubmitPolicy.confirmText, "—")}</div>
            <input
              id="realSubmitConfirmInput"
              type="text"
              placeholder="Type confirmation text exactly"
              style="margin-top:10px;"
            />
          </div>

          <div style="margin-top: 14px;">
            <button id="submitSignedOrderBtn" ${guardedReady ? "" : "disabled"}>
              ${guardedReady ? "Guarded Real Submit" : "Guarded Real Submit Unavailable"}
            </button>
          </div>
        </article>
      </div>
    ` : ""}

    ${(showSafetyNotes || showNextSteps) ? `
      <div class="market-grid" style="margin-top: 18px;">
        ${showSafetyNotes ? `
          <article class="market-card">
            <h3>Safety Notes</h3>
            <div class="alerts-list">
              ${(handoff.notes || [])
                .map(
                  (note) => `
                <div class="alert-item">
                  <div class="alert-message">${safeText(note)}</div>
                </div>
              `
                )
                .join("")}
            </div>
          </article>
        ` : ""}

        ${showNextSteps ? `
          <article class="market-card">
            <h3>Next Steps</h3>
            <div class="alerts-list">
              ${nextSteps
                .map(
                  (step) => `
                <div class="alert-item">
                  <div class="alert-message">${safeText(step)}</div>
                </div>
              `
                )
                .join("")}
            </div>
          </article>
        ` : ""}
      </div>
    ` : ""}
  `;
}

function renderHotCard(market, sourceSection = currentDiscoverView) {
  const trackingSource = normalizeOutboundSourceSection(sourceSection);
  const publicCategory = getPublicCategoryLabel(market);
  const eventGroup = getMarketEventGroup(market);
  const heatBadges = getMarketHeatBadges(market);

  return `
    <article class="market-card">
      <div class="market-context-row">
        <span>${safeText(publicCategory)}</span>
        ${eventGroup ? `<span>${safeText(eventGroup)}</span>` : ""}
      </div>
      <h3>${safeText(market.question)}</h3>

      ${renderHeatBadges(heatBadges)}
      ${renderMovementVisual(market)}

      <div class="signals">
        ${[
          getMarketSignalLabel(market),
          market.dataFreshness === "fresh" ? "Fresh" : "",
        ]
          .filter(Boolean)
          .map((signal) => `<span class="signal">${safeText(signal)}</span>`)
          .join("")}
      </div>

      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Yes Price</span><span class="meta-value">${safeText(formatProbability(market.yesPriceLive))}</span></div>
        <div class="meta-box"><span class="meta-label">24h Volume</span><span class="meta-value">${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</span></div>
        <div class="meta-box"><span class="meta-label">Liquidity</span><span class="meta-value">${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))}</span></div>
        <div class="meta-box"><span class="meta-label">Activity</span><span class="meta-value">${safeText(formatActivityScore(market))}</span></div>
        <div class="meta-box"><span class="meta-label">Category</span><span class="meta-value">${safeText(publicCategory)}</span></div>
        ${eventGroup ? `<div class="meta-box"><span class="meta-label">Event / group</span><span class="meta-value">${safeText(eventGroup)}</span></div>` : ""}
        <div class="meta-box"><span class="meta-label">Freshness</span><span class="meta-value">${safeText(getMarketFreshnessLabel(market))}</span></div>
        <div class="meta-box"><span class="meta-label">Why it matters</span><span class="meta-value">${safeText(getMarketDisplayReason(market))}</span></div>
      </div>

      <div class="market-footer">
        <span class="market-small">${safeText(market.slug || "Market")} • Updated ${safeText(formatTimestamp(market.lastUpdated))}</span>
        <a
          class="market-link market-link-primary"
          href="${safeUrl(market.url)}"
          target="_blank"
          rel="noopener noreferrer"
          data-outbound-click="polymarket"
          data-market-id="${safeAttr(getMarketTrackingId(market))}"
          data-market-slug="${safeAttr(market.slug)}"
          data-market-question="${safeAttr(market.question)}"
          data-market-url="${safeAttr(market.url)}"
          data-source-section="${safeAttr(trackingSource)}"
          data-cta="view-on-polymarket"
        >View on Polymarket</a>
      </div>

      <div class="market-footer" style="margin-top: 12px;">
        ${renderMarketPageLink(market)}
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY YES">Preview YES</button>
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY NO">Preview NO</button>
        ${renderWatchlistButton(market, sourceSection)}
      </div>
    </article>
  `;
}

function renderGroupedMarketChild(market, sourceSection, index) {
  const trackingSource = normalizeOutboundSourceSection(sourceSection);
  const label = getMarketOutcomeLabel(market);
  const isExtra = index >= 5;

  return `
    <div class="grouped-market-child ${isExtra ? "grouped-market-child-extra" : ""}">
      <div class="grouped-market-child-main">
        <div class="alert-message">${safeText(label)}</div>
        <div class="alert-time">${safeText(market.question)}</div>
        ${renderMovementVisual(market)}
      </div>
      <div class="grouped-market-child-meta">
        <span>${safeText(formatProbability(market.yesPriceLive))}</span>
        <span>${safeText(formatMoney(market.volume24hr, "Volume unavailable"))} vol</span>
        <span>${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))} liq</span>
      </div>
      <div class="grouped-market-child-actions">
        <a
          class="market-link market-link-primary"
          href="${safeUrl(market.url)}"
          target="_blank"
          rel="noopener noreferrer"
          data-outbound-click="polymarket"
          data-market-id="${safeAttr(getMarketTrackingId(market))}"
          data-market-slug="${safeAttr(market.slug)}"
          data-market-question="${safeAttr(market.question)}"
          data-market-url="${safeAttr(market.url)}"
          data-source-section="${safeAttr(trackingSource)}"
          data-cta="view-on-polymarket"
        >View</a>
        ${renderMarketPageLink(market, "Full page")}
        ${renderWatchlistButton(market, "grouped-event-child")}
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY YES">Preview YES</button>
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY NO">Preview NO</button>
      </div>
    </div>
  `;
}

function renderMarketFamilyCard(group, sourceSection = currentDiscoverView) {
  const children = Array.isArray(group.children) ? group.children : [];
  const visibleChildren = children.slice(0, 5);
  const extraChildren = children.slice(5);
  const groupId = `group-${safeAttr(group.key)}`;
  const eventSlug = group.eventSlug || getEventSlugFromParts(group.eventGroup, group.key);
  const heatBadges = getGroupHeatBadges(group);

  return `
    <article class="market-card market-family-card">
      <div class="market-context-row">
        <span>${safeText(group.category)}</span>
        <span>${safeText(group.eventGroup)}</span>
      </div>

      <div class="market-family-header">
        <div>
          <h3>${safeText(group.eventGroup)}</h3>
          <div class="alert-time">${safeText(group.reason)}</div>
        </div>
        <div class="market-family-header-actions">
          <span class="signal">${safeText(children.length)} markets</span>
          <button
            class="market-link market-link-primary event-detail-open-btn"
            type="button"
            data-event-slug="${safeAttr(eventSlug)}"
          >View Event</button>
        </div>
      </div>

      ${renderHeatBadges(heatBadges)}

      <div class="grouped-market-list" aria-label="${safeAttr(group.eventGroup)} markets">
        ${visibleChildren
          .map((market, index) => renderGroupedMarketChild(market, sourceSection, index))
          .join("")}
      </div>

      ${extraChildren.length ? `
        <details id="${groupId}" class="grouped-market-more">
          <summary>
            <span class="show-more-label">Show ${safeText(extraChildren.length)} more</span>
            <span class="show-less-label">Show less</span>
          </summary>
          <div class="grouped-market-list">
            ${extraChildren
              .map((market, index) => renderGroupedMarketChild(market, sourceSection, index + 5))
              .join("")}
          </div>
        </details>
      ` : ""}

      <div class="alert-time market-family-note">Open the event to compare every related market in one focused view.</div>
    </article>
  `;
}

function ensureEventDetailSection() {
  let section = document.getElementById("eventDetailView");
  if (section) return section;

  section = document.createElement("section");
  section.id = "eventDetailView";
  section.className = "event-detail-section event-detail-hidden";

  const strategySection = document.getElementById("homepageStrategyLayer");
  if (strategySection?.parentElement) {
    strategySection.parentElement.insertBefore(section, strategySection);
    return section;
  }

  document.querySelector("main")?.prepend(section);
  return section;
}

function ensureMarketPageSection() {
  let section = document.getElementById("marketPageView");
  if (section) return section;

  section = document.createElement("section");
  section.id = "marketPageView";
  section.className = "market-page-section market-page-hidden";

  const eventSection = document.getElementById("eventDetailView") || ensureEventDetailSection();
  if (eventSection?.parentElement) {
    eventSection.parentElement.insertBefore(section, eventSection);
    return section;
  }

  document.querySelector("main")?.prepend(section);
  return section;
}

function getRelatedMarketsForMarket(market) {
  const marketId = getMarketDetailId(market);
  const familyKey = getMarketFamilyKey(market);
  const eventSlug = getMarketEventSlug(market);
  const candidates = familyKey ? getEventMarkets(familyKey) : eventSlug ? getEventMarkets(eventSlug) : [];

  return candidates
    .filter((candidate) => getMarketDetailId(candidate) !== marketId)
    .sort((a, b) => getDiscoveryRankScore(b) - getDiscoveryRankScore(a))
    .slice(0, 8);
}

function renderMarketPageRelatedCard(market) {
  const eventGroup = getMarketEventGroup(market);

  return `
    <article class="market-card market-page-related-card">
      <div class="market-context-row">
        <span>${safeText(getPublicCategoryLabel(market))}</span>
        ${eventGroup ? `<span>${safeText(eventGroup)}</span>` : ""}
      </div>
      <p class="market-small">${safeText(getMarketOutcomeLabel(market))}</p>
      <h3>${safeText(market.question)}</h3>
      ${renderHeatBadges(getMarketHeatBadges(market))}
      ${renderMovementVisual(market)}
      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">YES</span><span class="meta-value">${safeText(formatProbability(market.yesPriceLive))}</span></div>
        <div class="meta-box"><span class="meta-label">Volume</span><span class="meta-value">${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</span></div>
        <div class="meta-box"><span class="meta-label">Liquidity</span><span class="meta-value">${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))}</span></div>
      </div>
      <div class="market-footer market-page-action-row">
        ${renderMarketPageLink(market, "Open market page")}
        <a
          class="market-link market-link-primary"
          href="${safeUrl(market.url)}"
          target="_blank"
          rel="noopener noreferrer"
          data-outbound-click="polymarket"
          data-market-id="${safeAttr(getMarketTrackingId(market))}"
          data-market-slug="${safeAttr(market.slug)}"
          data-market-question="${safeAttr(market.question)}"
          data-market-url="${safeAttr(market.url)}"
          data-source-section="market-page-related"
          data-cta="view-on-polymarket"
        >View on Polymarket</a>
      </div>
      <div class="market-footer market-page-action-row" style="margin-top: 12px;">
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY YES">Preview YES</button>
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY NO">Preview NO</button>
        ${renderWatchlistButton(market, "market-page-related")}
      </div>
    </article>
  `;
}

function getMarketPageUrl() {
  try {
    return window.location.href;
  } catch {
    return "";
  }
}

function renderMarketPageView(marketId, options = {}) {
  const section = ensureMarketPageSection();
  const requestedId = String(marketId || "").trim();
  currentMarketPageId = requestedId;
  closeMarketDetailDrawer();

  if (!requestedId) {
    section.classList.add("market-page-hidden");
    section.innerHTML = "";
    return;
  }

  if (currentEventSlug) clearEventDetailView({ updateUrl: false, scroll: false });

  const market = getMarketByDetailId(requestedId);
  if (!market) {
    section.classList.remove("market-page-hidden");
    section.innerHTML = `
      <div class="market-grid">
        <article class="market-card market-page-card">
          <p class="market-small">Market page</p>
          <h2>Market not found</h2>
          <p class="alert-time">This market is not available in the current live market feed. It may have moved, closed, or fallen out of the active filter.</p>
          <div class="market-footer market-page-action-row">
            <button id="marketPageBackBtn" type="button">Back to live markets</button>
          </div>
        </article>
      </div>
    `;
    bindMarketPageControls();
    if (options.scroll !== false) section.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const probabilityMeta = getMarketProbabilityMeta(market.yesPriceLive);
  const eventGroup = getMarketEventGroup(market);
  const relatedMarkets = getRelatedMarketsForMarket(market);
  const movementLabel = hasMarketMovementData(market)
    ? formatChangeAsProbability(getMarketMovementValue(market))
    : "No movement data yet";

  section.classList.remove("market-page-hidden");
  section.innerHTML = `
    <article class="market-card market-page-hero-card">
      <div class="market-page-topline">
        <div>
          <p class="market-page-kicker">Dedicated market page</p>
          <h2>${safeText(market.question)}</h2>
          <p class="market-page-safety-copy">House of Markets is an independent discovery and alerts project. This is not financial advice, and real market action happens on Polymarket.</p>
        </div>
        <button id="marketPageBackBtn" type="button">Back to live markets</button>
      </div>

      <div class="market-context-row market-page-context market-page-pill-row">
        <span>${safeText(getPublicCategoryLabel(market))}</span>
        ${eventGroup ? `<span>${safeText(eventGroup)}</span>` : ""}
        <span>${safeText(formatTimestamp(market.lastUpdated))}</span>
      </div>

      ${renderHeatBadges(getMarketHeatBadges(market))}
      ${renderMovementVisual(market)}

      <div class="market-detail-primary-stats market-page-primary-stats">
        <span><strong>${safeText(probabilityMeta.label)}</strong><small>${safeText(probabilityMeta.note)}</small></span>
        <span><strong>${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</strong><small>24h vol</small></span>
        <span><strong>${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))}</strong><small>liquidity</small></span>
        <span><strong>${safeText(movementLabel)}</strong><small>movement</small></span>
        <span><strong>${safeText(formatTimestamp(market.lastUpdated))}</strong><small>updated</small></span>
      </div>
    </article>

    <nav class="market-page-nav" aria-label="Market page sections">
      <a href="#marketPageOverview">Overview</a>
      <a href="#marketPageSignals">Signals</a>
      <a href="#marketPageRelated">Related</a>
      <a href="#marketPageShare">Share</a>
    </nav>

    <div class="market-page-layout">
      <div class="market-page-main-column">
        <article id="marketPageOverview" class="market-card market-page-card">
          <div class="market-page-section-heading">
            <p class="market-small">Overview</p>
            <h3>Market read</h3>
            <p class="alert-time">Scan the current market state, then use the action card when you are ready to preview interest or open Polymarket.</p>
          </div>
          ${renderMarketDetailOverview(market)}
        </article>

        <article id="marketPageSignals" class="market-card market-page-card">
          <div class="market-page-section-heading">
            <p class="market-small">Signals</p>
            <h3>Structured market details</h3>
          </div>
          ${renderMarketDetailMarketTab(market)}
        </article>

        <article id="marketPageRelated" class="market-card market-page-card market-page-related-section">
          <div class="market-page-section-heading">
            <p class="market-small">Related Markets</p>
            <h3>${safeText(eventGroup || "Related markets")}</h3>
            <p class="alert-time">Compare markets from the same event or family. Each card links to its own dedicated market page.</p>
          </div>
          <div class="market-grid market-page-related-grid" style="margin-top: 14px;">
            ${relatedMarkets.length
              ? relatedMarkets.map(renderMarketPageRelatedCard).join("")
              : `<p class="empty">No related markets are available in the current live feed.</p>`}
          </div>
        </article>

        <article id="marketPageShare" class="market-card market-page-card">
          <div class="market-page-section-heading">
            <p class="market-small">Share</p>
            <h3>Share this market page</h3>
            <p class="alert-time">Copy the page link or use the draft caption below. No social integrations are connected yet.</p>
          </div>
          <div class="market-footer market-page-action-row market-page-copy-link-row">
            <input id="marketPageLinkInput" type="text" readonly value="${safeAttr(getMarketPageUrl())}" aria-label="Market page link" />
            <button id="copyMarketPageLinkBtn" type="button">Copy market link</button>
            <span id="marketPageLinkCopyStatus" class="alert-time" aria-live="polite"></span>
          </div>
          ${renderMarketSocialShareCard(market, {
            textareaId: "marketPageShareText",
            buttonId: "copyMarketPageShareTextBtn",
            statusId: "marketPageCopyStatus",
          })}
        </article>
      </div>

      <aside class="market-page-side-column">
        <article class="market-card market-page-action-card">
          <p class="market-small">Market actions</p>
          <h3>Open or preview</h3>
          <p class="alert-time">Preview buttons stay on House of Markets. View on Polymarket is the real market action.</p>
          <div class="market-page-action-stack">
            <a
              class="market-link market-link-primary"
              href="${safeUrl(market.url)}"
              target="_blank"
              rel="noopener noreferrer"
              data-outbound-click="polymarket"
              data-market-id="${safeAttr(getMarketTrackingId(market))}"
              data-market-slug="${safeAttr(market.slug)}"
              data-market-question="${safeAttr(market.question)}"
              data-market-url="${safeAttr(market.url)}"
              data-source-section="market-page"
              data-cta="view-on-polymarket"
            >View on Polymarket</a>
            <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY YES">Preview YES</button>
            <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY NO">Preview NO</button>
            ${renderWatchlistButton(market, "market-page")}
            <button id="copyMarketPageLinkBtnSide" type="button">Copy market link</button>
            <span id="marketPageLinkCopyStatusSide" class="alert-time" aria-live="polite"></span>
          </div>
        </article>

        <article class="market-card market-page-action-card market-page-mini-facts">
          <p class="market-small">At a glance</p>
          <div class="market-meta">
            <div class="meta-box"><span class="meta-label">YES</span><span class="meta-value">${safeText(probabilityMeta.label)}</span></div>
            <div class="meta-box"><span class="meta-label">Label</span><span class="meta-value">${safeText(probabilityMeta.note)}</span></div>
            <div class="meta-box"><span class="meta-label">Movement</span><span class="meta-value">${safeText(movementLabel)}</span></div>
            <div class="meta-box"><span class="meta-label">Volume</span><span class="meta-value">${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</span></div>
            <div class="meta-box"><span class="meta-label">Liquidity</span><span class="meta-value">${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))}</span></div>
            <div class="meta-box"><span class="meta-label">Updated</span><span class="meta-value">${safeText(formatTimestamp(market.lastUpdated))}</span></div>
          </div>
        </article>
      </aside>
    </div>
  `;

  bindMarketPageControls();
  bindTradeActionButtons();

  if (options.updateUrl) {
    setMarketUrlParam(getMarketDetailId(market));
  }

  if (options.scroll !== false) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function clearMarketPageView(options = {}) {
  currentMarketPageId = "";
  const section = document.getElementById("marketPageView");
  if (section) {
    section.classList.add("market-page-hidden");
    section.innerHTML = "";
  }

  if (options.updateUrl !== false) {
    setMarketUrlParam("", { replace: true });
  }

  if (options.scroll !== false) {
    document.getElementById("homepageQuickDiscovery")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function bindMarketPageControls() {
  const backBtn = document.getElementById("marketPageBackBtn");
  const copyBtn = document.getElementById("copyMarketPageShareTextBtn");
  const shareText = document.getElementById("marketPageShareText");
  const copyStatus = document.getElementById("marketPageCopyStatus");
  const copyLinkBtn = document.getElementById("copyMarketPageLinkBtn");
  const copyLinkBtnSide = document.getElementById("copyMarketPageLinkBtnSide");
  const linkInput = document.getElementById("marketPageLinkInput");
  const linkStatus = document.getElementById("marketPageLinkCopyStatus");
  const linkStatusSide = document.getElementById("marketPageLinkCopyStatusSide");

  const copyMarketPageLink = async (statusElement) => {
    const text = linkInput?.value || getMarketPageUrl();
    try {
      await navigator.clipboard.writeText(text);
      if (statusElement) statusElement.textContent = "Market link copied.";
    } catch {
      linkInput?.focus();
      linkInput?.select();
      if (statusElement) statusElement.textContent = "Select the link to copy.";
    }
  };

  if (backBtn) backBtn.onclick = () => clearMarketPageView({ updateUrl: true });
  if (copyLinkBtn) copyLinkBtn.onclick = () => copyMarketPageLink(linkStatus);
  if (copyLinkBtnSide) copyLinkBtnSide.onclick = () => copyMarketPageLink(linkStatusSide);
  if (copyBtn && shareText) {
    copyBtn.onclick = async () => {
      const text = shareText.value || "";
      try {
        await navigator.clipboard.writeText(text);
        if (copyStatus) copyStatus.textContent = "Copied.";
      } catch {
        shareText.focus();
        shareText.select();
        if (copyStatus) copyStatus.textContent = "Select the text above to copy.";
      }
    };
  }
}

function bindMarketPageLinks() {
  if (marketPageLinksBound) return;
  marketPageLinksBound = true;

  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.(".market-page-link");
    if (!link) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    const marketId = link.dataset.marketPageId || "";
    renderMarketPageView(marketId, { updateUrl: true, scroll: true });
  });
}

function renderRequestedMarketFromUrl(options = {}) {
  const requestedMarketId = getRequestedMarketId();
  if (!requestedMarketId) {
    if (currentMarketPageId) clearMarketPageView({ updateUrl: false, scroll: false });
    return false;
  }

  renderMarketPageView(requestedMarketId, {
    updateUrl: false,
    scroll: options.scroll !== false,
  });
  return true;
}

function renderEventMarketCard(market, sourceSection = "event-detail") {
  const trackingSource = normalizeOutboundSourceSection(sourceSection);
  const movementValue = getMarketMovementValue(market);
  const movementClass = movementValue > 0 ? "positive" : movementValue < 0 ? "negative" : "";
  const heatBadges = getMarketHeatBadges(market);

  return `
    <article class="market-card event-market-card">
      <div class="market-context-row">
        <span>${safeText(getPublicCategoryLabel(market))}</span>
        <span>${safeText(getMarketEventGroup(market) || "Event")}</span>
      </div>

      <div class="event-market-heading">
        <div>
          <p class="market-small">${safeText(getMarketOutcomeLabel(market))}</p>
          <h3>${safeText(market.question)}</h3>
        </div>
      </div>

      ${renderHeatBadges(heatBadges)}
      ${renderMovementVisual(market)}

      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">YES Price</span><span class="meta-value">${safeText(formatProbability(market.yesPriceLive))}</span></div>
        <div class="meta-box"><span class="meta-label">24h Volume</span><span class="meta-value">${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</span></div>
        <div class="meta-box"><span class="meta-label">Liquidity</span><span class="meta-value">${safeText(formatMoney(market.liquidity, "Liquidity unavailable"))}</span></div>
        <div class="meta-box"><span class="meta-label">Recent Movement</span><span class="meta-value ${movementClass}">${safeText(getMarketMovementLabel(market))}</span></div>
        <div class="meta-box"><span class="meta-label">Why it matters</span><span class="meta-value">${safeText(getMarketDisplayReason(market))}</span></div>
      </div>

      <div class="market-footer">
        <span class="market-small">Updated ${safeText(formatTimestamp(market.lastUpdated))}</span>
        <a
          class="market-link market-link-primary"
          href="${safeUrl(market.url)}"
          target="_blank"
          rel="noopener noreferrer"
          data-outbound-click="polymarket"
          data-market-id="${safeAttr(getMarketTrackingId(market))}"
          data-market-slug="${safeAttr(market.slug)}"
          data-market-question="${safeAttr(market.question)}"
          data-market-url="${safeAttr(market.url)}"
          data-source-section="${safeAttr(trackingSource)}"
          data-cta="view-on-polymarket"
        >View on Polymarket</a>
      </div>

      <div class="market-footer" style="margin-top: 12px;">
        <span class="market-small">Safe preview only</span>
        ${renderMarketPageLink(market)}
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY YES">Preview YES</button>
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY NO">Preview NO</button>
        ${renderWatchlistButton(market, sourceSection)}
      </div>
    </article>
  `;
}

function renderEventDetailView(eventSlugOrFamilyKey, options = {}) {
  const section = ensureEventDetailSection();
  const eventSlug = slugifyEventValue(eventSlugOrFamilyKey);
  const markets = getEventMarkets(eventSlugOrFamilyKey);
  currentEventSlug = eventSlug;

  if (eventSlug && currentMarketPageId) clearMarketPageView({ updateUrl: false, scroll: false });

  if (!eventSlug) {
    section.classList.add("event-detail-hidden");
    section.innerHTML = "";
    return;
  }

  if (!markets.length) {
    section.classList.remove("event-detail-hidden");
    section.innerHTML = `
      <div class="market-grid">
        <article class="market-card event-detail-card">
          <p class="market-small">Event detail</p>
          <h2>Event not found</h2>
          <p class="alert-time">This event is not available in the current live market feed. It may have moved, closed, or fallen out of the active filter.</p>
          <div class="market-footer" style="justify-content: flex-start;">
            <button id="eventDetailBackBtn" type="button">Back to live markets</button>
          </div>
        </article>
      </div>
    `;
    bindEventDetailControls();
    if (options.scroll !== false) section.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const summary = getEventSummary(markets);
  const sortedMarkets = getSortedEventMarkets(markets, currentEventSort);
  const eventBadges = getGroupHeatBadges({ children: markets });

  section.classList.remove("event-detail-hidden");
  section.innerHTML = `
    <div class="market-grid">
      <article class="market-card event-detail-card">
        <div class="event-detail-topline">
          <div>
            <p class="market-small">Event detail</p>
            <h2>${safeText(summary.eventGroup)}</h2>
            <p class="alert-time">
              House of Markets helps users discover active prediction market events,
              compare related markets, and open real markets on Polymarket when ready.
            </p>
          </div>
          <button id="eventDetailBackBtn" type="button">Back to live markets</button>
        </div>

        <div class="market-context-row event-detail-context">
          <span>${safeText(summary.category)}</span>
          <span>${safeText(summary.count)} related markets</span>
        </div>

        ${renderHeatBadges(eventBadges)}

        <p class="alert-time event-detail-description">${safeText(summary.reason)}</p>

        <div class="market-meta event-detail-summary">
          <div class="meta-box"><span class="meta-label">Related Markets</span><span class="meta-value">${safeText(summary.count)}</span></div>
          <div class="meta-box"><span class="meta-label">Combined 24h Volume</span><span class="meta-value">${safeText(formatMoney(summary.totalVolume))}</span></div>
          <div class="meta-box"><span class="meta-label">Combined Liquidity</span><span class="meta-value">${safeText(formatMoney(summary.totalLiquidity))}</span></div>
          <div class="meta-box"><span class="meta-label">Real Market Action</span><span class="meta-value">View on Polymarket</span></div>
          <div class="meta-box"><span class="meta-label">Preview Safety</span><span class="meta-value">Preview YES/NO stays on this site</span></div>
        </div>
      </article>
    </div>

    <div class="market-grid event-detail-controls-grid" style="margin-top: 18px;">
      <article class="market-card event-detail-controls-card">
        <div class="event-detail-controls">
          <div>
            <p class="market-small">Compare related markets</p>
            <h3>Related Markets</h3>
            <p class="alert-time">Sort the event family, compare outcomes, and use View on Polymarket for the real market action.</p>
          </div>
          <label class="event-detail-sort-label">
            <span class="meta-label">Sort</span>
            <select id="eventDetailSortSelect">
              ${Object.entries(EVENT_DETAIL_SORTS)
                .map(([value, label]) => `<option value="${safeAttr(value)}" ${currentEventSort === value ? "selected" : ""}>${safeText(label)}</option>`)
                .join("")}
            </select>
          </label>
        </div>
      </article>
    </div>

    <div id="eventDetailMarketList" class="market-grid event-market-grid" style="margin-top: 18px;">
      ${sortedMarkets.map((market) => renderEventMarketCard(market, "event-detail")).join("")}
    </div>
  `;

  bindEventDetailControls();
  bindTradeActionButtons();

  if (options.updateUrl) {
    setEventUrlParam(summary.eventSlug || eventSlug);
  }

  if (options.scroll !== false) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function clearEventDetailView(options = {}) {
  currentEventSlug = "";
  const section = document.getElementById("eventDetailView");
  if (section) {
    section.classList.add("event-detail-hidden");
    section.innerHTML = "";
  }

  if (options.updateUrl !== false) {
    setEventUrlParam("", { replace: true });
  }

  if (options.scroll !== false) {
    document.getElementById("homepageStrategyLayer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function bindEventDetailControls() {
  const backBtn = document.getElementById("eventDetailBackBtn");
  const sortSelect = document.getElementById("eventDetailSortSelect");

  if (backBtn) backBtn.onclick = () => clearEventDetailView({ updateUrl: true });
  if (sortSelect) {
    sortSelect.onchange = () => {
      currentEventSort = sortSelect.value || "volume";
      renderEventDetailView(currentEventSlug, { updateUrl: false, scroll: false });
    };
  }
}

function bindEventOpenButtons() {
  document.querySelectorAll(".event-detail-open-btn").forEach((button) => {
    button.onclick = () => {
      const eventSlug = button.dataset.eventSlug || "";
      renderEventDetailView(eventSlug, { updateUrl: true, scroll: true });
    };
  });
}

function renderRequestedEventFromUrl(options = {}) {
  const requestedEventSlug = getRequestedEventSlug();
  if (!requestedEventSlug) {
    if (currentEventSlug) clearEventDetailView({ updateUrl: false, scroll: false });
    return;
  }

  renderEventDetailView(requestedEventSlug, {
    updateUrl: false,
    scroll: options.scroll !== false,
  });
}

function renderMoverCard(market, sourceSection = "movers") {
  const priceChange = getFiniteNumber(market.priceChange);
  const percentChange = getFiniteNumber(market.percentChange);
  const hasChange = priceChange !== null || percentChange !== null;
  const changeDirection = priceChange ?? percentChange ?? 0;
  const changeClass = !hasChange ? "" : changeDirection >= 0 ? "positive" : "negative";
  const trackingSource = normalizeOutboundSourceSection(sourceSection);
  const publicCategory = getPublicCategoryLabel(market);
  const eventGroup = getMarketEventGroup(market);
  const heatBadges = getMarketHeatBadges(market);

  return `
    <article class="market-card">
      <div class="market-context-row">
        <span>${safeText(publicCategory)}</span>
        ${eventGroup ? `<span>${safeText(eventGroup)}</span>` : ""}
      </div>
      <h3>${safeText(market.question)}</h3>

      ${renderHeatBadges(heatBadges)}
      ${renderMovementVisual(market)}

      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Current Price</span><span class="meta-value">${safeText(formatProbability(market.yesPriceLive))}</span></div>
        <div class="meta-box"><span class="meta-label">Recent Price</span><span class="meta-value">${safeText(formatProbability(market.pastPrice))}</span></div>
        <div class="meta-box"><span class="meta-label">Price Change</span><span class="meta-value ${changeClass}">${safeText(formatChangeAsProbability(priceChange))}</span></div>
        <div class="meta-box"><span class="meta-label">Percent Change</span><span class="meta-value ${changeClass}">${safeText(formatPercentChange(percentChange))}</span></div>
        <div class="meta-box"><span class="meta-label">Category</span><span class="meta-value">${safeText(publicCategory)}</span></div>
        ${eventGroup ? `<div class="meta-box"><span class="meta-label">Event / group</span><span class="meta-value">${safeText(eventGroup)}</span></div>` : ""}
        <div class="meta-box"><span class="meta-label">Why it matters</span><span class="meta-value">${safeText(getMarketDisplayReason(market))}</span></div>
      </div>

      <div class="market-footer">
        <span class="market-small">24h Vol: ${safeText(formatMoney(market.volume24hr, "Volume unavailable"))}</span>
        <a
          class="market-link market-link-primary"
          href="${safeUrl(market.url)}"
          target="_blank"
          rel="noopener noreferrer"
          data-outbound-click="polymarket"
          data-market-id="${safeAttr(getMarketTrackingId(market))}"
          data-market-slug="${safeAttr(market.slug)}"
          data-market-question="${safeAttr(market.question)}"
          data-market-url="${safeAttr(market.url)}"
          data-source-section="${safeAttr(trackingSource)}"
          data-cta="view-on-polymarket"
        >View on Polymarket</a>
      </div>

      <div class="market-footer" style="margin-top: 12px;">
        ${renderMarketPageLink(market)}
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY YES">Preview YES</button>
        <button class="trade-action-btn secondary-trade-btn" data-market-id="${safeAttr(market.id)}" data-side="BUY NO">Preview NO</button>
        ${renderWatchlistButton(market, sourceSection)}
      </div>
    </article>
  `;
}

function applyHotFilters() {
  renderDiscoverPrimaryView();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function postJsonDetailed(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Server returned a non-JSON response");
  }

  return {
    httpOk: res.ok,
    data,
  };
}

async function handleBrowserWalletConnect() {
  try {
    if (!hasBrowserWalletProvider()) {
      throw new Error("No browser wallet provider detected");
    }

    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    const walletAddress = Array.isArray(accounts) ? String(accounts[0] || "").trim() : "";

    if (!walletAddress) {
      throw new Error("No wallet address was returned by the provider");
    }

    await syncAppAccountFromWalletAddress(walletAddress, "BROWSER");
  } catch (err) {
    alert(err.message || "Failed to connect browser wallet");
  }
}

async function handleConnectAccount() {
  try {
    const walletAddress = document.getElementById("connectWalletAddress")?.value?.trim();
    const walletType = document.getElementById("connectWalletType")?.value || "EOA";
    const proxyWalletAddress =
      document.getElementById("connectProxyWallet")?.value?.trim() || "";
    const signatureType = Number(document.getElementById("connectSignatureType")?.value || 0);
    const funderAddress =
      document.getElementById("connectFunderAddress")?.value?.trim() || walletAddress;

    if (!walletAddress) throw new Error("Wallet address is required");

    await postJson("/api/account/connect", {
      walletAddress,
      walletType,
      proxyWalletAddress,
      signatureType,
      funderAddress,
    });

    walletConnectionSource = "MANUAL";
    currentClientSignedOrder = null;
    currentLivePreparation = null;
    resetUserAuthDraft();
    renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);
    await loadAccountState();
  } catch (err) {
    alert(err.message || "Failed to connect account");
  }
}

async function handleDisconnectAccount() {
  try {
    await clearAppWalletConnection();
  } catch (err) {
    alert(err.message || "Failed to clear wallet connection");
  }
}

async function handleLiveModeToggle(enabled) {
  try {
    await postJson("/api/account/live-mode", { enabled });

    if (!enabled) {
      currentLivePreparation = null;
      currentClientSignedOrder = null;
      renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);
    }

    await loadAccountState();
    renderTradeTicketPanel();
  } catch (err) {
    alert(err.message || "Failed to update live mode");
    await loadAccountState();
  }
}

async function handleManualOpenPosition() {
  try {
    const marketId = document.getElementById("manualMarketId")?.value?.trim();
    const actionSignal = document.getElementById("manualActionSignal")?.value;
    const positionSizeDollars = Number(document.getElementById("manualPositionSize")?.value || 0);

    if (!marketId || !actionSignal || !positionSizeDollars) {
      throw new Error("Fill in market ID, signal side, and position size");
    }

    await postJson("/api/paper-portfolio/open", {
      marketId,
      actionSignal,
      positionSizeDollars,
    });
    await loadPaperPortfolio();
  } catch (err) {
    alert(err.message || "Failed to open position");
  }
}

async function handleManualClosePosition(positionId) {
  try {
    await postJson("/api/paper-portfolio/close", { positionId, reason: "Manual Close" });
    await loadPaperPortfolio();
  } catch (err) {
    alert(err.message || "Failed to close position");
  }
}

async function handleResetPaperPortfolio() {
  try {
    const startingBankroll = Number(
      document.getElementById("resetStartingBankroll")?.value || 1000
    );
    const defaultPositionSize = Number(
      document.getElementById("resetDefaultPositionSize")?.value || 50
    );

    await postJson("/api/paper-portfolio/reset", { startingBankroll, defaultPositionSize });
    await loadPaperPortfolio();
  } catch (err) {
    alert(err.message || "Failed to reset portfolio");
  }
}

function getTradePreviewCard() {
  const panel = document.getElementById("tradeTicketPanel");
  return panel?.closest?.(".market-card") || panel;
}

function focusTradePreviewPanel() {
  const target = getTradePreviewCard();
  if (!target) return;

  target.classList.remove("trade-preview-highlight");
  target.scrollIntoView({ behavior: "smooth", block: "center" });

  window.setTimeout(() => {
    target.classList.add("trade-preview-highlight");
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }, 250);

  window.setTimeout(() => {
    target.classList.remove("trade-preview-highlight");
  }, 1850);
}

async function handleQuoteTrade(marketId, side, options = {}) {
  try {
    const sizeDollars = Number(document.getElementById("tradeTicketSize")?.value || 50) || 50;
    const mode = getCurrentTradeMode();

    const data = await postJson("/api/trade/quote", {
      marketId,
      side,
      sizeDollars,
      mode,
    });

    currentTradeTicket = data.quote;
    currentLivePreparation = null;
    currentClientSignedOrder = null;
    renderTradeTicketPanel();
    renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);

    if (options.focusPreview) {
      if (options.closeDrawer) closeMarketDetailDrawer();
      setTopLevelView("trade");
      focusTradePreviewPanel();
    }
  } catch (err) {
    alert(err.message || "Failed to quote trade");
  }
}

async function handleExecutePaperTrade() {
  try {
    if (!currentTradeTicket) throw new Error("No trade ticket selected");

    await postJson("/api/trade/execute", {
      marketId: currentTradeTicket.marketId,
      side: currentTradeTicket.side,
      sizeDollars: currentTradeTicket.sizeDollars,
      mode: "PAPER",
    });

    await loadPaperPortfolio();
    renderTradeExecutionResult(`<p class="loading">Paper trade executed successfully.</p>`);
    setTopLevelView("portfolio");
  } catch (err) {
    alert(err.message || "Failed to execute paper trade");
  }
}

async function handlePrepareLiveTrade() {
  try {
    if (!currentTradeTicket) throw new Error("No trade ticket selected");

    const mode = getCurrentTradeMode();
    const liveBlocked = mode === "LIVE" && !(accountStateCache?.canEnableLiveMode);

    if (liveBlocked) {
      throw new Error("Live requirements are not met");
    }

    const data = await postJson("/api/trade/prepare", {
      marketId: currentTradeTicket.marketId,
      side: currentTradeTicket.side,
      sizeDollars: currentTradeTicket.sizeDollars,
    });

    currentLivePreparation = data.preparation;
    currentClientSignedOrder = null;
    clearUserAuthInlineStatus();
    renderTradeExecutionResult(renderLivePreparation(data.preparation));
    bindLiveHandoffControls();
    setTopLevelView("trade");
  } catch (err) {
    alert(err.message || "Failed to prepare live trade");
  }
}

async function handleSignPreparedOrder() {
  try {
    captureUserAuthDraftFromUi();

    if (!currentLivePreparation?.signedOrderHandoff?.signableOrder) {
      throw new Error("Prepare a live trade first");
    }

    const signedOrder = await signPreparedOrderClientSide();
    currentClientSignedOrder = signedOrder;

    renderTradeExecutionResult(renderLivePreparation(currentLivePreparation));
    bindLiveHandoffControls();
    setTopLevelView("trade");
  } catch (err) {
    alert(err.message || "Failed to sign prepared order");
  }
}

async function handleApplyUserAuthJsonToFields() {
  captureUserAuthDraftFromUi();

  try {
    if (!currentUserAuthDraft.rawJson) {
      throw new Error("Paste user auth JSON first");
    }

    const parsed = parseJsonText(currentUserAuthDraft.rawJson, "User auth JSON");
    applyUserAuthObjectToDraft(parsed);
    currentUserAuthDraft.rawJson = "";

    restoreUserAuthDraftToUi();
    setUserAuthInlineStatus(
      "success",
      "Auth JSON applied to fields for this browser session. Raw JSON input cleared."
    );
  } catch (err) {
    setUserAuthInlineStatus("error", err.message || "Failed to apply auth JSON");
  }
}

function handleClearUserAuthFields() {
  clearUserAuthFieldsInDraft();
  restoreUserAuthDraftToUi();
  setUserAuthInlineStatus("success", "Auth fields cleared for this browser session.");
}

async function handleSubmitSignedOrderHandoff() {
  try {
    if (!currentTradeTicket) throw new Error("No trade ticket selected");
    if (!currentLivePreparation?.signedOrderHandoff) {
      throw new Error("Prepare the live handoff first");
    }

    const readiness = currentLivePreparation.signedOrderHandoff.realSubmitReadiness || {};
    if (!readiness.readyForGuardedSubmit) {
      throw new Error("Guarded real submit is not available in the current safety state");
    }

    const signedOrderRaw = document.getElementById("signedOrderInput")?.value?.trim();
    const confirmText = document.getElementById("realSubmitConfirmInput")?.value?.trim() || "";

    if (!signedOrderRaw) throw new Error("Paste signed order JSON first");
    if (!confirmText) throw new Error("Type the confirmation text first");

    const signedOrder = parseJsonText(signedOrderRaw, "Signed order");
    const userAuth = readResolvedUserAuthFromUi();

    const response = await postJsonDetailed("/api/trade/submit-signed", {
      marketId: currentTradeTicket.marketId,
      side: currentTradeTicket.side,
      sizeDollars: currentTradeTicket.sizeDollars,
      signedOrder,
      userAuth,
      confirmText,
      orderType: currentLivePreparation.signedOrderHandoff.orderType || "GTC",
      postOnly: !!currentLivePreparation.signedOrderHandoff.postOnly,
    });

    if (!response.httpOk || response.data?.ok === false) {
      renderTradeExecutionResult(renderSignedOrderSubmitResult(response.data, true));
      setTopLevelView("trade");
      return;
    }

    renderTradeExecutionResult(renderSignedOrderSubmitResult(response.data, false));
    setTopLevelView("trade");
  } catch (err) {
    alert(err.message || "Failed to submit signed-order handoff");
  }
}

function renderTradeTicketPanel() {
  const ticketContainer = document.getElementById("tradeTicketPanel");
  if (!ticketContainer) return;

  if (!currentTradeTicket) {
    ticketContainer.innerHTML = `<p class="empty">No trade ticket selected yet.</p>`;
    return;
  }

  ticketContainer.innerHTML = renderTradeTicket(currentTradeTicket);

  const execBtn = document.getElementById("executePaperTradeBtn");
  const prepBtn = document.getElementById("prepareLiveTradeBtn");

  if (execBtn) execBtn.onclick = handleExecutePaperTrade;
  if (prepBtn && !prepBtn.disabled) prepBtn.onclick = handlePrepareLiveTrade;
}

function renderTradeExecutionResult(html) {
  const container = document.getElementById("tradeExecutionPanel");
  if (!container) return;
  container.innerHTML = html;
}

function bindTradeActionButtons() {
  document.querySelectorAll(".trade-action-btn").forEach((btn) => {
    btn.onclick = async () => {
      await handleQuoteTrade(btn.dataset.marketId, btn.dataset.side, {
        focusPreview: true,
        closeDrawer: Boolean(btn.closest("#marketDetailDrawer")),
      });
    };
  });
}

function bindDynamicPortfolioControls() {
  const openBtn = document.getElementById("openManualPositionBtn");
  const resetBtn = document.getElementById("resetPaperPortfolioBtn");

  if (openBtn) openBtn.onclick = handleManualOpenPosition;
  if (resetBtn) resetBtn.onclick = handleResetPaperPortfolio;

  document.querySelectorAll(".close-position-btn").forEach((btn) => {
    btn.onclick = () => handleManualClosePosition(btn.dataset.positionId);
  });
}

function bindLiveHandoffControls() {
  const signBtn = document.getElementById("signPreparedOrderBtn");
  const submitBtn = document.getElementById("submitSignedOrderBtn");
  const signedOrderInput = document.getElementById("signedOrderInput");
  const fillAddressBtn = document.getElementById("fillUserAuthAddressBtn");
  const clearFieldsBtn = document.getElementById("clearUserAuthFieldsBtn");
  const applyAuthJsonBtn = document.getElementById("applyUserAuthJsonBtn");

  restoreUserAuthDraftToUi();
  updateUserAuthInlineStatusUi();

  [
    "userAuthAddressInput",
    "userAuthApiKeyInput",
    "userAuthSecretInput",
    "userAuthPassphraseInput",
    "userAuthJsonInput",
  ].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("input", () => {
        captureUserAuthDraftFromUi();
        clearUserAuthInlineStatus();
      });
    }
  });

  if (fillAddressBtn) fillAddressBtn.onclick = fillUserAuthAddressFromConnectedWallet;
  if (clearFieldsBtn) clearFieldsBtn.onclick = handleClearUserAuthFields;
  if (applyAuthJsonBtn) applyAuthJsonBtn.onclick = handleApplyUserAuthJsonToFields;
  if (signBtn && !signBtn.disabled) signBtn.onclick = handleSignPreparedOrder;
  if (submitBtn && !submitBtn.disabled) submitBtn.onclick = handleSubmitSignedOrderHandoff;

  if (signedOrderInput && currentClientSignedOrder) {
    signedOrderInput.value = stringifyJsonForUi(currentClientSignedOrder);
  }
}

function bindAccountControls() {
  const connectBtn = document.getElementById("connectAccountBtn");
  const connectBrowserBtn = document.getElementById("browserWalletConnectBtn");
  const disconnectBtn = document.getElementById("disconnectAccountBtn");
  const liveToggle = document.getElementById("liveModeToggle");
  const tradeModeSelect = document.getElementById("tradeModeSelect");

  if (connectBtn) connectBtn.onclick = handleConnectAccount;
  if (connectBrowserBtn && !connectBrowserBtn.disabled) {
    connectBrowserBtn.onclick = handleBrowserWalletConnect;
  }
  if (disconnectBtn) disconnectBtn.onclick = handleDisconnectAccount;
  if (liveToggle) liveToggle.onchange = (e) => handleLiveModeToggle(e.target.checked);
  if (tradeModeSelect) tradeModeSelect.onchange = () => renderTradeTicketPanel();
}

function getAlertsRenderTargets() {
  const targets = [];
  const compactTarget = document.getElementById("extraDiscoveryAlerts");
  const legacyTarget = document.getElementById("alertsPanel");

  if (compactTarget) targets.push(compactTarget);
  if (legacyTarget && legacyTarget !== compactTarget) targets.push(legacyTarget);

  return targets;
}

function setAlertsRenderTargets(html) {
  const targets = getAlertsRenderTargets();
  targets.forEach((target) => {
    target.innerHTML = html;
  });
}

async function loadAlerts() {
  const targets = getAlertsRenderTargets();
  if (!targets.length) return;

  setAlertsRenderTargets(`<p class="loading">Loading alerts...</p>`);

  try {
    const res = await fetch("/api/alerts");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.alerts)) throw new Error("Invalid alerts response");

    if (data.alerts.length === 0) {
      setAlertsRenderTargets(`<p class="empty">No priority alerts right now.</p>`);
      return;
    }

    setAlertsRenderTargets(data.alerts.map(renderAlertItem).join(""));
  } catch (err) {
    console.error("Alerts load error:", err);
    setAlertsRenderTargets(`<p class="empty">Failed to load alerts.</p>`);
  }
}

async function loadSignalLog() {
  const container = document.getElementById("signalLogPanel");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading tracked signals...</p>`;

  try {
    const res = await fetch("/api/signal-log");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.signals)) {
      throw new Error("Invalid signal log response");
    }

    if (data.signals.length === 0) {
      container.innerHTML = `<p class="empty">No tracked signals yet.</p>`;
      return;
    }

    container.innerHTML = data.signals.slice(0, 20).map(renderSignalLogItem).join("");
  } catch (err) {
    console.error("Signal log load error:", err);
    container.innerHTML = `<p class="empty">Failed to load tracked signals.</p>`;
  }
}

async function loadPerformanceStats() {
  const container = document.getElementById("performanceStatsPanel");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading performance stats...</p>`;

  try {
    const res = await fetch("/api/performance-stats");
    const data = await res.json();

    if (!data.ok || !data.stats) throw new Error("Invalid performance stats response");

    container.innerHTML = renderPerformanceStats(data.stats);
  } catch (err) {
    console.error("Performance stats load error:", err);
    container.innerHTML = `<p class="empty">Failed to load performance stats.</p>`;
  }
}

async function loadAccountState() {
  const stateContainer = document.getElementById("accountStatePanel");
  const controlsContainer = document.getElementById("accountControlsPanel");
  if (!stateContainer || !controlsContainer) return;

  stateContainer.innerHTML = `<p class="loading">Loading account state...</p>`;
  controlsContainer.innerHTML = `<p class="loading">Loading wallet connection...</p>`;

  try {
    const res = await fetch("/api/account-state");
    const data = await res.json();

    if (!data.ok || !data.account) throw new Error("Invalid account state response");

    accountStateCache = data.account;
    stateContainer.innerHTML = renderAccountPanel(data.account);
    controlsContainer.innerHTML = renderAccountControls(data.account);
    bindAccountControls();
  } catch (err) {
    console.error("Account state load error:", err);
    stateContainer.innerHTML = `<p class="empty">Failed to load account state.</p>`;
    controlsContainer.innerHTML = `<p class="empty">Failed to load wallet connection.</p>`;
  }
}

async function loadPaperPortfolio() {
  const statsContainer = document.getElementById("paperPortfolioStatsPanel");
  const controlsContainer = document.getElementById("paperPortfolioControlsPanel");
  const openContainer = document.getElementById("openPositionsPanel");
  const closedContainer = document.getElementById("closedPositionsPanel");

  if (!statsContainer || !controlsContainer || !openContainer || !closedContainer) return;

  statsContainer.innerHTML = `<p class="loading">Loading paper portfolio...</p>`;
  controlsContainer.innerHTML = `<p class="loading">Loading controls...</p>`;
  openContainer.innerHTML = `<p class="loading">Loading open positions...</p>`;
  closedContainer.innerHTML = `<p class="loading">Loading closed positions...</p>`;

  try {
    const res = await fetch("/api/paper-portfolio");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.positions) || !data.stats) {
      throw new Error("Invalid paper portfolio response");
    }

    const openPositions = data.positions.filter((p) => p.status === "OPEN");
    const closedPositions = data.positions.filter((p) => p.status === "CLOSED");

    statsContainer.innerHTML = renderPaperPortfolioStats(data.stats);
    controlsContainer.innerHTML = renderManualTradeControls() + renderResetControls();

    openContainer.innerHTML = openPositions.length
      ? openPositions.map(renderPaperPositionItem).join("")
      : `<p class="empty">No open paper positions.</p>`;

    closedContainer.innerHTML = closedPositions.length
      ? closedPositions.slice(0, 20).map(renderPaperPositionItem).join("")
      : `<p class="empty">No closed paper positions yet.</p>`;

    bindDynamicPortfolioControls();
  } catch (err) {
    console.error("Paper portfolio load error:", err);
    statsContainer.innerHTML = `<p class="empty">Failed to load paper portfolio.</p>`;
    controlsContainer.innerHTML = `<p class="empty">Failed to load controls.</p>`;
    openContainer.innerHTML = `<p class="empty">Failed to load open positions.</p>`;
    closedContainer.innerHTML = `<p class="empty">Failed to load closed positions.</p>`;
  }
}

async function loadTopOpportunities() {
  renderDiscoverPrimaryView();
}

async function loadHotMarkets() {
  renderDiscoverPrimaryView();
}

async function loadBiggestMovers() {
  if (currentDiscoverView === "movers") {
    setHomepageDiscoveryLoadingState();
  }

  try {
    const res = await fetch("/api/biggestMovers");
    const data = await res.json();
    const markets = Array.isArray(data) ? data : data.markets;
    const responseOk = Array.isArray(data) ? res.ok : data.ok;

    if (!responseOk || !Array.isArray(markets)) {
      throw new Error("Invalid biggest movers response");
    }

    biggestMoversCache = markets;
    if (!Array.isArray(data) && data.lastRefreshedAt) {
      lastHomepageDiscoveryRefreshAt = data.lastRefreshedAt;
    }
    renderDiscoverPrimaryView();
    if (currentEventSlug) {
      renderEventDetailView(currentEventSlug, { updateUrl: false, scroll: false });
    }
  } catch (err) {
    console.error("Biggest movers load error:", err);
    biggestMoversCache = [];
    if (currentDiscoverView === "movers") {
      const resultsEl = document.getElementById("discoverPrimaryResults");
      if (resultsEl) {
        resultsEl.innerHTML = `<p class="empty">Failed to load biggest movers.</p>`;
      }
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const refreshAlerts = document.getElementById("refreshAlerts");
  const refreshOpp = document.getElementById("refreshOpportunities");
  const refreshHot = document.getElementById("refreshHot");
  const refreshMovers = document.getElementById("refreshMovers");
  const refreshSignals = document.getElementById("refreshSignals");
  const refreshPerformance = document.getElementById("refreshPerformance");
  const refreshPaperPortfolio = document.getElementById("refreshPaperPortfolio");
  const refreshAccount = document.getElementById("refreshAccount");
  const applyBtn = document.getElementById("applyFilters");

  await loadPublicConfig();
  bindAlertsWaitlistForm();
  bindBetaFeedbackForm();
  bindOutboundClickTracking();
  bindWatchlistInterestTracking();
  bindMarketPageLinks();
  bindPublicTopDiscoveryTabs();
  bindMarketDetailGlobalControls();
  ensureHomepageStrategyLayer();
  ensureTopLevelTabs();
  hideLegacyDiscoverSections();
  setTopLevelView("discover");

  if (refreshAlerts) refreshAlerts.addEventListener("click", loadAlerts);
  if (refreshOpp) refreshOpp.addEventListener("click", () => loadHomepageDiscoveryData(true));
  if (refreshHot) refreshHot.addEventListener("click", () => loadHomepageDiscoveryData(true));
  if (refreshMovers) refreshMovers.addEventListener("click", loadBiggestMovers);
  if (refreshSignals) refreshSignals.addEventListener("click", loadSignalLog);
  if (refreshPerformance) refreshPerformance.addEventListener("click", loadPerformanceStats);
  if (refreshPaperPortfolio) refreshPaperPortfolio.addEventListener("click", loadPaperPortfolio);
  if (refreshAccount) refreshAccount.addEventListener("click", loadAccountState);
  if (applyBtn) applyBtn.addEventListener("click", applyHotFilters);

  setupBrowserWalletEventSync();

  window.addEventListener("popstate", () => {
    const renderedMarket = renderRequestedMarketFromUrl({ scroll: true });
    if (!renderedMarket) renderRequestedEventFromUrl({ scroll: true });
  });

  await beginCleanPublicLoad();

  renderTradeTicketPanel();
  if (PBP_PUBLIC_BETA_DEBUG_MODE) {
    renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);
  }
  applyTopLevelView();

  await loadLatestAlertSignals();
  await loadAlerts();
  await loadHomepageDiscoveryData(true);
  await loadBiggestMovers();
  const renderedMarket = renderRequestedMarketFromUrl({ scroll: !!getRequestedMarketId() });
  if (!renderedMarket) renderRequestedEventFromUrl({ scroll: !!getRequestedEventSlug() });
  if (PBP_PUBLIC_BETA_DEBUG_MODE) {
    await loadAccountState();
    await loadPerformanceStats();
    await loadPaperPortfolio();
    await loadSignalLog();
  }

  setTopLevelView("discover");

  setInterval(loadLatestAlertSignals, 60000);
  setInterval(loadAlerts, 60000);
  setInterval(() => loadHomepageDiscoveryData(true), 60000);
  setInterval(loadBiggestMovers, 60000);
  if (PBP_PUBLIC_BETA_DEBUG_MODE) {
    setInterval(loadAccountState, 60000);
    setInterval(loadPerformanceStats, 60000);
    setInterval(loadPaperPortfolio, 60000);
    setInterval(loadSignalLog, 60000);
  }
});
