import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  AlertDeliveryV2Error,
  fingerprintAlertDeliveryV2,
  storeAlertDeliveryV2,
  validateAlertDeliveryV2,
} from "../alert-delivery-v2.js";

const NOW = new Date("2026-10-14T01:10:00.000Z");
const CONFIG = {
  enabled: true,
  supabaseUrl: "https://example.supabase.invalid",
  serviceRoleKey: "synthetic-test-key",
  table: "alert_signals",
};

function makePayload(overrides = {}) {
  const payload = {
    alertType: "probability_movement",
    eventId: `pbp_${"a".repeat(40)}`,
    expiresAt: "2026-10-14T01:20:00Z",
    marketQuestion: "Will the example happen?",
    reason: "Probability moved by 8 points.",
    schemaVersion: 2,
    severity: "high",
    source: "acer-alert-worker",
    sourceEventAt: "2026-10-14T01:05:00Z",
    ...overrides,
  };
  payload.fingerprint = fingerprintAlertDeliveryV2(payload);
  return payload;
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function extractFunction(source, name) {
  const declaration = new RegExp(`^function\\s+${name}\\s*\\(`, "m").exec(source);
  assert.ok(declaration, `missing ${name} in server.js`);
  const rest = source.slice(declaration.index + declaration[0].length);
  const nextDeclaration = /^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m.exec(rest);
  const end = nextDeclaration
    ? declaration.index + declaration[0].length + nextDeclaration.index
    : source.length;
  return source.slice(declaration.index, end).trim();
}

function createAlertRouteHarness() {
  const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const routeStart = serverSource.indexOf('app.post("/api/internal/alerts"');
  const routeEnd = serverSource.indexOf('app.get("/start"', routeStart);
  assert.notEqual(routeStart, -1);
  assert.notEqual(routeEnd, -1);

  const state = {
    handler: null,
    legacyCalls: 0,
    logs: [],
    storeCalls: [],
    storeResult: { status: "created" },
  };
  const environment = {
    PBP_ALERT_INGEST_SECRET: "synthetic-ingest-secret",
    PBP_ALERT_INGEST_V2_ENABLED: "true",
  };
  Object.defineProperty(state, "admitted", {
    get() {
      return Object.hasOwn(environment, "PBP_ALERT_INGEST_V2_ENABLED");
    },
    set(value) {
      if (value) environment.PBP_ALERT_INGEST_V2_ENABLED = "true";
      else delete environment.PBP_ALERT_INGEST_V2_ENABLED;
    },
  });
  const context = vm.createContext({
    AlertDeliveryV2Error,
    Buffer,
    Object,
    String,
    console: { error: (...values) => state.logs.push(values) },
    crypto,
    process: { env: environment },
    app: {
      post(route, handler) {
        if (route === "/api/internal/alerts") state.handler = handler;
      },
    },
    getSupabaseAlertSignalConfig() {
      return CONFIG;
    },
    validateAlertDeliveryV2,
    async storeAlertDeliveryV2(arguments_) {
      state.storeCalls.push(arguments_);
      return state.storeResult;
    },
    normalizeAlertSignalInput(value) {
      state.legacyCalls += 1;
      return value;
    },
    async addAlertSignal(alertSignal) {
      return { storageMode: "synthetic", alertSignal };
    },
    logAlertSignalStorageMode() {},
    toPublicAlertSignal(value) {
      return value;
    },
  });
  const executableSource = [
    extractFunction(serverSource, "envFirst"),
    extractFunction(serverSource, "envFlag"),
    extractFunction(serverSource, "getAlertDeliveryV2Config"),
    extractFunction(serverSource, "getAlertIngestSecret"),
    extractFunction(serverSource, "getProvidedBearerToken"),
    extractFunction(serverSource, "secretsMatch"),
    extractFunction(serverSource, "authorizeAlertIngestRequest"),
    serverSource.slice(routeStart, routeEnd).trim(),
  ].join("\n\n");
  new vm.Script(executableSource, { filename: "server.js:alert-v2-route-vm" })
    .runInContext(context, { timeout: 1_000 });
  assert.equal(typeof state.handler, "function");

  async function invoke(body, token = "synthetic-ingest-secret") {
    const result = { body: undefined, status: 200 };
    const request = {
      body,
      get(name) {
        return name.toLowerCase() === "authorization" && token
          ? `Bearer ${token}`
          : "";
      },
    };
    const response_ = {
      json(value) {
        result.body = value;
        return response_;
      },
      status(value) {
        result.status = value;
        return response_;
      },
    };
    await state.handler(request, response_);
    return result;
  }

  return { invoke, state };
}

async function expectDeliveryError(promise, code, status) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AlertDeliveryV2Error);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test("validation accepts a canonical guarded event and rejects tampering", () => {
  const payload = makePayload();
  assert.equal(validateAlertDeliveryV2(payload, { now: NOW }).eventId, payload.eventId);

  assert.throws(
    () => validateAlertDeliveryV2({ ...payload, reason: "changed" }, { now: NOW }),
    (error) => error.code === "fingerprint_mismatch" && error.status === 409
  );
});

test("validation rejects expired, malformed calendar, and future timestamps", () => {
  assert.throws(
    () => validateAlertDeliveryV2(makePayload({ expiresAt: "2026-10-14T01:09:59Z" }), { now: NOW }),
    (error) => error.code === "expired" && error.status === 410
  );
  assert.throws(
    () => validateAlertDeliveryV2(makePayload({ sourceEventAt: "2026-02-30T01:05:00Z" }), { now: NOW }),
    (error) => error.code === "invalid_timestamp"
  );
  for (const sourceEventAt of [
    "2025-02-29T01:05:00Z",
    "2026-13-01T01:05:00Z",
    "2026-10-14T24:00:00Z",
  ]) {
    assert.throws(
      () => validateAlertDeliveryV2(makePayload({ sourceEventAt }), { now: NOW }),
      (error) => error.code === "invalid_timestamp"
    );
  }
  assert.doesNotThrow(() => validateAlertDeliveryV2(makePayload({
    sourceEventAt: "2024-02-29T01:05:00.1Z",
    expiresAt: "2024-02-29T01:20:00.100Z",
  }), { now: new Date("2024-02-29T01:10:00Z") }));
  assert.throws(
    () => validateAlertDeliveryV2(makePayload({
      sourceEventAt: "2026-10-14T01:12:00Z",
      expiresAt: "2026-10-14T01:20:00Z",
    }), { now: NOW }),
    (error) => error.code === "future_timestamp"
  );
});

test("canonical fingerprint matches the worker Unicode fixture", () => {
  const payload = {
    alertType: "probability_movement",
    eventId: `pbp_${"d".repeat(40)}`,
    expiresAt: "2026-10-14T01:20:00Z",
    marketQuestion: "Will “café” win? Soon",
    reason: 'Line "one" Line café',
    schemaVersion: 2,
    severity: "high",
    source: "acer-alert-worker",
    sourceEventAt: "2026-10-14T01:05:00Z",
  };
  assert.equal(
    fingerprintAlertDeliveryV2(payload),
    "12d0ee6c295a4e6c63a611ac560eab2a919a786cf6e040f546dae4602927d1d5"
  );
});

test("successful insert requires the durable row identity in the response", async () => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });
  const requests = [];
  const result = await storeAlertDeliveryV2({
    payload,
    config: CONFIG,
    async fetchImplementation(url, options) {
      requests.push({ url: String(url), options });
      return response(201, [{
        event_id: payload.eventId,
        payload_fingerprint: payload.fingerprint,
      }]);
    },
  });

  assert.deepEqual(result, { status: "created" });
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.searchParams.get("on_conflict"), "event_id");
  assert.equal(
    requests[0].options.headers.Prefer,
    "resolution=ignore-duplicates,return=representation"
  );
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  const stored = JSON.parse(requests[0].options.body);
  assert.equal(stored.created_at, payload.sourceEventAt);
  assert.equal(stored.source_event_at, payload.sourceEventAt);
  assert.equal(stored.event_id, payload.eventId);
});

test("timeout after commit is recovered through an ignored duplicate insert", async () => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });
  let committed = null;
  let insertCalls = 0;
  const fetchImplementation = async (_url, options = {}) => {
    if (options.method === "POST") {
      insertCalls += 1;
      if (!committed) {
        committed = JSON.parse(options.body);
        throw new Error("synthetic timeout after commit");
      }
      return response(201, []);
    }
    return response(200, [{
      event_id: committed.event_id,
      payload_fingerprint: committed.payload_fingerprint,
    }]);
  };

  await expectDeliveryError(
    storeAlertDeliveryV2({ payload, config: CONFIG, fetchImplementation }),
    "storage_unavailable",
    503
  );
  const retry = await storeAlertDeliveryV2({ payload, config: CONFIG, fetchImplementation });
  assert.deepEqual(retry, { status: "duplicate" });
  assert.equal(insertCalls, 2);
});

test("a concurrent unique-key collision confirms the matching fingerprint", async () => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });
  let calls = 0;
  const result = await storeAlertDeliveryV2({
    payload,
    config: CONFIG,
    async fetchImplementation(_url, options = {}) {
      calls += 1;
      if (options.method === "POST") return response(201, []);
      return response(200, [{
        event_id: payload.eventId,
        payload_fingerprint: payload.fingerprint,
      }]);
    },
  });
  assert.deepEqual(result, { status: "duplicate" });
  assert.equal(calls, 2);
});

test("same event id with a different durable fingerprint fails closed", async () => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });
  await expectDeliveryError(
    storeAlertDeliveryV2({
      payload,
      config: CONFIG,
      async fetchImplementation(_url, options = {}) {
        if (options.method === "POST") return response(201, []);
        return response(200, [{
          event_id: payload.eventId,
          payload_fingerprint: "b".repeat(64),
        }]);
      },
    }),
    "event_id_conflict",
    409
  );
});

test("missing receiver schema does not fall back to legacy or file storage", async () => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });
  for (const code of ["42703", "42P10", "PGRST204"]) {
    await expectDeliveryError(
      storeAlertDeliveryV2({
        payload,
        config: CONFIG,
        async fetchImplementation() {
          return response(400, { code });
        },
      }),
      "schema_unavailable",
      422
    );
  }
});

test("durable-storage authentication failures are permanent and sanitized", async () => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });
  for (const status of [401, 403]) {
    await expectDeliveryError(
      storeAlertDeliveryV2({
        payload,
        config: CONFIG,
        async fetchImplementation() {
          return response(status, { message: "private provider body" });
        },
      }),
      "storage_auth",
      422
    );
  }
});

test("storage must be configured and insert acknowledgements must be exact", async () => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });
  await expectDeliveryError(
    storeAlertDeliveryV2({ payload, config: { ...CONFIG, enabled: false } }),
    "storage_not_configured",
    503
  );
  await expectDeliveryError(
    storeAlertDeliveryV2({
      payload,
      config: CONFIG,
      async fetchImplementation() {
        return response(201, [{ event_id: payload.eventId, payload_fingerprint: "c".repeat(64) }]);
      },
    }),
    "storage_response",
    503
  );
  await expectDeliveryError(
    storeAlertDeliveryV2({
      payload,
      config: CONFIG,
      async fetchImplementation() {
        return response(201, [
          { event_id: payload.eventId, payload_fingerprint: payload.fingerprint },
          { event_id: payload.eventId, payload_fingerprint: payload.fingerprint },
        ]);
      },
    }),
    "storage_response",
    503
  );
});

test("ignored duplicate confirmation is exactly one matching durable row", async (t) => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });
  const cases = [
    { name: "empty", body: [], code: "storage_response", status: 503 },
    { name: "not an array", body: {}, code: "storage_response", status: 503 },
    {
      name: "multiple rows",
      body: [
        { event_id: payload.eventId, payload_fingerprint: payload.fingerprint },
        { event_id: payload.eventId, payload_fingerprint: payload.fingerprint },
      ],
      code: "storage_response",
      status: 503,
    },
    {
      name: "wrong event id",
      body: [{ event_id: `pbp_${"f".repeat(40)}`, payload_fingerprint: payload.fingerprint }],
      code: "dedup_unconfirmed",
      status: 503,
    },
    {
      name: "wrong fingerprint",
      body: [{ event_id: payload.eventId, payload_fingerprint: "f".repeat(64) }],
      code: "event_id_conflict",
      status: 409,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const requests = [];
      await expectDeliveryError(
        storeAlertDeliveryV2({
          payload,
          config: CONFIG,
          async fetchImplementation(url, options = {}) {
            requests.push({ url: new URL(url), options });
            return options.method === "POST"
              ? response(201, [])
              : response(200, scenario.body);
          },
        }),
        scenario.code,
        scenario.status
      );
      assert.equal(requests.length, 2);
      assert.equal(requests[1].url.searchParams.get("limit"), "1");
      assert.equal(requests[1].url.searchParams.get("event_id"), `eq.${payload.eventId}`);
      assert.equal(requests[1].options.method, undefined);
    });
  }
});

test("storage fetch and response body reads have bounded abort deadlines", async (t) => {
  const payload = validateAlertDeliveryV2(makePayload(), { now: NOW });

  await t.test("fetch timeout", async () => {
    await expectDeliveryError(
      storeAlertDeliveryV2({
        payload,
        config: CONFIG,
        timeoutMs: 5,
        fetchImplementation(_url, { signal }) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        },
      }),
      "storage_timeout",
      503
    );
  });

  await t.test("body timeout", async () => {
    await expectDeliveryError(
      storeAlertDeliveryV2({
        payload,
        config: CONFIG,
        timeoutMs: 5,
        async fetchImplementation(_url, { signal }) {
          return {
            ok: true,
            status: 201,
            text() {
              return new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
              });
            },
          };
        },
      }),
      "storage_timeout",
      503
    );
  });
});

test("SQL requires complete V2 metadata and a full nullable unique index", () => {
  const sql = readFileSync(
    new URL("../docs/alert-delivery-v2-supabase.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /create unique index[\s\S]*on public\.alert_signals \(event_id\);/i);
  assert.doesNotMatch(sql, /unique index[\s\S]*where event_id is not null/i);
  for (const column of ["protocol_version", "event_id", "source_event_at", "payload_fingerprint"]) {
    assert.match(sql, new RegExp(`${column} is not null`, "i"));
  }
  assert.match(sql, /created_at = source_event_at/i);
});

test("authenticated guarded route fails closed and returns exact acknowledgements", async (t) => {
  await t.test("unauthorized", async () => {
    const harness = createAlertRouteHarness();
    const result = await harness.invoke(makePayload(), "wrong-secret");
    assert.equal(result.status, 401);
    assert.equal(harness.state.storeCalls.length, 0);
    assert.equal(harness.state.legacyCalls, 0);
  });

  await t.test("V2 admission flag off", async () => {
    const harness = createAlertRouteHarness();
    harness.state.admitted = false;
    const result = await harness.invoke(makePayload());
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "protocol_not_admitted");
    assert.equal(harness.state.storeCalls.length, 0);
    assert.equal(harness.state.legacyCalls, 0);
  });

  for (const scenario of [
    { name: "unsupported version", payload: makePayload({ schemaVersion: 3 }), code: "unsupported_schema" },
    { name: "malformed marker", payload: { protocol_version: 2, alertType: "legacy-shaped" }, code: "invalid_payload" },
  ]) {
    await t.test(scenario.name, async () => {
      const harness = createAlertRouteHarness();
      const result = await harness.invoke(scenario.payload);
      assert.equal(result.status, 400);
      assert.equal(result.body.code, scenario.code);
      assert.equal(harness.state.storeCalls.length, 0);
      assert.equal(harness.state.legacyCalls, 0);
    });
  }

  for (const status of ["created", "duplicate"]) {
    await t.test(`${status} acknowledgement`, async () => {
      const harness = createAlertRouteHarness();
      const sourceEventAt = new Date(Date.now() - 1_000);
      const payload = makePayload({
        sourceEventAt: sourceEventAt.toISOString(),
        expiresAt: new Date(sourceEventAt.getTime() + 10 * 60 * 1000).toISOString(),
      });
      harness.state.storeResult = { status };
      const result = await harness.invoke(payload);
      assert.equal(result.status, status === "created" ? 201 : 200);
      assert.deepEqual(JSON.parse(JSON.stringify(result.body)), {
        ok: true,
        protocolVersion: 2,
        status,
        eventId: payload.eventId,
      });
      assert.equal(harness.state.storeCalls.length, 1);
      assert.equal(harness.state.legacyCalls, 0);
    });
  }
});
