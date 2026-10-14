import crypto from "crypto";

export const ALERT_DELIVERY_V2_SCHEMA_VERSION = 2;
export const ALERT_DELIVERY_V2_MAX_AGE_MS = 15 * 60 * 1000;
export const ALERT_DELIVERY_V2_FUTURE_SKEW_MS = 60 * 1000;
export const ALERT_DELIVERY_V2_STORAGE_TIMEOUT_MS = 5 * 1000;

const EVENT_ID_PATTERN = /^pbp_[a-f0-9]{40}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const V2_PAYLOAD_KEYS = [
  "alertType",
  "eventId",
  "expiresAt",
  "fingerprint",
  "marketQuestion",
  "reason",
  "schemaVersion",
  "severity",
  "source",
  "sourceEventAt",
];

export class AlertDeliveryV2Error extends Error {
  constructor(code, status = 400) {
    super("Guarded alert delivery failed.");
    this.name = "AlertDeliveryV2Error";
    this.code = code;
    this.status = status;
  }
}

function strictUtcTimestamp(value) {
  if (typeof value !== "string") return null;
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  const normalized = parsed.toISOString();
  const inputMilliseconds = (value.match(/\.(\d{1,3})Z$/)?.[1] || "")
    .padEnd(3, "0");
  const expected = inputMilliseconds
    ? `${value.slice(0, value.indexOf("."))}.${inputMilliseconds}Z`
    : `${value.slice(0, -1)}.000Z`;
  if (normalized !== expected) return null;
  return timestamp;
}

function isBoundedText(value, maxLength, { optional = false } = {}) {
  if (value === null && optional) return true;
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function canonicalDeliveryObject(payload) {
  return {
    alertType: payload.alertType,
    eventId: payload.eventId,
    expiresAt: payload.expiresAt,
    marketQuestion: payload.marketQuestion,
    reason: payload.reason,
    schemaVersion: payload.schemaVersion,
    severity: payload.severity,
    source: payload.source,
    sourceEventAt: payload.sourceEventAt,
  };
}

export function canonicalAlertDeliveryV2(payload) {
  return JSON.stringify(canonicalDeliveryObject(payload));
}

export function fingerprintAlertDeliveryV2(payload) {
  return crypto
    .createHash("sha256")
    .update(canonicalAlertDeliveryV2(payload), "utf8")
    .digest("hex");
}

export function validateAlertDeliveryV2(
  payload,
  {
    now = new Date(),
    maxAgeMs = ALERT_DELIVERY_V2_MAX_AGE_MS,
    futureSkewMs = ALERT_DELIVERY_V2_FUTURE_SKEW_MS,
  } = {}
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AlertDeliveryV2Error("invalid_payload");
  }

  const keys = Object.keys(payload).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...V2_PAYLOAD_KEYS].sort())) {
    throw new AlertDeliveryV2Error("invalid_payload");
  }
  if (payload.schemaVersion !== ALERT_DELIVERY_V2_SCHEMA_VERSION) {
    throw new AlertDeliveryV2Error("unsupported_schema");
  }
  if (!EVENT_ID_PATTERN.test(payload.eventId || "")) {
    throw new AlertDeliveryV2Error("invalid_event_id");
  }
  if (!FINGERPRINT_PATTERN.test(payload.fingerprint || "")) {
    throw new AlertDeliveryV2Error("invalid_fingerprint");
  }
  if (
    !isBoundedText(payload.alertType, 80) ||
    !TOKEN_PATTERN.test(payload.alertType) ||
    !isBoundedText(payload.marketQuestion, 280) ||
    !isBoundedText(payload.reason, 400, { optional: true }) ||
    !isBoundedText(payload.severity, 40) ||
    !TOKEN_PATTERN.test(payload.severity) ||
    !isBoundedText(payload.source, 120) ||
    !TOKEN_PATTERN.test(payload.source)
  ) {
    throw new AlertDeliveryV2Error("invalid_payload");
  }

  const sourceTimestamp = strictUtcTimestamp(payload.sourceEventAt);
  const expiryTimestamp = strictUtcTimestamp(payload.expiresAt);
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
  if (
    sourceTimestamp === null ||
    expiryTimestamp === null ||
    !Number.isFinite(nowTimestamp)
  ) {
    throw new AlertDeliveryV2Error("invalid_timestamp");
  }
  if (sourceTimestamp > nowTimestamp + futureSkewMs) {
    throw new AlertDeliveryV2Error("future_timestamp");
  }
  if (
    expiryTimestamp <= sourceTimestamp ||
    expiryTimestamp - sourceTimestamp > maxAgeMs
  ) {
    throw new AlertDeliveryV2Error("invalid_expiry");
  }
  if (nowTimestamp >= expiryTimestamp) {
    throw new AlertDeliveryV2Error("expired", 410);
  }
  if (fingerprintAlertDeliveryV2(payload) !== payload.fingerprint) {
    throw new AlertDeliveryV2Error("fingerprint_mismatch", 409);
  }

  return Object.freeze({ ...payload });
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new AlertDeliveryV2Error("storage_response", 503);
  }
}

function supabaseTableUrl(config) {
  const baseUrl = new URL(config.supabaseUrl);
  return new URL(
    `/rest/v1/${encodeURIComponent(config.table)}`,
    `${baseUrl.origin}/`
  );
}

function supabaseHeaders(config, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extra,
  };
}

function storageFailureCode(payload, status) {
  if (status === 401 || status === 403) return "storage_auth";
  const code = typeof payload?.code === "string" ? payload.code : "";
  return code === "42P10" || code === "42703" || code === "PGRST204"
    ? "schema_unavailable"
    : "storage_unavailable";
}

function storageFailureStatus(code) {
  return code === "schema_unavailable" || code === "storage_auth" ? 422 : 503;
}

function boundedStorageTimeoutMs(value) {
  return Number.isFinite(value)
    ? Math.min(10_000, Math.max(1, Math.trunc(value)))
    : ALERT_DELIVERY_V2_STORAGE_TIMEOUT_MS;
}

async function requestStorageJson(
  fetchImplementation,
  url,
  options,
  timeoutMs
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedStorageTimeoutMs(timeoutMs));
  let phase = "fetch";
  try {
    const response = await fetchImplementation(url, {
      ...options,
      signal: controller.signal,
    });
    phase = "body";
    const body = await readResponseJson(response);
    return { response, body };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AlertDeliveryV2Error("storage_timeout", 503);
    }
    if (error instanceof AlertDeliveryV2Error) throw error;
    throw new AlertDeliveryV2Error(
      phase === "fetch" ? "storage_unavailable" : "storage_response",
      503
    );
  } finally {
    clearTimeout(timer);
  }
}

async function findExistingDelivery(
  config,
  payload,
  fetchImplementation,
  timeoutMs
) {
  const url = supabaseTableUrl(config);
  url.searchParams.set("select", "event_id,payload_fingerprint");
  url.searchParams.set("event_id", `eq.${payload.eventId}`);
  url.searchParams.set("limit", "1");

  const { response, body } = await requestStorageJson(
    fetchImplementation,
    url,
    {
      headers: supabaseHeaders(config),
    },
    timeoutMs
  );
  if (!response.ok) {
    const code = storageFailureCode(body, response.status);
    throw new AlertDeliveryV2Error(code, storageFailureStatus(code));
  }
  if (!Array.isArray(body) || body.length !== 1) {
    throw new AlertDeliveryV2Error("storage_response", 503);
  }
  const existing = body[0];
  if (
    !existing ||
    typeof existing !== "object" ||
    existing.event_id !== payload.eventId
  ) {
    throw new AlertDeliveryV2Error("dedup_unconfirmed", 503);
  }
  if (existing.payload_fingerprint !== payload.fingerprint) {
    throw new AlertDeliveryV2Error("event_id_conflict", 409);
  }
  return existing;
}

export async function storeAlertDeliveryV2({
  payload,
  config,
  fetchImplementation = fetch,
  timeoutMs = ALERT_DELIVERY_V2_STORAGE_TIMEOUT_MS,
}) {
  if (!config?.enabled || !config.supabaseUrl || !config.serviceRoleKey || !config.table) {
    throw new AlertDeliveryV2Error("storage_not_configured", 503);
  }

  const url = supabaseTableUrl(config);
  url.searchParams.set("on_conflict", "event_id");
  const { response, body } = await requestStorageJson(
    fetchImplementation,
    url,
    {
      method: "POST",
      headers: supabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      }),
      body: JSON.stringify({
        alert_type: payload.alertType,
        market_question: payload.marketQuestion,
        reason: payload.reason,
        severity: payload.severity,
        source: payload.source,
        created_at: payload.sourceEventAt,
        event_id: payload.eventId,
        source_event_at: payload.sourceEventAt,
        payload_fingerprint: payload.fingerprint,
        protocol_version: payload.schemaVersion,
      }),
    },
    timeoutMs
  );

  if (response.ok) {
    if (Array.isArray(body) && body.length === 0) {
      await findExistingDelivery(config, payload, fetchImplementation, timeoutMs);
      return { status: "duplicate" };
    }
    const row = Array.isArray(body) && body.length === 1 ? body[0] : null;
    if (
      !row ||
      row.event_id !== payload.eventId ||
      row.payload_fingerprint !== payload.fingerprint
    ) {
      throw new AlertDeliveryV2Error("storage_response", 503);
    }
    return { status: "created" };
  }

  const code = storageFailureCode(body, response.status);
  throw new AlertDeliveryV2Error(code, storageFailureStatus(code));
}
