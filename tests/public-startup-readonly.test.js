import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// To exercise another app.js without changing the checkout:
// PUBLIC_STARTUP_SOURCE=/path/to/app.js node --test tests/public-startup-readonly.test.js
// node --test tests/public-startup-readonly.test.js -- --source=/path/to/app.js
const sourceArgument = process.argv.find((argument) => argument.startsWith("--source="));
const defaultSourcePath = fileURLToPath(new URL("../public/app.js", import.meta.url));
const sourcePath = path.resolve(
  process.env.PUBLIC_STARTUP_SOURCE || sourceArgument?.slice("--source=".length) || defaultSourcePath
);
const appSource = fs.readFileSync(sourcePath, "utf8");

function extractFunction(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:async\\s+)?function\\s+${escapedName}\\s*\\(`).exec(appSource);
  assert.ok(match, `Expected ${name} in ${sourcePath}`);

  const remainder = appSource.slice(match.index);
  const end = /\r?\n}\r?(?:\n|$)/.exec(remainder);
  assert.ok(end, `Could not extract ${name} from ${sourcePath}`);
  return remainder.slice(0, end.index + end[0].indexOf("}") + 1);
}

function extractDomReadyRegistration() {
  const marker = 'document.addEventListener("DOMContentLoaded", async () => {';
  const start = appSource.indexOf(marker);
  assert.notEqual(start, -1, `Expected the DOMContentLoaded registration in ${sourcePath}`);
  return appSource.slice(start).trim();
}

const runtimeSource = [
  extractFunction("createEmptyUserAuthDraft"),
  extractFunction("resetUserAuthDraft"),
  extractFunction("clearBrowserDemoState"),
  extractFunction("resetFrontendDemoUiState"),
  extractFunction("beginCleanPublicLoad"),
  extractFunction("loadPublicConfig"),
  extractFunction("getLatestAlertSignalsElements"),
  extractFunction("captureLatestAlertSignalsFallback"),
  extractFunction("restoreLatestAlertSignalsFallback"),
  extractFunction("loadLatestAlertSignals"),
  extractFunction("loadHomepageDiscoveryData"),
  extractFunction("getAlertsRenderTargets"),
  extractFunction("setAlertsRenderTargets"),
  extractFunction("loadAlerts"),
  extractFunction("loadSignalLog"),
  extractFunction("loadPerformanceStats"),
  extractFunction("loadAccountState"),
  extractFunction("loadPaperPortfolio"),
  extractFunction("loadBiggestMovers"),
  extractFunction("hasBrowserWalletProvider"),
  extractFunction("setupBrowserWalletEventSync"),
  extractDomReadyRegistration(),
].join("\n\n");

class FakeElement {
  constructor(id, value = "") {
    this.id = id;
    this.value = value;
    this.innerHTML = id === "pbpLatestAlertSignalsList" ? "<p>Static alert example</p>" : "";
    this.textContent = "";
    this.listeners = [];
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    };
  }

  addEventListener(type, handler) {
    this.listeners.push({ type, handler });
  }
}

const elementIds = [
  "tradeModeSelect",
  "tradeTicketSize",
  "minVolume",
  "minPrice",
  "maxPrice",
  "refreshAlerts",
  "refreshOpportunities",
  "refreshHot",
  "refreshMovers",
  "refreshSignals",
  "refreshPerformance",
  "refreshPaperPortfolio",
  "refreshAccount",
  "applyFilters",
  "pbpLatestAlertSignalsList",
  "pbpLatestAlertSignalsBadge",
  "extraDiscoveryAlerts",
  "alertsPanel",
  "discoverPrimaryResults",
  "signalLogPanel",
  "performanceStatsPanel",
  "accountStatePanel",
  "accountControlsPanel",
  "paperPortfolioStatsPanel",
  "paperPortfolioControlsPanel",
  "openPositionsPanel",
  "closedPositionsPanel",
];

const demoStorageKeys = [
  "pbp_currentTradeTicket",
  "pbp_currentLivePreparation",
  "pbp_demo_state",
  "paidByPolymarket_demo_state",
];

function responseDataFor(url) {
  const responses = {
    "/api/public-config": { discordInviteEnabled: false },
    "/api/alerts/recent": { ok: true, alerts: [] },
    "/api/alerts": { ok: true, alerts: [] },
    "/api/liveMarkets": { ok: true, markets: [], lastRefreshedAt: "2026-10-10T00:00:00.000Z" },
    "/api/biggestMovers": { ok: true, markets: [] },
    "/api/account-state": { ok: true, account: {} },
    "/api/performance-stats": { ok: true, stats: {} },
    "/api/paper-portfolio": { ok: true, positions: [], stats: {} },
    "/api/signal-log": { ok: true, signals: [] },
  };
  assert.ok(Object.hasOwn(responses, url), `Unexpected GET ${url}`);
  return responses[url];
}

function createHarness({ debug = false, storageThrows = false } = {}) {
  const records = {
    fetches: [],
    mutations: [],
    localRemovals: [],
    sessionRemovals: [],
    intervals: [],
    windowListeners: [],
    walletListeners: [],
    bindings: [],
    renders: [],
    consoleErrors: [],
    consoleWarnings: [],
    domReady: null,
  };
  const elements = new Map(elementIds.map((id) => [id, new FakeElement(id, "stale")]));

  const storage = (target) => ({
    removeItem(key) {
      records[target].push(key);
      if (storageThrows) throw new Error("storage unavailable");
    },
  });

  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    addEventListener(type, handler) {
      if (type === "DOMContentLoaded") {
        assert.equal(records.domReady, null, "DOMContentLoaded registered more than once");
        records.domReady = handler;
      }
    },
  };

  const window = {
    localStorage: storage("localRemovals"),
    sessionStorage: storage("sessionRemovals"),
    addEventListener(type, handler) {
      records.windowListeners.push({ type, handler });
    },
    ethereum: {
      on(type, handler) {
        records.walletListeners.push({ type, handler });
      },
      request(details) {
        records.mutations.push({ transport: "wallet", details });
        throw new Error("Wallet requests are forbidden during startup");
      },
    },
  };

  const fetch = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    if (method !== "GET") {
      records.mutations.push({ transport: "fetch", url, method });
      throw new Error(`Mutation attempt: ${method} ${url}`);
    }
    records.fetches.push({ url, method });
    const data = responseDataFor(url);
    return { ok: true, json: async () => data };
  };

  class GuardedXMLHttpRequest {
    open(method, url) {
      this.method = method;
      this.url = url;
    }

    send() {
      records.mutations.push({ transport: "XMLHttpRequest", method: this.method, url: this.url });
      throw new Error("XMLHttpRequest is forbidden during startup");
    }
  }

  const sandbox = {
    console: {
      error(...args) {
        records.consoleErrors.push(args);
      },
      warn(...args) {
        records.consoleWarnings.push(args);
      },
      log() {},
    },
    document,
    window,
    navigator: {
      sendBeacon(url) {
        records.mutations.push({ transport: "sendBeacon", url });
        return false;
      },
    },
    fetch,
    XMLHttpRequest: GuardedXMLHttpRequest,
    setInterval(callback, delay) {
      records.intervals.push({ callback, delay });
      return records.intervals.length;
    },
    clearInterval() {},
    __records: records,
  };
  sandbox.globalThis = sandbox;
  window.fetch = fetch;
  window.XMLHttpRequest = GuardedXMLHttpRequest;
  window.navigator = sandbox.navigator;

  const context = vm.createContext(sandbox);
  const declarations = `
    const PBP_LATEST_ALERT_SIGNALS_LIMIT = 3;
    const PBP_PUBLIC_BETA_DEBUG_MODE = ${debug};
    let hotMarketsCache = ["stale"];
    let liveMarketsCache = ["stale"];
    let biggestMoversCache = ["stale"];
    let lastHomepageDiscoveryRefreshAt = "stale";
    let activeHomepageCategory = "SPORTS";
    let currentTopLevelView = "account";
    let currentDiscoverView = "movers";
    let activeMarketDetailId = "";
    let currentEventSlug = "";
    let currentTradeTicket = { stale: true };
    let currentLivePreparation = { stale: true };
    let currentClientSignedOrder = { stale: true };
    let accountStateCache = { stale: true };
    let walletConnectionSource = "BROWSER";
    let browserWalletEventsBound = false;
    let currentUserAuthDraft = { address: "stale", apiKey: "stale" };
    let latestAlertSignalsFallbackHtml = "";
    let latestAlertSignalTimestamp = "stale";
    let publicConfig = {};

    function clearUserAuthInlineStatus() { __records.renders.push("clearUserAuthInlineStatus"); }
    function renderTradeTicketPanel() { __records.renders.push("renderTradeTicketPanel"); }
    function renderTradeExecutionResult() { __records.renders.push("renderTradeExecutionResult"); }
    function updateMarketIntelligenceStrip() { __records.renders.push("updateMarketIntelligenceStrip"); }
    function ensureHomepageStrategyLayer() { __records.renders.push("ensureHomepageStrategyLayer"); }
    function setHomepageDiscoveryLoadingState() { __records.renders.push("setHomepageDiscoveryLoadingState"); }
    function renderHomepageCategoryChipRail() { __records.renders.push("renderHomepageCategoryChipRail"); }
    function renderDiscoverPrimaryView() { __records.renders.push("renderDiscoverPrimaryView"); }
    function renderRequestedMarketFromUrl() { return false; }
    function renderRequestedEventFromUrl() { return false; }
    function getMarketByDetailId() { return null; }
    function renderMarketDetailDrawer() { __records.renders.push("renderMarketDetailDrawer"); }
    function applyTopLevelView() { __records.renders.push("applyTopLevelView"); }
    function renderEventDetailView() { __records.renders.push("renderEventDetailView"); }
    function renderAlertItem() { return ""; }
    function renderSignalLogItem() { return ""; }
    function renderPerformanceStats() { return ""; }
    function renderAccountPanel() { return ""; }
    function renderAccountControls() { return ""; }
    function bindAccountControls() { __records.bindings.push("bindAccountControls"); }
    function renderPaperPortfolioStats() { return ""; }
    function renderManualTradeControls() { return ""; }
    function renderResetControls() { return ""; }
    function renderPaperPositionItem() { return ""; }
    function bindDynamicPortfolioControls() { __records.bindings.push("bindDynamicPortfolioControls"); }
    function applyHotFilters() { __records.bindings.push("applyHotFilters:invoked"); }
    function getRequestedMarketId() { return ""; }
    function getRequestedEventSlug() { return ""; }
    function activateAlertsPageRoute() { __records.renders.push("activateAlertsPageRoute"); }
    function setTopLevelView() { __records.renders.push("setTopLevelView"); }
    function handleBrowserWalletAccountsChanged() { __records.mutations.push({ transport: "wallet-handler", name: "accountsChanged" }); }
    function handleBrowserWalletChainChanged() { __records.mutations.push({ transport: "wallet-handler", name: "chainChanged" }); }
    function handleBrowserWalletConnect() { __records.mutations.push({ transport: "action", name: "connect" }); }
    function handleConnectAccount() { __records.mutations.push({ transport: "action", name: "connect-account" }); }
    function handleDisconnectAccount() { __records.mutations.push({ transport: "action", name: "disconnect-account" }); }
    function syncAppAccountFromWalletAddress() { __records.mutations.push({ transport: "action", name: "sync-account" }); }
    function clearAppWalletConnection() { __records.mutations.push({ transport: "action", name: "clear-account" }); }
    function handleSignPreparedOrder() { __records.mutations.push({ transport: "action", name: "sign" }); }
    function handleSubmitSignedOrderHandoff() { __records.mutations.push({ transport: "action", name: "trade" }); }
    function handleQuoteTrade() { __records.mutations.push({ transport: "action", name: "quote" }); }
    function handleExecutePaperTrade() { __records.mutations.push({ transport: "action", name: "paper-trade" }); }
    function handlePrepareLiveTrade() { __records.mutations.push({ transport: "action", name: "live-trade" }); }
    function handleResetPaperPortfolio() { __records.mutations.push({ transport: "action", name: "global-reset" }); }
    async function postJson(url, body) {
      __records.mutations.push({ transport: "postJson", url, body });
      throw new Error("postJson is forbidden during startup");
    }
    async function postJsonDetailed(url, body) {
      __records.mutations.push({ transport: "postJsonDetailed", url, body });
      throw new Error("postJsonDetailed is forbidden during startup");
    }
    ${[
      "bindAlertsWaitlistForm",
      "bindBetaFeedbackForm",
      "bindOutboundClickTracking",
      "bindWatchlistInterestTracking",
      "bindMarketPageLinks",
      "bindPublicTopDiscoveryTabs",
      "bindMarketDetailGlobalControls",
      "ensureTopLevelTabs",
      "hideLegacyDiscoverSections",
    ].map((name) => `function ${name}() { __records.bindings.push("${name}"); }`).join("\n")}
  `;

  vm.runInContext(`${declarations}\n${runtimeSource}`, context, { filename: sourcePath });
  assert.equal(typeof records.domReady, "function", "DOMContentLoaded must remain registered");

  return { context, elements, records };
}

function snapshotState(context) {
  return JSON.parse(vm.runInContext(`JSON.stringify({
    hotMarketsCache,
    liveMarketsCache,
    biggestMoversCache,
    lastHomepageDiscoveryRefreshAt,
    activeHomepageCategory,
    currentTopLevelView,
    currentDiscoverView,
    currentTradeTicket,
    currentLivePreparation,
    currentClientSignedOrder,
    accountStateCache,
    walletConnectionSource,
    currentUserAuthDraft
  })`, context));
}

function assertCleanPublicState(context, elements, expectedRefreshAt = "") {
  assert.equal(elements.get("tradeModeSelect").value, "PAPER");
  for (const id of ["tradeTicketSize", "minVolume", "minPrice", "maxPrice"]) {
    assert.equal(elements.get(id).value, "");
  }
  assert.deepEqual(snapshotState(context), {
    hotMarketsCache: [],
    liveMarketsCache: [],
    biggestMoversCache: [],
    lastHomepageDiscoveryRefreshAt: expectedRefreshAt,
    activeHomepageCategory: "ALL",
    currentTopLevelView: "discover",
    currentDiscoverView: "opportunities",
    currentTradeTicket: null,
    currentLivePreparation: null,
    currentClientSignedOrder: null,
    accountStateCache: null,
    walletConnectionSource: "NONE",
    currentUserAuthDraft: {
      address: "",
      apiKey: "",
      secret: "",
      passphrase: "",
      rawJson: "",
      lockEmptyAddress: false,
    },
  });
}

function assertNoSourceLoaderErrors(records) {
  assert.deepEqual(
    records.consoleErrors,
    [],
    `Unexpected console.error calls (warnings: ${JSON.stringify(records.consoleWarnings)})`
  );
}

function assertStartupRegistrations(elements, records) {
  for (const id of [
    "refreshAlerts",
    "refreshOpportunities",
    "refreshHot",
    "refreshMovers",
    "refreshSignals",
    "refreshPerformance",
    "refreshPaperPortfolio",
    "refreshAccount",
    "applyFilters",
  ]) {
    assert.equal(elements.get(id).listeners.filter(({ type }) => type === "click").length, 1, `${id} click handler`);
  }
  assert.deepEqual(records.walletListeners.map(({ type }) => type), ["accountsChanged", "chainChanged"]);
  assert.deepEqual(records.windowListeners.map(({ type }) => type), ["popstate"]);
  assert.ok(!records.bindings.includes("applyHotFilters:invoked"));
}

test("beginCleanPublicLoad performs only the intended local reset", async () => {
  const { context, elements, records } = createHarness();

  await vm.runInContext("beginCleanPublicLoad()", context);

  assert.deepEqual(records.localRemovals, demoStorageKeys);
  assert.deepEqual(records.sessionRemovals, demoStorageKeys);
  assert.deepEqual(records.fetches, []);
  assert.deepEqual(records.mutations, []);
  assertCleanPublicState(context, elements);
  assert.ok(records.renders.includes("renderTradeTicketPanel"));
  assert.ok(records.renders.includes("renderTradeExecutionResult"));
});

test("storage failures are tolerated without falling back to a server mutation", async () => {
  const { context, elements, records } = createHarness({ storageThrows: true });

  await vm.runInContext("beginCleanPublicLoad()", context);

  assert.deepEqual(records.localRemovals, ["pbp_currentTradeTicket"]);
  assert.deepEqual(records.sessionRemovals, ["pbp_currentTradeTicket"]);
  assert.deepEqual(records.mutations, []);
  assert.deepEqual(records.fetches, []);
  assert.equal(elements.get("tradeModeSelect").value, "PAPER");
  assert.equal(snapshotState(context).currentTradeTicket, null);
});

test("ordinary non-debug DOM startup performs real cleanup and remains read-only", async () => {
  const { context, elements, records } = createHarness();

  await records.domReady();

  assert.deepEqual(records.localRemovals, demoStorageKeys);
  assert.deepEqual(records.sessionRemovals, demoStorageKeys);
  assertCleanPublicState(context, elements, "2026-10-10T00:00:00.000Z");
  assert.deepEqual(records.fetches.map(({ url }) => url), [
    "/api/public-config",
    "/api/alerts/recent",
    "/api/alerts",
    "/api/liveMarkets",
    "/api/biggestMovers",
  ]);
  assert.ok(records.fetches.every(({ method }) => method === "GET"));
  assert.deepEqual(records.mutations, []);
  assert.equal(records.intervals.length, 4);
  assert.ok(records.intervals.every(({ delay }) => delay === 60000));
  assert.equal(records.intervals[0].callback, vm.runInContext("loadLatestAlertSignals", context));
  assert.equal(records.intervals[1].callback, vm.runInContext("loadAlerts", context));
  assert.equal(records.intervals[3].callback, vm.runInContext("loadBiggestMovers", context));
  assertStartupRegistrations(elements, records);
  assertNoSourceLoaderErrors(records);
});

test("normal DOM startup awaits clean load before continuing preserved GET loaders", async () => {
  const { context, elements, records } = createHarness();
  vm.runInContext(`
    currentDiscoverView = "opportunities";
    beginCleanPublicLoad = () => new Promise((resolve) => {
      globalThis.releaseCleanPublicLoad = resolve;
    });
  `, context);

  const initialization = records.domReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(records.fetches.map(({ url }) => url), ["/api/public-config"]);

  vm.runInContext("releaseCleanPublicLoad()", context);
  await initialization;

  assert.deepEqual(records.fetches.map(({ url }) => url), [
    "/api/public-config",
    "/api/alerts/recent",
    "/api/alerts",
    "/api/liveMarkets",
    "/api/biggestMovers",
  ]);
  assert.ok(records.fetches.every(({ method }) => method === "GET"));
  assert.deepEqual(records.mutations, []);
  assert.equal(records.intervals.length, 4);
  assert.ok(records.intervals.every(({ delay }) => delay === 60000));
  assert.equal(records.intervals[0].callback, vm.runInContext("loadLatestAlertSignals", context));
  assert.equal(records.intervals[1].callback, vm.runInContext("loadAlerts", context));
  assert.equal(records.intervals[3].callback, vm.runInContext("loadBiggestMovers", context));
  assertStartupRegistrations(elements, records);
  assertNoSourceLoaderErrors(records);
});

test("debug and repeated DOM startup remain read-only while retaining every GET loader", async () => {
  const { records } = createHarness({ debug: true });

  await records.domReady();
  await records.domReady();

  const expectedOnePass = [
    "/api/public-config",
    "/api/alerts/recent",
    "/api/alerts",
    "/api/liveMarkets",
    "/api/biggestMovers",
    "/api/account-state",
    "/api/performance-stats",
    "/api/paper-portfolio",
    "/api/signal-log",
  ];
  assert.deepEqual(records.fetches.map(({ url }) => url), [...expectedOnePass, ...expectedOnePass]);
  assert.ok(records.fetches.every(({ method }) => method === "GET"));
  assert.deepEqual(records.localRemovals, [...demoStorageKeys, ...demoStorageKeys]);
  assert.deepEqual(records.sessionRemovals, [...demoStorageKeys, ...demoStorageKeys]);
  assert.deepEqual(records.mutations, []);
  assert.equal(records.intervals.length, 16);
  assert.ok(records.intervals.every(({ delay }) => delay === 60000));
  assert.ok(!records.bindings.includes("applyHotFilters:invoked"));
  assertNoSourceLoaderErrors(records);
});
