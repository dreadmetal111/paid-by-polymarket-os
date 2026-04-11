import express from "express";
import cors from "cors";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const RELAYER =
  process.env.POLYMARKET_RELAYER_BASE_URL || "https://relayer-v2.polymarket.com";

const DEFAULT_ORDER_TYPE = "GTC";
const DEFAULT_POST_ONLY = false;

// ===============================
// MEMORY + STORAGE
// ===============================

let signalLog = [];
let signalLogTimestamps = new Map();
let paperPortfolio = [];
let priceHistory = new Map();

let paperBankroll = {
  startingBankroll: 1000,
  cash: 1000,
  defaultPositionSize: 50,
};

let accountState = {
  isConnected: false,
  walletAddress: "",
  walletType: "NONE", // NONE | EOA | POLYMARKET_PROXY
  proxyWalletAddress: "",
  signatureType: 0,
  funderAddress: "",
  liveModeEnabled: false,
  lastUpdated: null,
};

const SIGNAL_LOG_COOLDOWN_MS = 30 * 60 * 1000;
const PRICE_HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000;
const MOVER_LOOKBACK_MS = 30 * 60 * 1000;

// ===============================
// HELPERS
// ===============================

function safeJsonParse(value, fallback = []) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value ?? fallback;
  } catch {
    return fallback;
  }
}

function tryParseJsonObject(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed;
}

function safeJsonStringify(value) {
  return JSON.stringify(value ?? {});
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, x) => sum + x, 0) / arr.length;
}

function round4(value) {
  return Number(Number(value).toFixed(4));
}

function nowIso() {
  return new Date().toISOString();
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function normalizeAddress(value) {
  return String(value || "").trim();
}

function sanitizeBase64(secret) {
  return String(secret || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");
}

function toUrlSafeBase64(base64Value) {
  return String(base64Value).replace(/\+/g, "-").replace(/\//g, "_");
}

function buildPolyHmacSignature(secret, timestamp, method, requestPath, body = "") {
  const message = `${timestamp}${method.toUpperCase()}${requestPath}${body || ""}`;
  const key = Buffer.from(sanitizeBase64(secret), "base64");
  const signature = crypto.createHmac("sha256", key).update(message).digest("base64");
  return toUrlSafeBase64(signature);
}

function buildUserL2Headers(userAuth, method, requestPath, bodyString) {
  const address = normalizeAddress(userAuth.address);
  const apiKey = String(userAuth.apiKey || "").trim();
  const secret = String(userAuth.secret || "").trim();
  const passphrase = String(userAuth.passphrase || "").trim();

  if (!address || !apiKey || !secret || !passphrase) {
    throw new Error("userAuth must include address, apiKey, secret, and passphrase");
  }

  const timestamp = nowTs();
  const signature = buildPolyHmacSignature(
    secret,
    timestamp,
    method,
    requestPath,
    bodyString
  );

  return {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: String(timestamp),
    POLY_API_KEY: apiKey,
    POLY_PASSPHRASE: passphrase,
  };
}

function getBuilderEnvStatus() {
  const apiKey = String(process.env.POLY_BUILDER_API_KEY || "").trim();
  const secret = String(process.env.POLY_BUILDER_SECRET || "").trim();
  const passphrase = String(process.env.POLY_BUILDER_PASSPHRASE || "").trim();
  const liveRoutingEnabled =
    String(process.env.PBP_ENABLE_BUILDER_LIVE_ROUTING || "false").toLowerCase() === "true";
  const realLiveSubmitEnabled =
    String(process.env.PBP_ENABLE_REAL_LIVE_SUBMIT || "false").toLowerCase() === "true";

  const hasApiKey = !!apiKey;
  const hasSecret = !!secret;
  const hasPassphrase = !!passphrase;
  const configured = hasApiKey && hasSecret && hasPassphrase;
  const relayerReady = configured && liveRoutingEnabled;

  return {
    configured,
    hasApiKey,
    hasSecret,
    hasPassphrase,
    liveRoutingEnabled,
    relayerReady,
    realLiveSubmitEnabled,
    relayerBaseUrl: RELAYER,
    usesServerSideSigning: true,
  };
}

function getBuilderConfig() {
  const status = getBuilderEnvStatus();

  if (!status.configured) {
    return null;
  }

  return new BuilderConfig({
    localBuilderCreds: {
      key: process.env.POLY_BUILDER_API_KEY,
      secret: process.env.POLY_BUILDER_SECRET,
      passphrase: process.env.POLY_BUILDER_PASSPHRASE,
    },
  });
}

async function buildBuilderHeaders(method, requestPath, bodyString) {
  const builderConfig = getBuilderConfig();
  if (!builderConfig) {
    throw new Error("Builder credentials are not configured on the server");
  }

  return builderConfig.generateBuilderHeaders(
    method.toUpperCase(),
    requestPath,
    bodyString
  );
}

function summarizeSignedOrder(signedOrder) {
  if (!signedOrder || typeof signedOrder !== "object") return null;

  const signature =
    signedOrder.signature ||
    signedOrder.sig ||
    signedOrder.orderSignature ||
    null;

  return {
    hasSignature: !!signature,
    signatureLength: signature ? String(signature).length : 0,
    keys: Object.keys(signedOrder),
  };
}

function buildOrderSubmissionBody(
  signedOrder,
  orderType = DEFAULT_ORDER_TYPE,
  postOnly = DEFAULT_POST_ONLY
) {
  return {
    order: signedOrder,
    orderType,
    postOnly: !!postOnly,
  };
}

function buildDisconnectedAccountState() {
  return {
    isConnected: false,
    walletAddress: "",
    walletType: "NONE",
    proxyWalletAddress: "",
    signatureType: 0,
    funderAddress: "",
    liveModeEnabled: false,
    lastUpdated: nowIso(),
  };
}

function clearPaperPortfolioState(startingBankroll = 1000, defaultPositionSize = 50) {
  paperPortfolio = [];
  paperBankroll = {
    startingBankroll: round4(startingBankroll),
    cash: round4(startingBankroll),
    defaultPositionSize: round4(defaultPositionSize),
  };
}

function resetPublicDemoState() {
  accountState = buildDisconnectedAccountState();
  clearPaperPortfolioState(1000, 50);

  return {
    account: getAccountReadiness(),
    stats: getPaperPortfolioStats(),
  };
}

// ===============================
// SCORING SYSTEM
// ===============================

function getHotScore(m) {
  if (m.yesPriceLive === null) return 0;

  const balancePenalty = Math.abs(0.5 - m.yesPriceLive);

  return (
    m.volume24hr * 0.55 +
    m.liquidity * 0.3 +
    m.volume * 0.15 -
    balancePenalty * 100000
  );
}

function getConfidenceScore(m) {
  if (m.yesPriceLive === null) return 0;

  const balanceScore = (1 - Math.abs(0.5 - m.yesPriceLive) / 0.5) * 30;
  const liquidityScore = Math.min(m.liquidity / 50000, 1) * 25;
  const volume24hrScore = Math.min(m.volume24hr / 50000, 1) * 25;
  const hotScoreBonus = Math.min(m.hotScore / 1000000, 1) * 20;

  let score = balanceScore + liquidityScore + volume24hrScore + hotScoreBonus;

  if (m.yesPriceLive < 0.05 || m.yesPriceLive > 0.95) score -= 20;
  else if (m.yesPriceLive < 0.1 || m.yesPriceLive > 0.9) score -= 10;

  return Math.round(clamp(score, 0, 100));
}

// ===============================
// ACTION SIGNAL
// ===============================

function getActionSignal(m) {
  const price = m.yesPriceLive;
  const confidence = m.confidenceScore;
  const liquid = m.liquidity > 150000;
  const active = m.volume24hr > 25000;
  const balanced = price >= 0.38 && price <= 0.56;
  const elevated = price >= 0.68 && price <= 0.85;
  const extreme = price < 0.08 || price > 0.92;

  if (balanced && confidence >= 75 && liquid) {
    return {
      actionSignal: "BUY YES",
      actionReason: "Balanced probability with strong confidence and liquidity",
    };
  }

  if (elevated && confidence >= 68 && liquid && active) {
    return {
      actionSignal: "BUY NO",
      actionReason: "Elevated YES pricing with enough liquidity and activity",
    };
  }

  if (!extreme && confidence >= 60 && active) {
    return {
      actionSignal: "WATCH",
      actionReason: "Interesting setup, but edge is not strong enough yet",
    };
  }

  if (extreme) {
    return {
      actionSignal: "WATCH",
      actionReason: "Extreme pricing increases reversal/noise risk",
    };
  }

  return {
    actionSignal: "WATCH",
    actionReason: "No strong edge right now",
  };
}

// ===============================
// ACCOUNT / LIVE MODE
// ===============================

function getAccountReadiness() {
  const builderEnv = getBuilderEnvStatus();

  const hasWallet = !!accountState.walletAddress;
  const hasProxyIfNeeded =
    accountState.walletType !== "POLYMARKET_PROXY" || !!accountState.proxyWalletAddress;

  const canEnableLiveMode = hasWallet && hasProxyIfNeeded;
  const builderApiConfigured = builderEnv.configured;
  const relayerReady = builderEnv.relayerReady;

  const builderReady =
    canEnableLiveMode &&
    builderApiConfigured &&
    relayerReady;

  return {
    isConnected: accountState.isConnected,
    liveModeEnabled: accountState.liveModeEnabled,
    walletType: accountState.walletType,
    walletAddress: accountState.walletAddress,
    proxyWalletAddress: accountState.proxyWalletAddress,
    signatureType: accountState.signatureType,
    funderAddress: accountState.funderAddress,
    builderApiConfigured,
    relayerReady,
    canEnableLiveMode,
    builderReady,
    builderConfigSource: "SERVER_ENV",
    liveRoutingEnabled: builderEnv.liveRoutingEnabled,
    realLiveSubmitEnabled: builderEnv.realLiveSubmitEnabled,
    signedOrderHandoffEnabled: true,
    blockers: [
      !hasWallet ? "Missing wallet address" : null,
      !hasProxyIfNeeded ? "Missing proxy wallet address" : null,
      !builderEnv.hasApiKey ? "Builder API key missing on server" : null,
      !builderEnv.hasSecret ? "Builder secret missing on server" : null,
      !builderEnv.hasPassphrase ? "Builder passphrase missing on server" : null,
      builderEnv.configured && !builderEnv.liveRoutingEnabled
        ? "Builder live routing is disabled on the server"
        : null,
    ].filter(Boolean),
    lastUpdated: accountState.lastUpdated,
  };
}

function connectAccount({
  walletAddress,
  walletType = "EOA",
  proxyWalletAddress = "",
  signatureType = 0,
  funderAddress = "",
}) {
  accountState = {
    ...accountState,
    isConnected: true,
    walletAddress: normalizeAddress(walletAddress),
    walletType,
    proxyWalletAddress: normalizeAddress(proxyWalletAddress),
    signatureType: Number(signatureType || 0),
    funderAddress: normalizeAddress(funderAddress || walletAddress),
    lastUpdated: nowIso(),
  };

  const readiness = getAccountReadiness();

  if (!readiness.canEnableLiveMode) {
    accountState.liveModeEnabled = false;
  }

  return getAccountReadiness();
}

function disconnectAccount() {
  accountState = buildDisconnectedAccountState();
  return getAccountReadiness();
}

function updateLiveMode(enabled) {
  const readiness = getAccountReadiness();

  if (enabled && !readiness.canEnableLiveMode) {
    throw new Error("Account is not ready for live mode");
  }

  accountState.liveModeEnabled = !!enabled;
  accountState.lastUpdated = nowIso();

  return getAccountReadiness();
}

// Kept for frontend compatibility.
// Builder readiness comes from server env vars only.
function updateBuilderSettings() {
  accountState.lastUpdated = nowIso();
  return getAccountReadiness();
}

// ===============================
// SIGNAL PERFORMANCE TRACKING
// ===============================

function updateSignalPerformance(currentMarkets) {
  const marketMap = new Map(currentMarkets.map((m) => [m.id, m]));

  signalLog = signalLog.map((entry) => {
    const current = marketMap.get(entry.marketId);
    if (!current || current.yesPriceLive === null) return entry;

    const currentPrice = current.yesPriceLive;
    const entryPrice = entry.entryYesPrice;

    let performancePoints = currentPrice - entryPrice;

    if (entry.actionSignal === "BUY NO") {
      performancePoints = -performancePoints;
    }

    let status = entry.status || "ACTIVE";

    if (status === "ACTIVE") {
      if (performancePoints >= 0.05) status = "WIN";
      if (performancePoints <= -0.05) status = "LOSS";
    }

    return {
      ...entry,
      currentYesPrice: currentPrice,
      performancePoints: round4(performancePoints),
      status,
      updatedAt: nowIso(),
    };
  });
}

// ===============================
// PAPER PORTFOLIO
// ===============================

function calculatePositionPnlPoints(position, currentYesPrice) {
  let pnlPoints = currentYesPrice - position.entryYesPrice;
  if (position.actionSignal === "BUY NO") pnlPoints = -pnlPoints;
  return round4(pnlPoints);
}

function calculatePositionDollarPnl(position, pnlPoints) {
  const stake = position.positionSizeDollars || 0;
  return round4(stake * (pnlPoints / Math.max(position.entryYesPrice || 0.01, 0.01)));
}

function updatePaperPortfolio(currentMarkets) {
  const marketMap = new Map(currentMarkets.map((m) => [m.id, m]));

  paperPortfolio = paperPortfolio.map((position) => {
    const current = marketMap.get(position.marketId);
    if (!current || current.yesPriceLive === null) return position;

    const currentPrice = current.yesPriceLive;
    const pnlPoints = calculatePositionPnlPoints(position, currentPrice);
    const pnlDollars = calculatePositionDollarPnl(position, pnlPoints);

    let pnlStatus = "FLAT";
    if (pnlPoints > 0) pnlStatus = "GREEN";
    if (pnlPoints < 0) pnlStatus = "RED";

    let status = position.status;
    let closeReason = position.closeReason;
    let closedAt = position.closedAt;

    if (status === "OPEN") {
      if (pnlPoints >= 0.05) {
        status = "CLOSED";
        closeReason = "Take Profit (+5 pts)";
        closedAt = nowIso();
        paperBankroll.cash = round4(
          paperBankroll.cash + position.positionSizeDollars + pnlDollars
        );
      } else if (pnlPoints <= -0.05) {
        status = "CLOSED";
        closeReason = "Stop Loss (-5 pts)";
        closedAt = nowIso();
        paperBankroll.cash = round4(
          paperBankroll.cash + position.positionSizeDollars + pnlDollars
        );
      }
    }

    return {
      ...position,
      currentYesPrice: currentPrice,
      pnlPoints,
      pnlDollars,
      pnlStatus,
      status,
      closeReason,
      closedAt,
      updatedAt: nowIso(),
    };
  });
}

function manuallyOpenPaperPosition(market, actionSignal, positionSizeDollars) {
  if (actionSignal !== "BUY YES" && actionSignal !== "BUY NO") {
    throw new Error("Only BUY YES and BUY NO can open positions");
  }

  const existingOpen = paperPortfolio.find(
    (p) =>
      p.marketId === market.id &&
      p.actionSignal === actionSignal &&
      p.status === "OPEN"
  );

  if (existingOpen) {
    throw new Error("Open position already exists for this market and side");
  }

  if (positionSizeDollars <= 0) {
    throw new Error("Position size must be greater than 0");
  }

  if (paperBankroll.cash < positionSizeDollars) {
    throw new Error("Not enough paper cash available");
  }

  paperBankroll.cash = round4(paperBankroll.cash - positionSizeDollars);

  const position = {
    id: `${market.id}-${actionSignal}-${Date.now()}`,
    marketId: market.id,
    question: market.question,
    slug: market.slug,
    eventSlug: market.eventSlug,
    url: market.url,
    source: "MANUAL",
    actionSignal,
    actionReason: `Manual ${actionSignal} entry`,
    confidenceScore: market.confidenceScore,
    entryYesPrice: market.yesPriceLive,
    currentYesPrice: market.yesPriceLive,
    positionSizeDollars,
    pnlPoints: 0,
    pnlDollars: 0,
    pnlStatus: "FLAT",
    status: "OPEN",
    openedAt: nowIso(),
    closedAt: null,
    closeReason: null,
  };

  paperPortfolio.unshift(position);
  paperPortfolio = paperPortfolio.slice(0, 300);

  return position;
}

function manuallyClosePaperPosition(positionId, reason = "Manual Close") {
  const idx = paperPortfolio.findIndex((p) => p.id === positionId);
  if (idx === -1) throw new Error("Position not found");

  const position = paperPortfolio[idx];
  if (position.status !== "OPEN") throw new Error("Position is already closed");

  const closedPosition = {
    ...position,
    status: "CLOSED",
    closeReason: reason,
    closedAt: nowIso(),
    updatedAt: nowIso(),
  };

  paperBankroll.cash = round4(
    paperBankroll.cash + closedPosition.positionSizeDollars + (closedPosition.pnlDollars || 0)
  );

  paperPortfolio[idx] = closedPosition;
  return closedPosition;
}

function resetPaperPortfolio(startingBankroll = 1000, defaultPositionSize = 50) {
  clearPaperPortfolioState(startingBankroll, defaultPositionSize);
}

function getPaperPortfolioStats() {
  const open = paperPortfolio.filter((p) => p.status === "OPEN");
  const closed = paperPortfolio.filter((p) => p.status === "CLOSED");
  const closedWins = closed.filter((p) => p.pnlPoints > 0);
  const closedLosses = closed.filter((p) => p.pnlPoints < 0);

  const avgOpenPnl = round4(avg(open.map((p) => p.pnlPoints || 0)));
  const realizedPnl = round4(closed.reduce((sum, p) => sum + (p.pnlDollars || 0), 0));
  const unrealizedPnlDollars = round4(open.reduce((sum, p) => sum + (p.pnlDollars || 0), 0));

  const closedWinRate = closed.length
    ? Number((closedWins.length / closed.length).toFixed(4))
    : 0;

  const equity = round4(
    paperBankroll.cash +
      open.reduce(
        (sum, p) => sum + (p.positionSizeDollars || 0) + (p.pnlDollars || 0),
        0
      )
  );

  return {
    bankroll: {
      startingBankroll: paperBankroll.startingBankroll,
      cash: paperBankroll.cash,
      equity,
      defaultPositionSize: paperBankroll.defaultPositionSize,
    },
    totalPositions: paperPortfolio.length,
    openPositions: open.length,
    closedPositions: closed.length,
    closedWins: closedWins.length,
    closedLosses: closedLosses.length,
    closedWinRate,
    avgOpenPnl,
    realizedPnl,
    unrealizedPnlDollars,
  };
}

// ===============================
// EXECUTION-READY TRADE HELPERS
// ===============================

function getTradeSideDetails(market, side) {
  if (side !== "BUY YES" && side !== "BUY NO") {
    throw new Error("side must be BUY YES or BUY NO");
  }

  const yesPrice = market.yesPriceLive;
  const noPrice = yesPrice === null ? null : round4(1 - yesPrice);

  return {
    side,
    selectedPrice: side === "BUY YES" ? yesPrice : noPrice,
    yesPrice,
    noPrice,
  };
}

function buildTradeQuote(market, side, sizeDollars, mode = "PAPER") {
  const trade = getTradeSideDetails(market, side);
  const price = trade.selectedPrice;

  if (price === null || price <= 0) {
    throw new Error("Market price unavailable for quote");
  }

  const estimatedShares = round4(sizeDollars / price);
  const estimatedMaxLoss = round4(sizeDollars);
  const estimatedMaxPayout = round4(estimatedShares * 1);
  const estimatedProfitIfCorrect = round4(estimatedMaxPayout - sizeDollars);

  return {
    mode,
    marketId: market.id,
    question: market.question,
    url: market.url,
    side,
    sizeDollars: round4(sizeDollars),
    selectedPrice: price,
    yesPrice: trade.yesPrice,
    noPrice: trade.noPrice,
    estimatedShares,
    estimatedCost: round4(sizeDollars),
    estimatedMaxLoss,
    estimatedMaxPayout,
    estimatedProfitIfCorrect,
    confidenceScore: market.confidenceScore,
    actionSignal: market.actionSignal,
    actionReason: market.actionReason,
    timestamp: nowIso(),
  };
}

function getOutcomeLabelForSide(side) {
  return side === "BUY YES" ? "YES" : "NO";
}

function getTokenIdForSide(market, side) {
  if (!Array.isArray(market.tokenIds)) return null;
  return side === "BUY YES" ? market.tokenIds[0] || null : market.tokenIds[1] || null;
}

function buildSignedOrderHandoff(market, side, sizeDollars) {
  const quote = buildTradeQuote(market, side, sizeDollars, "LIVE");
  const readiness = getAccountReadiness();
  const builderEnv = getBuilderEnvStatus();

  const tokenID = getTokenIdForSide(market, side);
  const outcome = getOutcomeLabelForSide(side);

  const blockedReasons = [
    !readiness.isConnected ? "Account is not connected" : null,
    !readiness.liveModeEnabled ? "Live mode is not enabled" : null,
    !readiness.canEnableLiveMode ? "Account cannot enable live mode yet" : null,
    !readiness.builderApiConfigured ? "Builder credentials are not configured on the server" : null,
    !readiness.relayerReady ? "Builder live routing is not enabled on the server" : null,
    !tokenID ? "Outcome token ID is missing for this side" : null,
  ].filter(Boolean);

  const signableOrder = {
    tokenID,
    side: "BUY",
    price: round4(quote.selectedPrice),
    size: round4(quote.estimatedShares),
    tickSize: market.minimumTickSize || "0.01",
    negRisk: !!market.negRisk,
    feeRateBps: 0,
    taker: null,
    expiration: 0,
  };

  return {
    enabled: true,
    blocked: blockedReasons.length > 0,
    blockedReasons,
    submissionEnabled: builderEnv.realLiveSubmitEnabled,
    submissionMode: builderEnv.realLiveSubmitEnabled ? "LIVE_SUBMIT_ENABLED" : "SAFE_FALLBACK_ONLY",
    submitPath: "/api/trade/submit-signed",
    submitMethod: "POST",
    orderType: DEFAULT_ORDER_TYPE,
    postOnly: DEFAULT_POST_ONLY,
    signableOrder,
    routingTarget: {
      baseUrl: CLOB,
      path: "/order",
      method: "POST",
    },
    clientRequirements: {
      signedOrderRequired: true,
      userL2AuthRequired: true,
      builderSecretsStayServerSide: true,
    },
    orderSummary: {
      marketId: market.id,
      question: market.question,
      outcome,
      tokenID,
      selectedPrice: round4(quote.selectedPrice),
      sizeDollars: round4(quote.sizeDollars),
      estimatedShares: round4(quote.estimatedShares),
      walletAddress: readiness.walletAddress || null,
      funderAddress: readiness.funderAddress || null,
      signatureType: readiness.signatureType ?? 0,
    },
    userAuthSchema: {
      address: "<user-wallet-address>",
      apiKey: "<user-api-key>",
      secret: "<user-api-secret>",
      passphrase: "<user-api-passphrase>",
    },
    notes: [
      "The user signs the order payload client-side or in an external wallet/SDK flow.",
      "The backend receives the signed order plus user L2 auth and forwards it with builder attribution headers.",
      builderEnv.realLiveSubmitEnabled
        ? "Real live submission is enabled on the server."
        : "Real live submission is disabled on the server, so signed-order submit will fall back safely.",
    ],
  };
}

function buildExecutionPreparation(market, side, sizeDollars) {
  const quote = buildTradeQuote(market, side, sizeDollars, "LIVE");
  const readiness = getAccountReadiness();
  const signedOrderHandoff = buildSignedOrderHandoff(market, side, sizeDollars);

  return {
    dryRun: !signedOrderHandoff.submissionEnabled,
    builderReady: readiness.builderReady,
    mode: "LIVE",
    status: signedOrderHandoff.blocked
      ? "SIGNED_HANDOFF_BLOCKED"
      : "SIGNED_HANDOFF_READY",
    message: signedOrderHandoff.blocked
      ? "Signed-order handoff is blocked by readiness checks."
      : signedOrderHandoff.submissionEnabled
        ? "Signed-order handoff is ready. The backend can accept a signed order plus user L2 auth and forward it with builder attribution."
        : "Signed-order handoff is ready, but real submit is disabled on the server, so the fallback remains safe.",
    accountReadiness: readiness,
    signedOrderHandoff,
    ticket: quote,
    nextSteps: signedOrderHandoff.blocked
      ? signedOrderHandoff.blockedReasons
      : [
          "Sign the order payload with the user wallet or SDK",
          "Send the signed order plus user L2 auth bundle to the backend handoff route",
        ],
  };
}

// ===============================
// SIGNAL LOGGING
// ===============================

function shouldLogSignal(m) {
  const key = `${m.id}-${m.actionSignal}`;
  const last = signalLogTimestamps.get(key) || 0;
  const now = Date.now();

  if (now - last > SIGNAL_LOG_COOLDOWN_MS) {
    signalLogTimestamps.set(key, now);
    return true;
  }

  return false;
}

function maybeLogSignals(markets) {
  for (const m of markets) {
    if (!shouldLogSignal(m)) continue;

    signalLog.unshift({
      id: `${m.id}-${Date.now()}`,
      marketId: m.id,
      question: m.question,
      slug: m.slug,
      eventSlug: m.eventSlug,
      url: m.url,
      actionSignal: m.actionSignal,
      actionReason: m.actionReason,
      confidenceScore: m.confidenceScore,
      hotScore: m.hotScore,
      entryYesPrice: m.yesPriceLive,
      currentYesPrice: m.yesPriceLive,
      performancePoints: 0,
      status: "ACTIVE",
      liquidity: m.liquidity,
      volume24hr: m.volume24hr,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  signalLog = signalLog.slice(0, 300);
}

// ===============================
// ALERTS + MOVER HISTORY
// ===============================

function updatePriceHistory(markets) {
  const now = Date.now();

  for (const market of markets) {
    if (market.yesPriceLive === null || market.yesPriceLive === undefined) continue;

    const existing = priceHistory.get(market.id) || [];
    const next = [
      ...existing,
      {
        timestamp: now,
        price: Number(market.yesPriceLive),
      },
    ].filter((row) => now - row.timestamp <= PRICE_HISTORY_WINDOW_MS);

    priceHistory.set(market.id, next);
  }
}

function getPastPrice(marketId, lookbackMs = MOVER_LOOKBACK_MS) {
  const rows = priceHistory.get(marketId) || [];
  if (!rows.length) return null;

  const target = Date.now() - lookbackMs;
  let best = rows[0];

  for (const row of rows) {
    if (Math.abs(row.timestamp - target) < Math.abs(best.timestamp - target)) {
      best = row;
    }
  }

  return typeof best.price === "number" ? best.price : null;
}

function buildAlerts(limit = 8) {
  return signalLog
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .filter((s) => s.actionSignal === "BUY YES" || s.actionSignal === "BUY NO")
    .slice(0, limit)
    .map((s) => ({
      id: s.id,
      message: `${s.actionSignal}: ${s.question} — ${s.actionReason}`,
      timestamp: s.updatedAt || s.createdAt || nowIso(),
    }));
}

function buildBiggestMovers(markets, limit = 8) {
  const movers = markets.map((m) => {
    const currentPrice = m.yesPriceLive;

    if (currentPrice === null || currentPrice === undefined) {
      return {
        ...m,
        pastPrice: null,
        priceChange: 0,
        percentChange: 0,
      };
    }

    const historicalPrice = getPastPrice(m.id);
    const pastPrice =
      historicalPrice === null || historicalPrice === undefined
        ? currentPrice
        : historicalPrice;

    const priceChange = round4(currentPrice - pastPrice);
    const percentChange =
      pastPrice > 0 ? round4(priceChange / pastPrice) : 0;

    return {
      ...m,
      pastPrice: round4(pastPrice),
      priceChange,
      percentChange,
    };
  });

  return movers
    .slice()
    .sort((a, b) => {
      const changeDiff = Math.abs(b.priceChange) - Math.abs(a.priceChange);
      if (changeDiff !== 0) return changeDiff;
      return (b.volume24hr || 0) - (a.volume24hr || 0);
    })
    .slice(0, limit);
}

// ===============================
// PERFORMANCE STATS
// ===============================

function getPerformanceStats() {
  const signals = signalLog;
  const resolved = signals.filter((s) => s.status === "WIN" || s.status === "LOSS");
  const wins = resolved.filter((s) => s.status === "WIN");
  const losses = resolved.filter((s) => s.status === "LOSS");
  const active = signals.filter((s) => s.status === "ACTIVE");

  const totalResolved = resolved.length;
  const winRate = totalResolved ? wins.length / totalResolved : 0;

  const avgPerformanceAll = avg(signals.map((s) => s.performancePoints || 0));
  const avgWin = avg(wins.map((s) => s.performancePoints || 0));
  const avgLoss = avg(losses.map((s) => s.performancePoints || 0));
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  const bySignal = {};

  for (const s of signals) {
    if (!bySignal[s.actionSignal]) {
      bySignal[s.actionSignal] = {
        total: 0,
        active: 0,
        wins: 0,
        losses: 0,
        avgPerformance: 0,
        winRate: 0,
      };
    }

    const bucket = bySignal[s.actionSignal];
    bucket.total += 1;

    if (s.status === "ACTIVE") bucket.active += 1;
    if (s.status === "WIN") bucket.wins += 1;
    if (s.status === "LOSS") bucket.losses += 1;
  }

  for (const signalType of Object.keys(bySignal)) {
    const rows = signals.filter((s) => s.actionSignal === signalType);
    const resolvedRows = rows.filter((s) => s.status === "WIN" || s.status === "LOSS");
    const winsCount = resolvedRows.filter((s) => s.status === "WIN").length;

    bySignal[signalType].avgPerformance = Number(
      avg(rows.map((s) => s.performancePoints || 0)).toFixed(4)
    );
    bySignal[signalType].winRate = resolvedRows.length
      ? Number((winsCount / resolvedRows.length).toFixed(4))
      : 0;
  }

  return {
    totalSignals: signals.length,
    activeSignals: active.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Number(winRate.toFixed(4)),
    avgPerformance: Number(avgPerformanceAll.toFixed(4)),
    avgWin: Number(avgWin.toFixed(4)),
    avgLoss: Number(avgLoss.toFixed(4)),
    expectancy: Number(expectancy.toFixed(4)),
    bySignal,
  };
}

// ===============================
// DATA FETCH
// ===============================

async function fetchMarkets() {
  const res = await fetch(`${GAMMA}/events?active=true&closed=false&limit=25`);

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`Gamma fetch failed: ${res.status} | ${raw}`);
  }

  const events = await res.json();

  const cleaned = events
    .flatMap((event) =>
      (event.markets || []).map((m) => ({
        id: m.id,
        question: m.question,
        slug: m.slug,
        eventSlug: event.slug,
        liquidity: Number(m.liquidity ?? 0),
        volume: Number(m.volume ?? 0),
        volume24hr: Number(m.volume24hr ?? 0),
        tokenIds: safeJsonParse(m.clobTokenIds, []),
        active: m.active,
        closed: m.closed,
        minimumTickSize: String(m.minimum_tick_size ?? "0.01"),
        negRisk: Boolean(m.neg_risk ?? event.neg_risk ?? false),
      }))
    )
    .filter((m) => m.active && !m.closed && m.tokenIds.length >= 2);

  const tokenIds = cleaned.map((m) => m.tokenIds[0]).filter(Boolean);

  const priceRes = await fetch(`${CLOB}/last-trades-prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tokenIds.map((id) => ({ token_id: id }))),
  });

  if (!priceRes.ok) {
    const raw = await priceRes.text();
    throw new Error(`CLOB price fetch failed: ${priceRes.status} | ${raw}`);
  }

  const prices = await priceRes.json();

  const priceMap = Object.fromEntries(
    prices.map((p) => [p.token_id, Number(p.price)])
  );

  return cleaned.map((m) => ({
    ...m,
    yesPriceLive: priceMap[m.tokenIds[0]] ?? null,
  }));
}

// ===============================
// BUILD MARKETS
// ===============================

async function buildMarkets() {
  const markets = await fetchMarkets();

  return markets.map((m) => {
    const hotScore = getHotScore(m);
    const confidenceScore = getConfidenceScore({ ...m, hotScore });

    const { actionSignal, actionReason } = getActionSignal({
      ...m,
      hotScore,
      confidenceScore,
    });

    return {
      ...m,
      hotScore,
      confidenceScore,
      actionSignal,
      actionReason,
      url: `https://polymarket.com/event/${m.eventSlug || m.slug}`,
    };
  });
}

// ===============================
// ENGINE LOOP
// ===============================

async function runEngine() {
  const markets = await buildMarkets();

  updatePriceHistory(markets);

  const top = markets
    .slice()
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, 10);

  updateSignalPerformance(markets);
  maybeLogSignals(top);

  updatePaperPortfolio(markets);
  // Intentionally no auto-open paper positions here.
  // Paper trading should start clean and only open from explicit user actions.
}

// ===============================
// ROUTES
// ===============================

app.post("/api/public-demo/reset", (_, res) => {
  try {
    const state = resetPublicDemoState();

    res.json({
      ok: true,
      reset: true,
      account: state.account,
      stats: state.stats,
      message: "Public demo state reset to a clean default load.",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || "Failed to reset public demo state",
    });
  }
});

app.get("/api/liveMarkets", async (_, res) => {
  try {
    const markets = await buildMarkets();
    res.json({ ok: true, markets });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch markets",
    });
  }
});

app.get("/api/alerts", (_, res) => {
  try {
    const alerts = buildAlerts();
    res.json({ ok: true, alerts });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || "Failed to load alerts",
    });
  }
});

app.get("/api/biggestMovers", async (_, res) => {
  try {
    const markets = await buildMarkets();
    const movers = buildBiggestMovers(markets);
    res.json({ ok: true, markets: movers });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || "Failed to load biggest movers",
    });
  }
});

app.get("/api/signal-log", (_, res) => {
  res.json({ ok: true, signals: signalLog });
});

app.get("/api/performance-stats", (_, res) => {
  res.json({ ok: true, stats: getPerformanceStats() });
});

app.get("/api/paper-portfolio", (_, res) => {
  res.json({
    ok: true,
    positions: paperPortfolio,
    stats: getPaperPortfolioStats(),
  });
});

app.get("/api/account-state", (_, res) => {
  res.json({
    ok: true,
    account: getAccountReadiness(),
  });
});

app.post("/api/account/connect", (req, res) => {
  try {
    const {
      walletAddress,
      walletType,
      proxyWalletAddress,
      signatureType,
      funderAddress,
    } = req.body || {};

    if (!walletAddress) {
      throw new Error("walletAddress is required");
    }

    const account = connectAccount({
      walletAddress,
      walletType: walletType || "EOA",
      proxyWalletAddress: proxyWalletAddress || "",
      signatureType: Number(signatureType || 0),
      funderAddress: funderAddress || walletAddress,
    });

    res.json({ ok: true, account });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to connect account",
    });
  }
});

app.post("/api/account/disconnect", (_, res) => {
  try {
    const account = disconnectAccount();
    res.json({ ok: true, account });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to disconnect account",
    });
  }
});

app.post("/api/account/live-mode", (req, res) => {
  try {
    const { enabled } = req.body || {};
    const account = updateLiveMode(!!enabled);
    res.json({ ok: true, account });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to update live mode",
    });
  }
});

app.post("/api/account/builder-settings", (req, res) => {
  try {
    const account = updateBuilderSettings(req.body || {});
    res.json({ ok: true, account });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to update builder settings",
    });
  }
});

app.post("/api/paper-portfolio/open", async (req, res) => {
  try {
    const { marketId, actionSignal, positionSizeDollars } = req.body || {};

    if (!marketId || !actionSignal || !positionSizeDollars) {
      throw new Error("marketId, actionSignal, and positionSizeDollars are required");
    }

    const markets = await buildMarkets();
    const market = markets.find((m) => String(m.id) === String(marketId));

    if (!market) throw new Error("Market not found");

    const position = manuallyOpenPaperPosition(
      market,
      actionSignal,
      round4(Number(positionSizeDollars))
    );

    res.json({
      ok: true,
      position,
      stats: getPaperPortfolioStats(),
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to open paper position",
    });
  }
});

app.post("/api/paper-portfolio/close", (req, res) => {
  try {
    const { positionId, reason } = req.body || {};

    if (!positionId) {
      throw new Error("positionId is required");
    }

    const position = manuallyClosePaperPosition(positionId, reason || "Manual Close");

    res.json({
      ok: true,
      position,
      stats: getPaperPortfolioStats(),
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to close paper position",
    });
  }
});

app.post("/api/paper-portfolio/reset", (req, res) => {
  try {
    const { startingBankroll, defaultPositionSize } = req.body || {};

    resetPaperPortfolio(
      Number(startingBankroll) || 1000,
      Number(defaultPositionSize) || 50
    );

    res.json({
      ok: true,
      stats: getPaperPortfolioStats(),
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to reset paper portfolio",
    });
  }
});

// ===============================
// EXECUTION-READY TRADE ROUTES
// ===============================

app.post("/api/trade/quote", async (req, res) => {
  try {
    const { marketId, side, sizeDollars, mode } = req.body || {};

    if (!marketId || !side || !sizeDollars) {
      throw new Error("marketId, side, and sizeDollars are required");
    }

    const markets = await buildMarkets();
    const market = markets.find((m) => String(m.id) === String(marketId));

    if (!market) throw new Error("Market not found");

    const quote = buildTradeQuote(
      market,
      side,
      Number(sizeDollars),
      mode || "PAPER"
    );

    res.json({ ok: true, quote });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to build trade quote",
    });
  }
});

app.post("/api/trade/prepare", async (req, res) => {
  try {
    const { marketId, side, sizeDollars } = req.body || {};

    if (!marketId || !side || !sizeDollars) {
      throw new Error("marketId, side, and sizeDollars are required");
    }

    const markets = await buildMarkets();
    const market = markets.find((m) => String(m.id) === String(marketId));

    if (!market) throw new Error("Market not found");

    const preparation = buildExecutionPreparation(
      market,
      side,
      Number(sizeDollars)
    );

    res.json({ ok: true, preparation });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to prepare trade",
    });
  }
});

app.post("/api/trade/submit-signed", async (req, res) => {
  try {
    const {
      marketId,
      side,
      sizeDollars,
      signedOrder,
      userAuth,
      orderType = DEFAULT_ORDER_TYPE,
      postOnly = DEFAULT_POST_ONLY,
    } = req.body || {};

    if (!marketId || !side || !sizeDollars) {
      throw new Error("marketId, side, and sizeDollars are required");
    }

    const parsedSignedOrder = tryParseJsonObject(signedOrder);
    const parsedUserAuth = tryParseJsonObject(userAuth);

    const markets = await buildMarkets();
    const market = markets.find((m) => String(m.id) === String(marketId));

    if (!market) throw new Error("Market not found");

    const preparation = buildExecutionPreparation(
      market,
      side,
      Number(sizeDollars)
    );

    if (preparation.signedOrderHandoff?.blocked) {
      return res.status(400).json({
        ok: false,
        error: "Signed-order handoff is blocked",
        result: {
          status: "HANDOFF_BLOCKED",
          blockedReasons: preparation.signedOrderHandoff.blockedReasons,
        },
      });
    }

    const requestPath = "/order";
    const requestMethod = "POST";
    const submissionBody = buildOrderSubmissionBody(
      parsedSignedOrder,
      orderType,
      postOnly
    );
    const bodyString = safeJsonStringify(submissionBody);

    const userHeaders = buildUserL2Headers(
      parsedUserAuth,
      requestMethod,
      requestPath,
      bodyString
    );
    const builderHeaders = await buildBuilderHeaders(
      requestMethod,
      requestPath,
      bodyString
    );

    const builderEnv = getBuilderEnvStatus();

    if (!builderEnv.realLiveSubmitEnabled) {
      return res.json({
        ok: true,
        forwarded: false,
        dryRunFallback: true,
        result: {
          status: "HANDOFF_DRY_RUN_FALLBACK",
          message:
            "Signed-order handoff is wired, but real live submission is disabled on the server. No order was forwarded.",
          requestSummary: {
            target: `${CLOB}${requestPath}`,
            method: requestMethod,
            orderType,
            postOnly: !!postOnly,
            signedOrderSummary: summarizeSignedOrder(parsedSignedOrder),
            builderAttributionAttached: true,
            userL2AuthAttached: true,
            realSubmissionAttempted: false,
          },
        },
      });
    }

    const clobRes = await fetch(`${CLOB}${requestPath}`, {
      method: requestMethod,
      headers: {
        "Content-Type": "application/json",
        ...userHeaders,
        ...builderHeaders,
      },
      body: bodyString,
    });

    const raw = await clobRes.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    if (!clobRes.ok) {
      return res.status(400).json({
        ok: false,
        forwarded: false,
        error: "CLOB rejected signed-order handoff",
        result: {
          status: "FORWARD_REJECTED",
          message: "The signed order was handed off, but the CLOB rejected the request.",
          requestSummary: {
            target: `${CLOB}${requestPath}`,
            method: requestMethod,
            orderType,
            postOnly: !!postOnly,
            signedOrderSummary: summarizeSignedOrder(parsedSignedOrder),
            builderAttributionAttached: true,
            userL2AuthAttached: true,
            realSubmissionAttempted: true,
          },
          clobResponse: parsed,
        },
      });
    }

    return res.json({
      ok: true,
      forwarded: true,
      dryRunFallback: false,
      result: {
        status: "FORWARDED_TO_CLOB",
        message:
          "Signed order handed off successfully. The backend forwarded the signed order with builder attribution attached.",
        requestSummary: {
          target: `${CLOB}${requestPath}`,
          method: requestMethod,
          orderType,
          postOnly: !!postOnly,
          signedOrderSummary: summarizeSignedOrder(parsedSignedOrder),
          builderAttributionAttached: true,
          userL2AuthAttached: true,
          realSubmissionAttempted: true,
        },
        clobResponse: parsed,
      },
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to submit signed order handoff",
    });
  }
});

app.post("/api/trade/execute", async (req, res) => {
  try {
    const { marketId, side, sizeDollars, mode } = req.body || {};

    if (!marketId || !side || !sizeDollars) {
      throw new Error("marketId, side, and sizeDollars are required");
    }

    const markets = await buildMarkets();
    const market = markets.find((m) => String(m.id) === String(marketId));

    if (!market) throw new Error("Market not found");

    if ((mode || "PAPER") === "PAPER") {
      const position = manuallyOpenPaperPosition(
        market,
        side,
        round4(Number(sizeDollars))
      );

      return res.json({
        ok: true,
        mode: "PAPER",
        message: "Paper trade executed",
        position,
        stats: getPaperPortfolioStats(),
      });
    }

    const preparation = buildExecutionPreparation(
      market,
      side,
      Number(sizeDollars)
    );

    return res.json({
      ok: true,
      mode: "LIVE",
      message:
        "Live mode now uses signed-order handoff architecture. No direct live execution occurs here without a signed order handoff request.",
      preparation,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to execute trade",
    });
  }
});

// ===============================
// START
// ===============================

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  const builderEnv = getBuilderEnvStatus();

  // Ensure a clean public state on each deploy / boot.
  resetPublicDemoState();

  console.log(`Running on http://localhost:${PORT}`);
  console.log(
    `[Builder] configured=${builderEnv.configured} liveRoutingEnabled=${builderEnv.liveRoutingEnabled} relayerReady=${builderEnv.relayerReady} realLiveSubmitEnabled=${builderEnv.realLiveSubmitEnabled}`
  );

  try {
    await runEngine();
  } catch (err) {
    console.error("Initial engine run failed:", err.message || err);
  }

  setInterval(async () => {
    try {
      await runEngine();
    } catch (err) {
      console.error("Scheduled engine run failed:", err.message || err);
    }
  }, 60000);
});