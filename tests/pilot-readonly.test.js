import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PILOT_SOURCE = fs.readFileSync(path.join(ROOT, "public", "pilot.js"), "utf8");

const REQUIRED_IDS = [
  "refreshButton", "categoryFilters", "marketResults", "marketStatus", "marketRetention",
  "marketDataTime", "marketCheckTime", "alertResults", "alertStatus", "alertRetention",
  "alertDataTime", "alertCheckTime", "detailBackdrop", "marketDetail", "detailClose",
  "detailCategory", "detailEvent", "detailTitle", "detailMetrics", "detailWhy", "detailTime",
];

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  write(values) {
    this.element.className = Array.from(new Set(values)).join(" ");
  }

  add(...names) {
    this.write([...this.values(), ...names]);
  }

  remove(...names) {
    this.write(this.values().filter((value) => !names.includes(value)));
  }

  contains(name) {
    return this.values().includes(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.contains(name) : !!force;
    if (shouldAdd) this.add(name);
    else this.remove(name);
    return shouldAdd;
  }
}

class FakeNode {
  constructor(tagName, documentRef, text = "") {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = documentRef;
    this.parentNode = null;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.className = "";
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.type = "";
    this.id = "";
    this._text = text;
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node) continue;
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    this._text = "";
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }

  click() {
    this.dispatchEvent({ type: "click", target: this, preventDefault() {} });
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument {
  constructor() {
    this.readyState = "complete";
    this.activeElement = null;
    this.byId = new Map();
    this.listeners = new Map();
    this.body = new FakeNode("body", this);
    for (const id of REQUIRED_IDS) {
      const tag = id.includes("Button") || id === "detailClose" ? "button" : "div";
      const element = new FakeNode(tag, this);
      element.id = id;
      if (id === "detailBackdrop") element.hidden = true;
      this.byId.set(id, element);
      this.body.append(element);
    }
  }

  getElementById(id) {
    return this.byId.get(id) || null;
  }

  createElement(tagName) {
    return new FakeNode(tagName, this);
  }

  createTextNode(text) {
    return new FakeNode("#text", this, String(text));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }
}

function walk(node) {
  return [node, ...node.children.flatMap(walk)];
}

function byClass(root, className) {
  return walk(root).filter((node) => node.classList.contains(className));
}

function buttonWithText(root, text) {
  return walk(root).find((node) => node.tagName === "BUTTON" && node.textContent === text);
}

function response(payload, ok = true) {
  return { ok, json: async () => payload };
}

function market(overrides = {}) {
  return {
    id: "market-1",
    question: "Will the example outcome happen?",
    displayCategory: "Politics",
    eventTitle: "Example event",
    yesProbability: 62.5,
    movement: 4.25,
    volume24hr: 250000,
    liquidity: 80000,
    lastUpdated: "2025-01-03T12:00:00.000Z",
    ...overrides,
  };
}

function livePriceMarket(overrides = {}) {
  const item = market({
    id: "market-live-price",
    question: "Will the live-price example happen?",
    yesPriceLive: 0.34,
    oneDayPriceChange: 0.02,
    ...overrides,
  });
  delete item.yesProbability;
  delete item.movement;
  return item;
}

function alertRecord(overrides = {}) {
  return {
    alertType: "price_move",
    marketQuestion: "Did this market move?",
    reason: "The stored rule observed a notable price move.",
    severity: "medium",
    createdAt: "2025-01-03T12:05:00.000Z",
    ...overrides,
  };
}

function payloads(overrides = {}) {
  return {
    markets: {
      ok: true,
      markets: [market()],
      lastRefreshedAt: "2025-01-03T12:00:00.000Z",
    },
    alerts: {
      ok: true,
      alerts: [alertRecord()],
      generatedAt: "2025-01-03T12:06:00.000Z",
    },
    ...overrides,
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function boot(fetchImpl, options = {}) {
  const document = new FakeDocument();
  const delays = [];
  const context = {
    document,
    fetch: fetchImpl,
    AbortController,
    Date,
    Intl,
    URLSearchParams,
    location: { search: options.search || "" },
    navigator: { sendBeacon() { throw new Error("beacon must not be called"); } },
    setTimeout(callback, delay) {
      delays.push(delay);
      return options.clock ? options.clock.setTimeout(callback, delay) : setTimeout(callback, delay);
    },
    clearTimeout: options.clock ? options.clock.clearTimeout : clearTimeout,
    addEventListener() {},
  };
  Object.defineProperty(context, "localStorage", {
    get() { throw new Error("storage must not be read"); },
  });
  Object.defineProperty(context, "ethereum", {
    get() { throw new Error("wallet must not be read"); },
  });
  vm.createContext(context);
  vm.runInContext(PILOT_SOURCE, context, { filename: "public/pilot.js" });
  return { context, document, delays };
}

test("startup uses only the two same-origin GET endpoints with bounded privacy-safe requests", async () => {
  const calls = [];
  const data = payloads();
  const { document, delays } = boot(async (url, init) => {
    calls.push({ url, init });
    return response(url === "/api/liveMarkets" ? data.markets : data.alerts);
  }, { search: "?debug=1&endpoint=https://evil.example" });

  await settle();

  assert.deepEqual(calls.map((call) => call.url).sort(), ["/api/alerts/recent", "/api/liveMarkets"]);
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.match(url, /^\/api\/(?:liveMarkets|alerts\/recent)$/);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.deepEqual({ ...init.headers }, { Accept: "application/json" });
    assert.ok(init.signal);
  }
  assert.deepEqual(delays, [8000, 8000]);
  assert.match(document.getElementById("marketStatus").textContent, /latest successful check/);
  assert.match(document.getElementById("alertStatus").textContent, /latest successful check/);
});

test("refresh keeps independent failure state and labels retained markets last-known", async () => {
  const initial = payloads();
  let marketCalls = 0;
  let alertCalls = 0;
  let rejectMarketRefresh;
  let resolveAlertRefresh;
  const marketRefresh = new Promise((_, reject) => { rejectMarketRefresh = reject; });
  const alertRefresh = new Promise((resolve) => { resolveAlertRefresh = resolve; });

  const { document } = boot((url) => {
    if (url === "/api/liveMarkets") {
      marketCalls += 1;
      return marketCalls === 1 ? Promise.resolve(response(initial.markets)) : marketRefresh;
    }
    alertCalls += 1;
    return alertCalls === 1 ? Promise.resolve(response(initial.alerts)) : alertRefresh;
  });
  await settle();

  document.getElementById("refreshButton").click();
  assert.equal(document.getElementById("marketRetention").hidden, false);
  assert.match(document.getElementById("marketStatus").textContent, /last-known until/);
  assert.equal(document.getElementById("alertRetention").hidden, false);

  rejectMarketRefresh(new Error("offline"));
  resolveAlertRefresh(response({
    ok: true,
    alerts: [alertRecord({ marketQuestion: "New saved alert" })],
    generatedAt: "2025-01-04T12:00:00.000Z",
  }));
  await settle();

  assert.match(document.getElementById("marketStatus").textContent, /refresh failed/i);
  assert.equal(document.getElementById("marketRetention").hidden, false);
  assert.match(document.getElementById("marketResults").textContent, /Will the example outcome happen/);
  assert.match(document.getElementById("alertResults").textContent, /New saved alert/);
  assert.equal(document.getElementById("alertRetention").hidden, true);
  assert.doesNotMatch(document.getElementById("alertStatus").textContent, /failed/i);
});

test("rendering respects percent-unit probability, missing values, safe text, empty alerts, and timestamp limits", async () => {
  const hostile = '<img src=x onerror="sendBeacon()"> Will this render as text?';
  const { document } = boot(async (url) => response(url === "/api/liveMarkets" ? {
    ok: true,
    markets: [
      market({ question: hostile, yesProbability: 62.5, movement: 3.5 }),
      livePriceMarket(),
      market({ id: "market-2", question: "Missing probability", yesProbability: null, yesPriceLive: 0.91, volume24hr: null, liquidity: null }),
    ],
    lastRefreshedAt: "9999-01-01T00:00:00.000Z",
  } : {
    ok: true,
    alerts: [],
    generatedAt: "not-a-timestamp",
  }));
  await settle();

  const marketResults = document.getElementById("marketResults");
  assert.match(marketResults.textContent, /62\.5%/);
  assert.doesNotMatch(marketResults.textContent, /6250/);
  assert.match(marketResults.textContent, /live-price example happen[\s\S]*34\.0%/);
  assert.match(marketResults.textContent, /\+2\.00 pts/);
  assert.match(marketResults.textContent, /Missing probabilityUnavailable/);
  assert.match(marketResults.textContent, /\+3\.50 pts/);
  assert.match(marketResults.textContent, new RegExp(hostile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(walk(marketResults).some((node) => node.tagName === "IMG"), false);
  assert.match(document.getElementById("alertResults").textContent, /No saved alerts were returned/);
  assert.equal(document.getElementById("marketDataTime").textContent, "Unavailable");
  assert.equal(document.getElementById("alertDataTime").textContent, "Unavailable");
  assert.notEqual(document.getElementById("marketCheckTime").textContent, "Unavailable");
  assert.notEqual(document.getElementById("alertCheckTime").textContent, "Unavailable");
});

test("invalid alert times and absent saved reasons are labeled unavailable rather than invented", async () => {
  const data = payloads({
    alerts: {
      ok: true,
      alerts: [alertRecord({ reason: null, createdAt: "9999-01-01T00:00:00.000Z" })],
      generatedAt: "2025-01-03T12:06:00.000Z",
    },
  });
  const { document } = boot(async (url) => response(url === "/api/liveMarkets" ? data.markets : data.alerts));
  await settle();

  assert.match(document.getElementById("alertResults").textContent, /Alert time: Unavailable/);
  assert.match(document.getElementById("alertResults").textContent, /Reason unavailable in saved record/);
});

test("malformed market leaves fail only markets while category and detail interactions remain keyboard usable on valid data", async (t) => {
  await t.test("a malformed numeric leaf does not become zero or disturb alerts", async () => {
    const { document } = boot(async (url) => response(url === "/api/liveMarkets" ? {
      ok: true,
      markets: [market({ yesProbability: "0" })],
      lastRefreshedAt: "2025-01-03T12:00:00.000Z",
    } : payloads().alerts));
    await settle();

    assert.match(document.getElementById("marketStatus").textContent, /unavailable/i);
    assert.doesNotMatch(document.getElementById("marketResults").textContent, /0\.0%/);
    assert.match(document.getElementById("alertResults").textContent, /Did this market move/);
  });

  await t.test("actual categories filter and return to All; Escape closes details and restores focus", async () => {
    const { document } = boot(async (url) => response(url === "/api/liveMarkets" ? {
      ok: true,
      markets: [
        market(),
        market({ id: "market-2", question: "Will the crypto example happen?", displayCategory: "Crypto" }),
      ],
      lastRefreshedAt: "2025-01-03T12:00:00.000Z",
    } : payloads().alerts));
    await settle();

    const filters = document.getElementById("categoryFilters");
    buttonWithText(filters, "Politics").click();
    assert.equal(byClass(document.getElementById("marketResults"), "market-card").length, 1);
    assert.match(document.getElementById("marketResults").textContent, /example outcome/);

    buttonWithText(filters, "All").click();
    assert.equal(byClass(document.getElementById("marketResults"), "market-card").length, 2);

    const trigger = buttonWithText(document.getElementById("marketResults"), "Review details");
    trigger.click();
    assert.equal(document.getElementById("detailBackdrop").hidden, false);
    assert.equal(document.activeElement, document.getElementById("detailClose"));
    assert.match(document.getElementById("detailWhy").textContent, /reported market activity/);

    document.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() {} });
    assert.equal(document.getElementById("detailBackdrop").hidden, true);
    assert.equal(document.activeElement, trigger);
  });
});


function controlledClock() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(callback, delay) {
      const id = next++;
      pending.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, item] of Array.from(pending)) {
        if (item.due <= now) { pending.delete(id); item.callback(); }
      }
    },
    pendingCount() { return pending.size; },
  };
}

test("lifetime volume never fills a missing 24-hour metric in cards or details", async () => {
  const item = market({ volume: 987654321 });
  delete item.volume24hr;
  const data = payloads({ markets: { ok: true, markets: [item] } });
  const { document } = boot(async (url) => response(url === "/api/liveMarkets" ? data.markets : data.alerts));
  await settle();
  const cards = document.getElementById("marketResults");
  assert.doesNotMatch(cards.textContent, /987/);
  const metric = walk(cards).find((n) => n.children.length === 2 && n.children[0].textContent === "24h volume");
  assert.equal(metric.children[1].textContent, "Unavailable");
  buttonWithText(cards, "Review details").click();
  const dialog = document.getElementById("detailMetrics");
  assert.doesNotMatch(dialog.textContent, /987/);
  assert.equal(dialog.children.find((n) => n.children[0].textContent === "24h volume").children[1].textContent, "Unavailable");
  assert.doesNotMatch(document.getElementById("detailWhy").textContent, /24-hour volume/);
});

test("the display cap reports shown versus returned markets", async () => {
  const markets = Array.from({ length: 70 }, (_, i) => market({ id: "sample-" + i }));
  const { document } = boot(async (url) => response(url === "/api/liveMarkets" ? { ok: true, markets } : payloads().alerts));
  await settle();
  assert.equal(byClass(document.getElementById("marketResults"), "market-card").length, 60);
  assert.match(document.getElementById("marketStatus").textContent, /first 60 of 70 returned/);
  assert.match(document.getElementById("marketStatus").textContent, /shown sample/);
});

test("refresh closes old detail snapshots and retained dialogs state their context", async () => {
  let calls = 0;
  let rejectRefresh;
  const pending = new Promise((_, reject) => { rejectRefresh = reject; });
  const { document } = boot((url) => {
    if (url !== "/api/liveMarkets") return Promise.resolve(response(payloads().alerts));
    return ++calls === 1 ? Promise.resolve(response(payloads().markets)) : pending;
  });
  await settle();
  const open = () => buttonWithText(document.getElementById("marketResults"), "Review details").click();
  open();
  assert.equal(document.getElementById("detailBackdrop").hidden, false);
  document.getElementById("refreshButton").click();
  assert.equal(document.getElementById("detailBackdrop").hidden, true);
  open();
  assert.match(document.getElementById("detailEvent").textContent, /Refresh in progress: last-known/);
  rejectRefresh(new Error("offline fixture"));
  await settle();
  assert.equal(document.getElementById("detailBackdrop").hidden, true);
  assert.equal(document.activeElement, document.getElementById("refreshButton"));
  open();
  assert.match(document.getElementById("detailEvent").textContent, /Last-known market data: latest market refresh failed/);
});

test("a hanging market response times out at 8 seconds while alerts succeed and late data is ignored", async () => {
  const clock = controlledClock();
  let resolveLate;
  let marketSignal;
  let calls = 0;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  const { document, delays } = boot((url, init) => {
    calls++;
    if (url === "/api/liveMarkets") { marketSignal = init.signal; return late; }
    return Promise.resolve(response(payloads().alerts));
  }, { clock });
  await settle();
  assert.match(document.getElementById("alertStatus").textContent, /1 saved alert/);
  clock.advance(7999);
  await settle();
  assert.equal(marketSignal.aborted, false);
  assert.equal(document.getElementById("refreshButton").disabled, true);
  clock.advance(1);
  await settle();
  assert.equal(marketSignal.aborted, true);
  assert.match(document.getElementById("marketStatus").textContent, /unavailable/);
  assert.equal(document.getElementById("refreshButton").disabled, false);
  assert.equal(clock.pendingCount(), 0);
  resolveLate(response(payloads().markets));
  await settle();
  assert.equal(byClass(document.getElementById("marketResults"), "market-card").length, 0);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [8000, 8000]);
});

test("a hanging JSON body retains honest last-known data after timeout and ignores late completion", async () => {
  const clock = controlledClock();
  let calls = 0;
  let bodyResolve;
  let signal;
  const body = new Promise((resolve) => { bodyResolve = resolve; });
  const { document } = boot((url, init) => {
    if (url !== "/api/liveMarkets") return Promise.resolve(response(payloads().alerts));
    calls++;
    if (calls === 1) return Promise.resolve(response(payloads().markets));
    signal = init.signal;
    return Promise.resolve({ ok: true, json: () => body });
  }, { clock });
  await settle();
  document.getElementById("refreshButton").click();
  await settle();
  assert.match(document.getElementById("marketStatus").textContent, /last-known/);
  clock.advance(8000);
  await settle();
  assert.equal(signal.aborted, true);
  assert.match(document.getElementById("marketStatus").textContent, /refresh failed/);
  assert.equal(document.getElementById("marketRetention").hidden, false);
  bodyResolve({ ok: true, markets: [market({ question: "LATE REPLACEMENT MUST NOT APPEAR" })] });
  await settle();
  assert.doesNotMatch(document.getElementById("marketResults").textContent, /LATE REPLACEMENT/);
  assert.match(document.getElementById("marketResults").textContent, /example outcome/);
  assert.match(document.getElementById("alertStatus").textContent, /saved alert/);
  assert.equal(clock.pendingCount(), 0);
});
