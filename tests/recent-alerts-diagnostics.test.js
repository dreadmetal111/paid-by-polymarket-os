import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const sourceArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--source="));
const sourcePath = path.resolve(
  sourceArgument?.slice("--source=".length) ||
    process.env.RECENT_ALERTS_SOURCE ||
    path.join(TEST_DIR, "..", "server.js")
);
const serverSource = readFileSync(sourcePath, "utf8");

function extractFunction(name) {
  const declaration = new RegExp(
    `^(?:async\\s+)?function\\s+${name}\\s*\\(`,
    "m"
  ).exec(serverSource);

  if (!declaration) return "";

  const rest = serverSource.slice(declaration.index + declaration[0].length);
  const nextDeclaration = /^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m.exec(rest);
  const end = nextDeclaration
    ? declaration.index + declaration[0].length + nextDeclaration.index
    : serverSource.length;

  return serverSource.slice(declaration.index, end).trim();
}

function extractConst(name) {
  const declaration = new RegExp(`^const\\s+${name}\\s*=`, "m").exec(serverSource);

  if (!declaration) return "";

  const terminator = serverSource.indexOf(";", declaration.index);
  assert.notEqual(terminator, -1, `unterminated const ${name} in ${sourcePath}`);
  return serverSource.slice(declaration.index, terminator + 1).trim();
}

function extractRecentAlertsRoute() {
  const start = serverSource.indexOf('app.get("/api/alerts/recent"');
  const nextRoute = serverSource.indexOf(
    'app.post("/api/internal/capture-market-snapshots"',
    start
  );

  assert.notEqual(start, -1, `recent-alert route missing in ${sourcePath}`);
  assert.notEqual(nextRoute, -1, `recent-alert route terminator missing in ${sourcePath}`);
  return serverSource.slice(start, nextRoute).trim();
}

function createHarness() {
  const state = {
    fetchImplementation: null,
    handler: null,
    jsonParse: JSON.parse,
    logs: [],
    provider: {
      storageMode: "supabase",
      config: {
        enabled: true,
        supabaseUrl: "https://synthetic-private-host.invalid/private-path",
        serviceRoleKey: "SYNTHETIC_PRIVATE_SERVICE_KEY",
        table: "alert_signals",
      },
    },
    providerError: null,
    requests: [],
  };

  const syntheticJson = {
    parse(text) {
      return state.jsonParse(text);
    },
    stringify: JSON.stringify,
  };

  const context = vm.createContext({
    Array,
    Date,
    Error,
    JSON: syntheticJson,
    Object,
    Set,
    String,
    URL,
    app: {
      get(route, handler) {
        if (route === "/api/alerts/recent") state.handler = handler;
      },
    },
    console: {
      error(...values) {
        state.logs.push(values);
      },
    },
    fetch(...arguments_) {
      state.requests.push(arguments_);
      return state.fetchImplementation(...arguments_);
    },
    getActiveAlertSignalStorageProvider() {
      if (state.providerError) throw state.providerError;
      return state.provider;
    },
    getSupabaseAlertSignalConfig() {
      return state.provider.config;
    },
  });

  const constants = [
    "PUBLIC_ALERT_SIGNAL_LIMIT",
    "RECENT_ALERT_READ_FAILURE_CODES",
    "RECENT_ALERT_READ_FAILURE_CODE_SET",
  ]
    .map(extractConst)
    .filter(Boolean);
  const functions = [
    "redactSensitivePublicText",
    "sanitizePublicAlertText",
    "sanitizeOptionalPublicAlertText",
    "normalizeAlertType",
    "normalizeAlertSeverity",
    "normalizeAlertSource",
    "toPublicAlertSignal",
    "getSupabaseTargetInfo",
    "buildSupabaseTableUrl",
    "getSupabaseHeaders",
    "fetchSupabaseJson",
    "mapSupabaseAlertSignalRow",
    "createRecentAlertReadFailure",
    "getRecentAlertReadFailureCode",
    "discardRecentAlertResponseBody",
    "fetchRecentAlertSignalRows",
    "readRecentSupabaseAlertSignals",
    "readRecentAlertSignals",
  ]
    .map(extractFunction)
    .filter(Boolean);

  const executableSource = [
    ...constants,
    ...functions,
    extractRecentAlertsRoute(),
    "globalThis.__recentAlerts = { readRecentAlertSignals, readRecentSupabaseAlertSignals };",
  ].join("\n\n");

  new vm.Script(executableSource, {
    filename: `${sourcePath}:recent-alerts-guarded-vm`,
  }).runInContext(context, { timeout: 1_000 });

  assert.equal(typeof state.handler, "function", "recent-alert handler was not captured");

  function reset() {
    state.fetchImplementation = async () => {
      throw new Error("SYNTHETIC_FETCH_NOT_CONFIGURED");
    };
    state.jsonParse = JSON.parse;
    state.logs.length = 0;
    state.provider = {
      storageMode: "supabase",
      config: {
        enabled: true,
        supabaseUrl: "https://synthetic-private-host.invalid/private-path",
        serviceRoleKey: "SYNTHETIC_PRIVATE_SERVICE_KEY",
        table: "alert_signals",
      },
    };
    state.providerError = null;
    state.requests.length = 0;
  }

  async function invoke() {
    const result = {
      body: undefined,
      headers: {},
      status: 200,
    };
    const response = {
      json(body) {
        result.body = body;
        return response;
      },
      set(name, value) {
        result.headers[name] = value;
        return response;
      },
      status(statusCode) {
        result.status = statusCode;
        return response;
      },
    };

    await state.handler({}, response);
    return result;
  }

  reset();
  return { context, invoke, reset, state };
}

function stringifyLogs(logs) {
  return logs
    .flat()
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return "[unserializable]";
      }
    })
    .join(" ");
}

function jsonResponse(payload) {
  return {
    ok: true,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("executes the checked-in query, sanitation, filtering, and public projection", async () => {
  const harness = createHarness();
  const createdAt = "2026-06-20T12:00:00.000Z";
  harness.state.fetchImplementation = async () =>
    jsonResponse([
      {
        alert_type: " Volume Spike! ",
        market_question: "  Will   the market move?  ",
        reason: " Fast   change ",
        severity: " HIGH ",
        source: "private-worker-source",
        created_at: createdAt,
        event_id: `pbp_${"a".repeat(40)}`,
        payload_fingerprint: "b".repeat(64),
        protocol_version: 2,
        source_event_at: createdAt,
      },
      {
        alert_type: "",
        market_question: "filtered invalid row",
        reason: null,
        severity: null,
        source: "private-worker-source",
        created_at: createdAt,
      },
    ]);

  const result = await harness.invoke();

  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.alerts)), [
    {
      alertType: "volume_spike",
      marketQuestion: "Will the market move?",
      reason: "Fast change",
      severity: "high",
      createdAt,
    },
  ]);
  assert.equal(harness.state.requests.length, 1);

  const [requestUrl, requestOptions] = harness.state.requests[0];
  assert.equal(requestUrl.pathname, "/rest/v1/alert_signals");
  assert.equal(
    requestUrl.searchParams.get("select"),
    "alert_type,market_question,reason,severity,source,created_at"
  );
  assert.equal(requestUrl.searchParams.get("order"), "created_at.desc");
  assert.equal(requestUrl.searchParams.get("limit"), "5");
  assert.equal(requestOptions.method, undefined);
  assert.equal(requestOptions.body, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(requestOptions.headers)), {
    apikey: "SYNTHETIC_PRIVATE_SERVICE_KEY",
    Authorization: "Bearer SYNTHETIC_PRIVATE_SERVICE_KEY",
  });
});

test("preserves a genuine empty-array success and not-configured behavior", async () => {
  const harness = createHarness();
  harness.state.fetchImplementation = async () => jsonResponse([]);

  const emptyResult = await harness.invoke();
  assert.equal(emptyResult.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(emptyResult.body.alerts)), []);

  harness.reset();
  harness.state.provider = { storageMode: "not_configured", config: {} };
  const notConfiguredResult = await harness.invoke();
  assert.equal(notConfiguredResult.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(notConfiguredResult.body.alerts)), []);
  assert.equal(harness.state.requests.length, 0);
});

test("classifies every read stage without leaking private diagnostics", async (t) => {
  const marker = "SYNTHETIC_PRIVATE_MARKER_DO_NOT_LEAK";
  const scenarios = [
    {
      code: "query_setup",
      arrange(harness) {
        harness.state.provider.config.supabaseUrl = `not-a-url-${marker}`;
      },
    },
    {
      code: "query_rejected",
      arrange(harness, observation) {
        harness.state.fetchImplementation = async () => ({
          ok: false,
          body: {
            async cancel() {
              observation.cancelCount += 1;
              throw new Error(marker);
            },
          },
          async text() {
            observation.textCount += 1;
            return JSON.stringify({ message: marker });
          },
        });
      },
      verify(observation) {
        assert.equal(observation.cancelCount, 1);
        assert.equal(observation.textCount, 0);
      },
    },
    {
      code: "transport",
      arrange(harness) {
        harness.state.fetchImplementation = async () => {
          const error = new Error(marker);
          error.cause = { code: marker, host: marker };
          throw error;
        };
      },
    },
    {
      code: "body_read",
      arrange(harness) {
        harness.state.fetchImplementation = async () => ({
          ok: true,
          async text() {
            throw new Error(marker);
          },
        });
      },
    },
    {
      code: "parse",
      arrange(harness) {
        harness.state.fetchImplementation = async () => ({
          ok: true,
          async text() {
            return `{${marker}`;
          },
        });
      },
    },
    {
      code: "shape",
      arrange(harness) {
        harness.state.fetchImplementation = async () =>
          jsonResponse({ privateValue: marker });
      },
    },
    {
      code: "mapping",
      arrange(harness) {
        harness.state.jsonParse = () => [
          new Proxy(
            {},
            {
              get() {
                throw new Error(marker);
              },
            }
          ),
        ];
        harness.state.fetchImplementation = async () => jsonResponse([]);
      },
    },
    {
      code: "unknown",
      arrange(harness) {
        harness.state.providerError = new Error(marker);
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.code, async () => {
      const harness = createHarness();
      const observation = { cancelCount: 0, textCount: 0 };
      scenario.arrange(harness, observation);

      const result = await harness.invoke();
      const publicFailure = JSON.stringify(result.body);
      const loggedFailure = stringifyLogs(harness.state.logs);

      assert.equal(result.status, 500);
      assert.deepEqual(JSON.parse(publicFailure), {
        ok: false,
        error: "Failed to load recent alert signals.",
        code: scenario.code,
      });
      assert.match(loggedFailure, new RegExp(`recent_read_failed:${scenario.code}$`));
      assert.doesNotMatch(publicFailure, /SYNTHETIC_PRIVATE/);
      assert.doesNotMatch(loggedFailure, /SYNTHETIC_PRIVATE/);
      assert.doesNotMatch(loggedFailure, /synthetic-private-host|private-path/i);
      scenario.verify?.(observation);
    });
  }
});

test("reads an untrusted provider error code once and only emits fixed failures", async (t) => {
  const marker = "SYNTHETIC_PRIVATE_PROVIDER_CODE_DO_NOT_LEAK";
  const scenarios = [
    {
      name: "throwing code getter",
      code: "unknown",
      createError(observation) {
        const error = new Error(marker);
        Object.defineProperty(error, "code", {
          get() {
            observation.codeReadCount += 1;
            throw new Error(marker);
          },
        });
        return error;
      },
    },
    {
      name: "changing code getter",
      code: "transport",
      createError(observation) {
        const error = new Error(marker);
        Object.defineProperty(error, "code", {
          get() {
            observation.codeReadCount += 1;
            return observation.codeReadCount === 1 ? "transport" : marker;
          },
        });
        return error;
      },
    },
    {
      name: "invalid arbitrary private code",
      code: "unknown",
      createError(observation) {
        const error = new Error(marker);
        Object.defineProperty(error, "code", {
          get() {
            observation.codeReadCount += 1;
            return marker;
          },
        });
        return error;
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const harness = createHarness();
      const observation = { codeReadCount: 0 };
      harness.state.providerError = scenario.createError(observation);

      const result = await harness.invoke();
      const publicFailure = JSON.stringify(result.body);
      const loggedFailure = stringifyLogs(harness.state.logs);

      assert.equal(observation.codeReadCount, 1);
      assert.equal(result.status, 500);
      assert.deepEqual(JSON.parse(publicFailure), {
        ok: false,
        error: "Failed to load recent alert signals.",
        code: scenario.code,
      });
      assert.equal(harness.state.logs.length, 1);
      assert.deepEqual([...harness.state.logs[0]], [
        `[alert-signals] recent_read_failed:${scenario.code}`,
      ]);
      assert.doesNotMatch(publicFailure, /SYNTHETIC_PRIVATE/);
      assert.doesNotMatch(loggedFailure, /SYNTHETIC_PRIVATE/);
    });
  }
});
