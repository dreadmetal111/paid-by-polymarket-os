const POLYMARKET_CLOB_HOST = "https://clob.polymarket.com";
const POLYMARKET_CHAIN_ID = 137;
const POLYGON_HEX_CHAIN_ID = "0x89";

let hotMarketsCache = [];
let currentTradeTicket = null;
let accountStateCache = null;
let currentLivePreparation = null;
let currentClientSignedOrder = null;
let currentUserAuthDraft = createEmptyUserAuthDraft();
let currentUserAuthUiState = createEmptyUserAuthUiState();
let walletConnectionSource = "NONE"; // NONE | BROWSER | MANUAL
let browserWalletEventsBound = false;
let polymarketBrowserModulesPromise = null;

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

function formatProbability(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatChangeAsProbability(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)} pts`;
}

function formatPercentChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTimestamp(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatPoints(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pts = value * 100;
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

function hasBrowserWalletProvider() {
  return typeof window !== "undefined" && !!window.ethereum?.request;
}

function getCurrentTradeMode() {
  const modeSelect = document.getElementById("tradeModeSelect");
  return modeSelect?.value || "PAPER";
}

function getMarketSignals(market) {
  const signals = [];

  if (market.actionSignal === "BUY YES") signals.push("🟢 BUY YES");
  else if (market.actionSignal === "BUY NO") signals.push("🔴 BUY NO");
  else signals.push("👀 WATCH");

  if ((market.hotScore || 0) > 800000) signals.push("🔥 Momentum");
  if (market.yesPriceLive > 0.4 && market.yesPriceLive < 0.6) signals.push("⚖️ Balanced");
  if ((market.liquidity || 0) > 200000) signals.push("💧 Liquid");
  if (market.yesPriceLive < 0.08 || market.yesPriceLive > 0.92) signals.push("⚠️ Extreme");
  if ((market.confidenceScore || 0) >= 80) signals.push("🎯 High Confidence");

  return signals;
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
      <div class="alert-message">${alert.message}</div>
      <div class="alert-time">${formatTimestamp(alert.timestamp)}</div>
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
      <div class="alert-message">${signal.actionSignal}: ${signal.question}</div>
      <div class="alert-time">Logged: ${formatTimestamp(signal.createdAt)}</div>
      <div class="alert-time">Why it stood out: ${signal.actionReason}</div>
      <div class="alert-time">Confidence: ${signal.confidenceScore}/100</div>
      <div class="alert-time">Entry: ${formatProbability(signal.entryYesPrice)}</div>
      <div class="alert-time">Current: ${formatProbability(signal.currentYesPrice)}</div>
      <div class="alert-time ${perfClass}">Performance: ${formatPoints(perf)}</div>
      <div class="alert-time ${statusClass}">Status: ${statusLabel}</div>
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
        <h3>${signalType}</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Total</span><span class="meta-value">${data.total}</span></div>
          <div class="meta-box"><span class="meta-label">Active</span><span class="meta-value">${data.active}</span></div>
          <div class="meta-box"><span class="meta-label">Wins</span><span class="meta-value">${data.wins}</span></div>
          <div class="meta-box"><span class="meta-label">Losses</span><span class="meta-value">${data.losses}</span></div>
          <div class="meta-box"><span class="meta-label">Win Rate</span><span class="meta-value">${((data.winRate || 0) * 100).toFixed(1)}%</span></div>
          <div class="meta-box"><span class="meta-label">Avg Perf</span><span class="meta-value">${formatPoints(data.avgPerformance || 0)}</span></div>
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
          <div class="meta-box"><span class="meta-label">Total Signals</span><span class="meta-value">${stats.totalSignals ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Active</span><span class="meta-value">${stats.activeSignals ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Wins</span><span class="meta-value">${stats.wins ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Losses</span><span class="meta-value">${stats.losses ?? 0}</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>Edge Summary</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Win Rate</span><span class="meta-value">${winRatePct}%</span></div>
          <div class="meta-box"><span class="meta-label">Avg Performance</span><span class="meta-value">${avgPerfLabel}</span></div>
          <div class="meta-box"><span class="meta-label">Avg Win</span><span class="meta-value">${avgWinLabel}</span></div>
          <div class="meta-box"><span class="meta-label">Avg Loss</span><span class="meta-value">${avgLossLabel}</span></div>
          <div class="meta-box"><span class="meta-label">Expectancy</span><span class="meta-value">${expectancyLabel}</span></div>
        </div>
      </article>
    </div>

    <div class="market-grid" style="margin-top: 18px;">
      ${signalBreakdown || `<p class="empty">No signal breakdown yet.</p>`}
    </div>
  `;
}

function renderAccountPanel(account) {
  const blockers = (account.blockers || []).map((b) => `<div class="alert-time">• ${b}</div>`).join("");
  const liveToggleDisabled = !account.canEnableLiveMode ? "disabled" : "";
  const liveChecked = account.liveModeEnabled ? "checked" : "";

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Account Status</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Connected</span><span class="meta-value">${account.isConnected ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Wallet Type</span><span class="meta-value">${account.walletType || "NONE"}</span></div>
          <div class="meta-box"><span class="meta-label">Wallet</span><span class="meta-value">${account.walletAddress || "—"}</span></div>
          <div class="meta-box"><span class="meta-label">Proxy Wallet</span><span class="meta-value">${account.proxyWalletAddress || "—"}</span></div>
          <div class="meta-box"><span class="meta-label">Signature Type</span><span class="meta-value">${account.signatureType ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Funder</span><span class="meta-value">${account.funderAddress || "—"}</span></div>
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
          <div class="meta-box"><span class="meta-label">Max Live Submit</span><span class="meta-value">${formatMoney(account.maxRealSubmitDollars || 0)}</span></div>
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
          <div class="meta-box"><span class="meta-label">Wallet</span><span class="meta-value">${shortAddress(account.walletAddress)}</span></div>
          <div class="meta-box"><span class="meta-label">Wallet Type</span><span class="meta-value">${account.walletType || "EOA"}</span></div>
          <div class="meta-box"><span class="meta-label">Proxy Wallet</span><span class="meta-value">${account.proxyWalletAddress ? shortAddress(account.proxyWalletAddress) : "—"}</span></div>
          <div class="meta-box"><span class="meta-label">Funder</span><span class="meta-value">${account.funderAddress ? shortAddress(account.funderAddress) : "—"}</span></div>
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
          <div class="meta-box"><span class="meta-label">Config Source</span><span class="meta-value">${account.builderConfigSource || "SERVER_ENV"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder API</span><span class="meta-value">${account.builderApiConfigured ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Relayer</span><span class="meta-value">${account.relayerReady ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Live Routing</span><span class="meta-value">${account.liveRoutingEnabled ? "ON" : "OFF"}</span></div>
          <div class="meta-box"><span class="meta-label">Signed Handoff</span><span class="meta-value">${account.signedOrderHandoffEnabled ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Real Submit</span><span class="meta-value">${account.realLiveSubmitEnabled ? "ON" : "SAFE FALLBACK"}</span></div>
          <div class="meta-box"><span class="meta-label">Max Submit</span><span class="meta-value">${formatMoney(account.maxRealSubmitDollars || 0)}</span></div>
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
          <div class="meta-box"><span class="meta-label">Starting</span><span class="meta-value">${formatMoney(bankroll.startingBankroll || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Cash</span><span class="meta-value">${formatMoney(bankroll.cash || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Equity</span><span class="meta-value">${formatMoney(bankroll.equity || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Default Size</span><span class="meta-value">${formatMoney(bankroll.defaultPositionSize || 0)}</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>Paper Trading Summary</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Total Positions</span><span class="meta-value">${stats.totalPositions ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Open</span><span class="meta-value">${stats.openPositions ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Closed</span><span class="meta-value">${stats.closedPositions ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Closed Win Rate</span><span class="meta-value">${closedWinRate}%</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>P&amp;L</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Avg Open P&amp;L</span><span class="meta-value">${formatPoints(stats.avgOpenPnl || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Realized P&amp;L</span><span class="meta-value">${formatMoney(stats.realizedPnl || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Unrealized P&amp;L</span><span class="meta-value">${formatMoney(stats.unrealizedPnlDollars || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Closed Wins</span><span class="meta-value">${stats.closedWins ?? 0}</span></div>
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
      ? `<button class="close-position-btn" data-position-id="${position.id}">Close Position</button>`
      : "";

  return `
    <div class="alert-item">
      <div class="alert-message">${position.actionSignal}: ${position.question}</div>
      <div class="alert-time">Source: ${position.source || "AUTO"}</div>
      <div class="alert-time">Opened: ${formatTimestamp(position.openedAt)}</div>
      <div class="alert-time">Why it was opened: ${position.actionReason}</div>
      <div class="alert-time">Confidence: ${position.confidenceScore}/100</div>
      <div class="alert-time">Size: ${formatMoney(position.positionSizeDollars || 0)}</div>
      <div class="alert-time">Entry: ${formatProbability(position.entryYesPrice)}</div>
      <div class="alert-time">Current: ${formatProbability(position.currentYesPrice)}</div>
      <div class="alert-time ${pnlClass}">P&amp;L Points: ${formatPoints(pnl)}</div>
      <div class="alert-time ${pnlClass}">P&amp;L Dollars: ${formatMoney(pnlDollar)}</div>
      <div class="alert-time ${statusClass}">Status: ${position.status}</div>
      ${position.closeReason ? `<div class="alert-time">Close Reason: ${position.closeReason}</div>` : ""}
      ${position.closedAt ? `<div class="alert-time">Closed: ${formatTimestamp(position.closedAt)}</div>` : ""}
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
    ? `<button id="prepareLiveTradeBtn" disabled>Live Requirements Not Met</button>`
    : `<button id="prepareLiveTradeBtn">${mode === "LIVE" ? "Prepare Signed Handoff" : "Preview Live Trade"}</button>`;

  return `
    <div class="market-card">
      <h3>Execution Ticket</h3>
      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Question</span><span class="meta-value">${quote.question}</span></div>
        <div class="meta-box"><span class="meta-label">Mode</span><span class="meta-value">${mode}</span></div>
        <div class="meta-box"><span class="meta-label">Side</span><span class="meta-value">${quote.side}</span></div>
        <div class="meta-box"><span class="meta-label">Selected Price</span><span class="meta-value">${formatProbability(quote.selectedPrice)}</span></div>
        <div class="meta-box"><span class="meta-label">Size</span><span class="meta-value">${formatMoney(quote.sizeDollars)}</span></div>
        <div class="meta-box"><span class="meta-label">Estimated Shares</span><span class="meta-value">${quote.estimatedShares}</span></div>
        <div class="meta-box"><span class="meta-label">Estimated Max Loss</span><span class="meta-value">${formatMoney(quote.estimatedMaxLoss)}</span></div>
        <div class="meta-box"><span class="meta-label">Potential Profit</span><span class="meta-value">${formatMoney(quote.estimatedProfitIfCorrect)}</span></div>
        <div class="meta-box"><span class="meta-label">Confidence</span><span class="meta-value">${quote.confidenceScore}/100</span></div>
        <div class="meta-box"><span class="meta-label">Why this trade</span><span class="meta-value">${quote.actionReason}</span></div>
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
          <div class="meta-box"><span class="meta-label">Status</span><span class="meta-value">${result.status || (isError ? "ERROR" : "DONE")}</span></div>
          <div class="meta-box"><span class="meta-label">Forwarded</span><span class="meta-value">${response?.forwarded ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Blocked</span><span class="meta-value">${response?.blocked ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Safe Fallback</span><span class="meta-value">${response?.dryRunFallback ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Real Submission</span><span class="meta-value">${summary.realSubmissionAttempted ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder Attribution</span><span class="meta-value">${summary.builderAttributionAttached ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">User L2 Auth</span><span class="meta-value">${summary.userL2AuthAttached ? "YES" : "NO"}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">${result.message || response?.error || "No response message provided."}</div>
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
                <div class="alert-message">${reason}</div>
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
          <div class="meta-box"><span class="meta-label">Mode</span><span class="meta-value">${preparation.mode || "LIVE"}</span></div>
          <div class="meta-box"><span class="meta-label">Status</span><span class="meta-value">${preparation.status || "—"}</span></div>
          <div class="meta-box"><span class="meta-label">Current State</span><span class="meta-value">${stateLabel}</span></div>
          <div class="meta-box"><span class="meta-label">Builder Ready</span><span class="meta-value">${preparation.builderReady ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Submission Mode</span><span class="meta-value">${handoff.submissionMode || "SAFE_FALLBACK_ONLY"}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">${stateMessage}</div>
          <div class="alert-time">Question: ${ticket.question || "—"}</div>
          <div class="alert-time">Side: ${ticket.side || "—"}</div>
          <div class="alert-time">Size: ${formatMoney(ticket.sizeDollars || 0)}</div>
          <div class="alert-time">Selected Price: ${formatProbability(ticket.selectedPrice)}</div>
        </div>
      </article>

      <article class="market-card">
        <h3>Real Submit Guardrails</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Server Enabled</span><span class="meta-value">${realSubmitPolicy.enabled ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Safe Fallback</span><span class="meta-value">${fallbackMode ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Requested Size</span><span class="meta-value">${formatMoney(realSubmitReadiness.requestedSizeDollars || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Max Submit Size</span><span class="meta-value">${formatMoney(realSubmitPolicy.maxSubmitDollars || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Within Max Size</span><span class="meta-value">${realSubmitReadiness.withinMaxSubmitSize ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Guarded Ready</span><span class="meta-value">${guardedReady ? "YES" : "NO"}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">Confirmation text required before real submit</div>
          <div class="alert-time">${realSubmitPolicy.confirmText || "—"}</div>
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
                <div class="alert-message">${reason}</div>
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
            <div class="alert-time">${realSubmitPolicy.confirmText || "—"}</div>
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
                  <div class="alert-message">${note}</div>
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
                  <div class="alert-message">${step}</div>
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

function renderHotCard(market) {
  const signals = getMarketSignals(market);

  return `
    <article class="market-card">
      <h3>${market.question}</h3>

      <div class="signals">
        ${signals.map((signal) => `<span class="signal">${signal}</span>`).join("")}
      </div>

      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Yes Price</span><span class="meta-value">${formatProbability(market.yesPriceLive)}</span></div>
        <div class="meta-box"><span class="meta-label">24h Volume</span><span class="meta-value">${formatMoney(market.volume24hr)}</span></div>
        <div class="meta-box"><span class="meta-label">Liquidity</span><span class="meta-value">${formatMoney(market.liquidity)}</span></div>
        <div class="meta-box"><span class="meta-label">Confidence</span><span class="meta-value">${market.confidenceScore ?? "—"}/100</span></div>
        <div class="meta-box"><span class="meta-label">Signal</span><span class="meta-value">${market.actionSignal ?? "WATCH"}</span></div>
        <div class="meta-box"><span class="meta-label">Why it matters</span><span class="meta-value">${market.actionReason ?? "No reason yet"}</span></div>
      </div>

      <div class="market-footer">
        <span class="market-small">${market.slug}</span>
        <a class="market-link" href="${market.url}" target="_blank" rel="noopener noreferrer">Open Market</a>
      </div>

      <div class="market-footer" style="margin-top: 12px;">
        <button class="trade-action-btn" data-market-id="${market.id}" data-side="BUY YES">Preview BUY YES</button>
        <button class="trade-action-btn" data-market-id="${market.id}" data-side="BUY NO">Preview BUY NO</button>
      </div>
    </article>
  `;
}

function renderMoverCard(market) {
  const changeClass = market.percentChange >= 0 ? "positive" : "negative";

  return `
    <article class="market-card">
      <h3>${market.question}</h3>

      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Current Price</span><span class="meta-value">${formatProbability(market.yesPriceLive)}</span></div>
        <div class="meta-box"><span class="meta-label">Recent Price</span><span class="meta-value">${formatProbability(market.pastPrice)}</span></div>
        <div class="meta-box"><span class="meta-label">Price Change</span><span class="meta-value ${changeClass}">${formatChangeAsProbability(market.priceChange)}</span></div>
        <div class="meta-box"><span class="meta-label">Percent Change</span><span class="meta-value ${changeClass}">${formatPercentChange(market.percentChange)}</span></div>
      </div>

      <div class="market-footer">
        <span class="market-small">24h Vol: ${formatMoney(market.volume24hr)}</span>
        <a class="market-link" href="${market.url}" target="_blank" rel="noopener noreferrer">Open Market</a>
      </div>
    </article>
  `;
}

function applyHotFilters() {
  const container = document.getElementById("hotMarkets");
  if (!container) return;

  const minVolume = Number(document.getElementById("minVolume")?.value) || 0;
  const minPrice = Number(document.getElementById("minPrice")?.value) || 0;
  const maxPrice = Number(document.getElementById("maxPrice")?.value) || 1;

  const filtered = hotMarketsCache.filter(
    (market) =>
      market.volume24hr >= minVolume &&
      market.yesPriceLive >= minPrice &&
      market.yesPriceLive <= maxPrice
  );

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty">No markets match your filters.</p>`;
    return;
  }

  container.innerHTML = filtered.map(renderHotCard).join("");
  bindTradeActionButtons();
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

async function handleQuoteTrade(marketId, side) {
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
      return;
    }

    renderTradeExecutionResult(renderSignedOrderSubmitResult(response.data, false));
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
    btn.onclick = () => handleQuoteTrade(btn.dataset.marketId, btn.dataset.side);
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

  if (fillAddressBtn) {
    fillAddressBtn.onclick = fillUserAuthAddressFromConnectedWallet;
  }

  if (clearFieldsBtn) {
    clearFieldsBtn.onclick = handleClearUserAuthFields;
  }

  if (applyAuthJsonBtn) {
    applyAuthJsonBtn.onclick = handleApplyUserAuthJsonToFields;
  }

  if (signBtn && !signBtn.disabled) {
    signBtn.onclick = handleSignPreparedOrder;
  }

  if (submitBtn && !submitBtn.disabled) {
    submitBtn.onclick = handleSubmitSignedOrderHandoff;
  }

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

async function loadAlerts() {
  const container = document.getElementById("alertsPanel");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading alerts...</p>`;

  try {
    const res = await fetch("/api/alerts");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.alerts)) throw new Error("Invalid alerts response");

    if (data.alerts.length === 0) {
      container.innerHTML = `<p class="empty">No priority alerts right now.</p>`;
      return;
    }

    container.innerHTML = data.alerts.map(renderAlertItem).join("");
  } catch (err) {
    console.error("Alerts load error:", err);
    container.innerHTML = `<p class="empty">Failed to load alerts.</p>`;
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
  const container = document.getElementById("topOpportunities");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading opportunities...</p>`;

  try {
    const res = await fetch("/api/liveMarkets");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.markets)) {
      throw new Error("Invalid opportunities response");
    }

    const ranked = data.markets
      .slice()
      .sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0))
      .slice(0, 6);

    if (ranked.length === 0) {
      container.innerHTML = `<p class="empty">No opportunities found.</p>`;
      return;
    }

    container.innerHTML = ranked.map(renderHotCard).join("");
    bindTradeActionButtons();
  } catch (err) {
    console.error("Top opportunities load error:", err);
    container.innerHTML = `<p class="empty">Failed to load opportunities.</p>`;
  }
}

async function loadHotMarkets() {
  const container = document.getElementById("hotMarkets");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading hot markets...</p>`;

  try {
    const res = await fetch("/api/liveMarkets");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.markets)) {
      throw new Error("Invalid hot markets response");
    }

    if (data.markets.length === 0) {
      hotMarketsCache = [];
      container.innerHTML = `<p class="empty">No hot markets found.</p>`;
      return;
    }

    hotMarketsCache = data.markets;
    applyHotFilters();
  } catch (err) {
    console.error("Hot markets load error:", err);
    container.innerHTML = `<p class="empty">Failed to load hot markets.</p>`;
  }
}

async function loadBiggestMovers() {
  const container = document.getElementById("biggestMovers");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading biggest movers...</p>`;

  try {
    const res = await fetch("/api/biggestMovers");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.markets)) {
      throw new Error("Invalid biggest movers response");
    }

    if (data.markets.length === 0) {
      container.innerHTML = `<p class="empty">Mover data is warming up. Check back shortly.</p>`;
      return;
    }

    container.innerHTML = data.markets.map(renderMoverCard).join("");
  } catch (err) {
    console.error("Biggest movers load error:", err);
    container.innerHTML = `<p class="empty">Failed to load biggest movers.</p>`;
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

  if (refreshAlerts) refreshAlerts.addEventListener("click", loadAlerts);
  if (refreshOpp) refreshOpp.addEventListener("click", loadTopOpportunities);
  if (refreshHot) refreshHot.addEventListener("click", loadHotMarkets);
  if (refreshMovers) refreshMovers.addEventListener("click", loadBiggestMovers);
  if (refreshSignals) refreshSignals.addEventListener("click", loadSignalLog);
  if (refreshPerformance) refreshPerformance.addEventListener("click", loadPerformanceStats);
  if (refreshPaperPortfolio) refreshPaperPortfolio.addEventListener("click", loadPaperPortfolio);
  if (refreshAccount) refreshAccount.addEventListener("click", loadAccountState);
  if (applyBtn) applyBtn.addEventListener("click", applyHotFilters);

  setupBrowserWalletEventSync();

  await beginCleanPublicLoad();

  renderTradeTicketPanel();
  renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);

  await loadAccountState();
  await loadAlerts();
  await loadPerformanceStats();
  await loadPaperPortfolio();
  await loadSignalLog();
  await loadTopOpportunities();
  await loadHotMarkets();
  await loadBiggestMovers();

  setInterval(loadAccountState, 60000);
  setInterval(loadAlerts, 60000);
  setInterval(loadPerformanceStats, 60000);
  setInterval(loadPaperPortfolio, 60000);
  setInterval(loadSignalLog, 60000);
  setInterval(loadTopOpportunities, 60000);
  setInterval(loadHotMarkets, 60000);
  setInterval(loadBiggestMovers, 60000);
});