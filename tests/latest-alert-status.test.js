import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(TEST_DIR, "..", "public", "app.js");
const appSource = readFileSync(sourcePath, "utf8");

function extractFunction(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:async\\s+)?function\\s+${escapedName}\\s*\\(`).exec(appSource);
  assert.ok(match, `Expected ${name} in ${sourcePath}`);

  const remainder = appSource.slice(match.index);
  const end = /\r?\n}\r?(?:\n|$)/.exec(remainder);
  assert.ok(end, `Could not extract ${name} from ${sourcePath}`);
  return remainder.slice(0, end.index + end[0].indexOf("}") + 1);
}

const runtimeSource = [
  "escapeHtml",
  "getLatestAlertSignalsElements",
  "captureLatestAlertSignalsFallback",
  "restoreLatestAlertSignalsFallback",
  "getAlertTypeLabel",
  "getAlertSeverityClass",
  "getLatestAlertPublicationMeta",
  "formatLatestAlertTimestamp",
  "normalizeLatestAlertSignal",
  "renderLatestAlertSignalCard",
  "loadLatestAlertSignals",
  "updateMarketIntelligenceStrip",
].map(extractFunction).join("\n\n");

class FakeElement {
  constructor({ classes = [], html = "", text = "" } = {}) {
    this.innerHTML = html;
    this.textContent = text;
    const values = new Set(classes);
    this.classList = {
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
      contains: (name) => values.has(name),
    };
  }
}

function response(payload, { ok = true, jsonError = null } = {}) {
  return {
    ok,
    async json() {
      if (jsonError) throw jsonError;
      return payload;
    },
  };
}

function createHarness({ now = "2026-10-21T12:00:00.000Z" } = {}) {
  let nowMs = Date.parse(now);
  const fallbackHtml = '<div data-example="true">Static labeled example</div>';
  const elements = new Map([
    ["pbpLatestAlertSignalsList", new FakeElement({ html: fallbackHtml })],
    ["pbpLatestAlertSignalsBadge", new FakeElement({ classes: ["signal", "soft"] })],
    ["pbpLatestAlertSignalsStatus", new FakeElement()],
    ["marketIntelLiveCount", new FakeElement()],
    ["marketIntelEventCount", new FakeElement()],
    ["marketIntelLatestSignal", new FakeElement({ text: "Loading" })],
  ]);
  const state = {
    deadlines: [],
    fetches: [],
    fetchImplementation: async () => response({ ok: true, alerts: [] }),
    warnings: [],
  };

  class SyntheticDate extends Date {
    constructor(...args) {
      super(args.length ? args[0] : nowMs);
    }

    static now() {
      return nowMs;
    }
  }

  const window = {
    setTimeout(callback, delay) {
      const timer = { callback, cleared: false, delay };
      state.deadlines.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
  };
  const sandbox = {
    AbortController,
    Date: SyntheticDate,
    Error,
    Intl,
    Number,
    Promise,
    String,
    console: {
      warn(...args) {
        state.warnings.push(args);
      },
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
    fetch(...args) {
      state.fetches.push(args);
      return state.fetchImplementation(...args);
    },
    window,
  };
  sandbox.globalThis = sandbox;

  const declarations = `
    const PBP_LATEST_ALERT_SIGNALS_LIMIT = 3;
    const PBP_ALERT_TYPE_LABELS = {
      new_high_volume: "New high-activity market",
      probability_movement: "Market movement",
      volume_liquidity_spike: "Volume/liquidity spike",
    };
    let latestAlertSignalsFallbackHtml = "";
    let latestAlertSignalTimestamp = "";
    let latestAlertSignalsLastCheckedAt = "";
    let liveMarketsCache = [];
    function isDiscoveryQualityMarket() { return true; }
    function getActiveGroupedEventCount() { return 0; }
  `;
  sandbox.__state = state;
  const context = vm.createContext(sandbox);
  vm.runInContext(`${declarations}\n${runtimeSource}`, context, { filename: sourcePath });

  return {
    context,
    elements,
    fallbackHtml,
    state,
    setNow(value) {
      nowMs = Date.parse(value);
    },
    load() {
      return vm.runInContext("loadLatestAlertSignals()", context);
    },
    timestamps() {
      return vm.runInContext(
        "({ latestAlertSignalTimestamp, latestAlertSignalsLastCheckedAt })",
        context
      );
    },
  };
}

function alertAt(createdAt, marketQuestion = "Will this test market move?") {
  return {
    alertType: "probability_movement",
    marketQuestion,
    reason: "YES moved 4 points.",
    severity: "medium",
    createdAt,
  };
}

test("shows a loading state while the saved-alert request is pending", async () => {
  const harness = createHarness();
  let resolveFetch;
  harness.state.fetchImplementation = () => new Promise((resolve) => {
    resolveFetch = resolve;
  });

  const loading = harness.load();
  assert.equal(harness.elements.get("pbpLatestAlertSignalsBadge").textContent, "Checking saved alerts");
  assert.equal(
    harness.elements.get("pbpLatestAlertSignalsStatus").textContent,
    "Checking saved alerts. Example alerts shown below."
  );
  assert.equal(harness.elements.get("pbpLatestAlertSignalsList").innerHTML, harness.fallbackHtml);

  resolveFetch(response({ ok: true, alerts: [] }));
  await loading;
});

test("historical saved rows keep publication time separate from the successful check", async () => {
  const harness = createHarness();
  harness.state.fetchImplementation = async () => response({
    ok: true,
    alerts: [alertAt("2020-01-02T03:04:00.000Z")],
  });

  await harness.load();

  const badge = harness.elements.get("pbpLatestAlertSignalsBadge");
  const status = harness.elements.get("pbpLatestAlertSignalsStatus").textContent;
  assert.equal(badge.textContent, "Stored alerts loaded");
  assert.equal(badge.classList.contains("live"), false);
  assert.match(status, /Latest publication:/);
  assert.match(status, /Last successful check:/);
  assert.match(status, /These are saved alerts\.$/);
  assert.match(harness.elements.get("marketIntelLatestSignal").textContent, /^Published /);
  assert.deepEqual({ ...harness.timestamps() }, {
    latestAlertSignalTimestamp: "2020-01-02T03:04:00.000Z",
    latestAlertSignalsLastCheckedAt: "2026-10-21T12:00:00.000Z",
  });
});

test("current saved rows render safely without making a liveness claim", async () => {
  const harness = createHarness();
  harness.state.fetchImplementation = async () => response({
    ok: true,
    alerts: [alertAt(
      "2026-10-21T11:59:00.000Z",
      '<img src=x onerror="globalThis.compromised=true">'
    )],
  });

  await harness.load();

  const html = harness.elements.get("pbpLatestAlertSignalsList").innerHTML;
  const badge = harness.elements.get("pbpLatestAlertSignalsBadge");
  assert.match(html, /Published/);
  assert.match(html, /&lt;img src=x onerror=&quot;/);
  assert.doesNotMatch(html, /<img/);
  assert.equal(vm.runInContext("globalThis.compromised", harness.context), undefined);
  assert.equal(badge.classList.contains("live"), false);
  assert.doesNotMatch(
    `${badge.textContent} ${harness.elements.get("pbpLatestAlertSignalsStatus").textContent}`,
    /live alerts active|healthy|worker|feed/i
  );
});

test("a valid empty response is quiet, successful, and restores labeled examples", async () => {
  const harness = createHarness();

  await harness.load();

  assert.equal(harness.elements.get("pbpLatestAlertSignalsList").innerHTML, harness.fallbackHtml);
  assert.equal(harness.elements.get("pbpLatestAlertSignalsBadge").classList.contains("live"), false);
  assert.equal(
    harness.elements.get("pbpLatestAlertSignalsStatus").textContent,
    "No saved alerts returned. Example alerts shown below."
  );
  assert.equal(harness.elements.get("marketIntelLatestSignal").textContent, "Not available");
  assert.equal(harness.timestamps().latestAlertSignalsLastCheckedAt, "2026-10-21T12:00:00.000Z");
});

test("HTTP, JSON, and response-shape failures are unavailable states", async (t) => {
  const scenarios = [
    ["HTTP failure", async () => response(null, { ok: false })],
    ["malformed JSON", async () => response(null, { jsonError: new SyntaxError("bad json") })],
    ["non-array alerts", async () => response({ ok: true, alerts: {} })],
    ["malformed alert row", async () => response({ ok: true, alerts: [{ reason: "missing question" }] })],
  ];

  for (const [name, fetchImplementation] of scenarios) {
    await t.test(name, async () => {
      const harness = createHarness();
      harness.state.fetchImplementation = fetchImplementation;

      await harness.load();

      const badge = harness.elements.get("pbpLatestAlertSignalsBadge");
      assert.equal(badge.textContent, "Saved alerts unavailable");
      assert.equal(badge.classList.contains("live"), false);
      assert.equal(harness.elements.get("pbpLatestAlertSignalsList").innerHTML, harness.fallbackHtml);
      assert.match(
        harness.elements.get("pbpLatestAlertSignalsStatus").textContent,
        /^Could not load saved alerts\. Example alerts shown below\. Last attempt: .+\.$/
      );
      assert.equal(harness.elements.get("marketIntelLatestSignal").textContent, "Not available");
      assert.equal(harness.timestamps().latestAlertSignalsLastCheckedAt, "");
    });
  }
});

test("invalid and future timestamps never become the latest publication", async () => {
  const harness = createHarness();
  harness.state.fetchImplementation = async () => response({
    ok: true,
    alerts: [
      alertAt("not-a-date", "Invalid timestamp"),
      alertAt("2099-01-01T00:00:00.000Z", "Future timestamp"),
    ],
  });

  await harness.load();

  const html = harness.elements.get("pbpLatestAlertSignalsList").innerHTML;
  assert.match(html, /Publication time unavailable/);
  assert.match(html, /Publication time is in the future \(unverified\)/);
  assert.equal(harness.timestamps().latestAlertSignalTimestamp, "");
  assert.match(harness.elements.get("pbpLatestAlertSignalsStatus").textContent, /Latest publication: unavailable/);
  assert.equal(harness.elements.get("marketIntelLatestSignal").textContent, "Not available");
});

test("impossible, coercible, zoneless, and invalid time or offset values stay unavailable everywhere", async (t) => {
  const scenarios = [
    ["February 30", "2024-02-30T10:00:00Z"],
    ["non-leap February 29", "2023-02-29T10:00:00Z"],
    ["numeric timestamp", 1792576800000],
    ["boolean timestamp", true],
    ["invalid hour", "2024-02-29T24:00:00Z"],
    ["invalid offset hour", "2024-02-29T10:00:00+24:00"],
    ["invalid offset minute", "2024-02-29T10:00:00+00:60"],
    ["missing timezone", "2024-02-29T10:00:00"],
  ];

  for (const [name, createdAt] of scenarios) {
    await t.test(name, async () => {
      const harness = createHarness();
      harness.state.fetchImplementation = async () => response({
        ok: true,
        alerts: [alertAt(createdAt, `${name} row`)],
      });

      await harness.load();

      const html = harness.elements.get("pbpLatestAlertSignalsList").innerHTML;
      assert.ok(html.toLowerCase().includes(`${name} row`.toLowerCase()));
      assert.match(html, /Publication time unavailable/);
      assert.equal(harness.timestamps().latestAlertSignalTimestamp, "");
      assert.equal(harness.elements.get("marketIntelLatestSignal").textContent, "Not available");
      assert.match(
        harness.elements.get("pbpLatestAlertSignalsStatus").textContent,
        /^Latest publication: unavailable/
      );
    });
  }
});

test("valid leap-day and Supabase microsecond UTC forms populate cards and the summary strip", async (t) => {
  const scenarios = [
    ["leap-day Z", "2024-02-29T10:11:12Z"],
    ["microsecond +00:00", "2026-10-21T11:59:00.123456+00:00"],
  ];

  for (const [name, createdAt] of scenarios) {
    await t.test(name, async () => {
      const harness = createHarness();
      harness.state.fetchImplementation = async () => response({
        ok: true,
        alerts: [alertAt(createdAt, `${name} row`)],
      });

      await harness.load();

      const html = harness.elements.get("pbpLatestAlertSignalsList").innerHTML;
      assert.ok(html.toLowerCase().includes(`${name} row`.toLowerCase()));
      assert.match(html, /Published/);
      assert.doesNotMatch(html, /Publication time unavailable|unverified/);
      assert.equal(harness.timestamps().latestAlertSignalTimestamp, createdAt);
      assert.match(harness.elements.get("marketIntelLatestSignal").textContent, /^Published /);
      assert.match(
        harness.elements.get("pbpLatestAlertSignalsStatus").textContent,
        /Last successful check: .* These are saved alerts\.$/
      );
    });
  }
});

test("mixed invalid and current valid rows select the latest genuine publication", async () => {
  const harness = createHarness();
  harness.state.fetchImplementation = async () => response({
    ok: true,
    alerts: [
      alertAt("2026-02-30T11:59:59Z", "Impossible newest-looking row"),
      alertAt("2020-01-02T03:04:00Z", "Older valid row"),
      alertAt("2026-10-21T11:59:00.654321+00:00", "Current valid row"),
    ],
  });

  await harness.load();

  const html = harness.elements.get("pbpLatestAlertSignalsList").innerHTML;
  assert.match(html, /Impossible newest-looking row[\s\S]*Publication time unavailable|Publication time unavailable[\s\S]*Impossible newest-looking row/);
  assert.match(html, /Current valid row/);
  assert.deepEqual({ ...harness.timestamps() }, {
    latestAlertSignalTimestamp: "2026-10-21T11:59:00.654321+00:00",
    latestAlertSignalsLastCheckedAt: "2026-10-21T12:00:00.000Z",
  });
  assert.match(harness.elements.get("marketIntelLatestSignal").textContent, /^Published /);
  assert.doesNotMatch(harness.elements.get("marketIntelLatestSignal").textContent, /unavailable|unverified/i);
});

test("success to error to success clears stale state and recovers", async () => {
  const harness = createHarness();
  const results = [
    response({ ok: true, alerts: [alertAt("2020-01-01T00:00:00.000Z", "First saved row")] }),
    response(null, { ok: false }),
    response({ ok: true, alerts: [alertAt("2025-05-06T07:08:00.000Z", "Recovered saved row")] }),
  ];
  harness.state.fetchImplementation = async () => results.shift();

  await harness.load();
  assert.match(harness.elements.get("pbpLatestAlertSignalsList").innerHTML, /First saved row/);

  harness.setNow("2026-10-21T12:01:00.000Z");
  await harness.load();
  assert.equal(harness.elements.get("pbpLatestAlertSignalsList").innerHTML, harness.fallbackHtml);
  assert.doesNotMatch(harness.elements.get("pbpLatestAlertSignalsStatus").textContent, /Last successful check/);

  harness.setNow("2026-10-21T12:02:00.000Z");
  await harness.load();
  assert.match(harness.elements.get("pbpLatestAlertSignalsList").innerHTML, /Recovered saved row/);
  assert.doesNotMatch(harness.elements.get("pbpLatestAlertSignalsList").innerHTML, /First saved row/);
  assert.equal(harness.elements.get("pbpLatestAlertSignalsBadge").textContent, "Stored alerts loaded");
  assert.equal(harness.timestamps().latestAlertSignalsLastCheckedAt, "2026-10-21T12:02:00.000Z");
});

test("the finite deadline covers hung fetch and body reads", async (t) => {
  const scenarios = [
    ["fetch", () => new Promise(() => {})],
    ["response body", async () => ({ ok: true, json: () => new Promise(() => {}) })],
  ];

  for (const [name, implementation] of scenarios) {
    await t.test(name, async () => {
      const harness = createHarness();
      let requestSignal;
      harness.state.fetchImplementation = (_url, options) => {
        requestSignal = options.signal;
        return implementation();
      };

      const loading = harness.load();
      await Promise.resolve();
      assert.equal(harness.state.deadlines.length, 1);
      assert.equal(harness.state.deadlines[0].delay, 8000);
      harness.state.deadlines[0].callback();
      await loading;

      assert.equal(requestSignal.aborted, true);
      assert.equal(harness.elements.get("pbpLatestAlertSignalsBadge").textContent, "Saved alerts unavailable");
      assert.equal(harness.elements.get("pbpLatestAlertSignalsList").innerHTML, harness.fallbackHtml);
    });
  }
});
