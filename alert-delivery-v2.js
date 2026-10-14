import crypto from "crypto";

export const ALERT_DELIVERY_V2_SCHEMA_VERSION = 2;
export const ALERT_DELIVERY_V2_MAX_AGE_MS = 15 * 60 * 1000;
export const ALERT_DELIVERY_V2_FUTURE_SKEW_MS = 60 * 1000;
export const ALERT_DELIVERY_V2_STORAGE_TIMEOUT_MS = 5 * 1000;

const EVENT_ID_PATTERN = /^pbp_[a-f0-9]{40}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const STORAGE_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const DURABLE_DELIVERY_COLUMNS = [
  "alert_type",
  "market_question",
  "reason",
  "severity",
  "source",
  "created_at",
  "event_id",
  "source_event_at",
  "expires_at",
  "payload_fingerprint",
  "protocol_version",
];
const PUBLIC_FIELD_NAMES = [
  "alertType",
  "marketQuestion",
  "reason",
  "severity",
  "source",
];
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
    Array.from(value).length > 0 &&
    Array.from(value).length <= maxLength &&
    value === value.trim() &&
    !hasUnpairedSurrogate(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function assertCanonicalAlertDeliveryV2PublicFields(
  payload,
  canonicalPublicFields
) {
  if (
    !canonicalPublicFields ||
    typeof canonicalPublicFields !== "object" ||
    Array.isArray(canonicalPublicFields) ||
    PUBLIC_FIELD_NAMES.some(
      (field) => payload?.[field] !== canonicalPublicFields[field]
    )
  ) {
    throw new AlertDeliveryV2Error("invalid_payload");
  }
  return payload;
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
  url.searchParams.set("select", DURABLE_DELIVERY_COLUMNS.join(","));
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
  assertDurableDeliveryRow(existing, payload, "event_id_conflict", 409);
  return existing;
}

function timestampInstantMicroseconds(value) {
  if (typeof value !== "string") return null;
  const match = STORAGE_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    fractionText = "", zone, offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const fraction = fractionText.padEnd(6, "0");
  const millisecond = Number(fraction.slice(0, 3));
  if (
    year < 1 ||
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59
  ) return null;

  const localDate = new Date(0);
  localDate.setUTCFullYear(year, month - 1, day);
  localDate.setUTCHours(hour, minute, second, millisecond);
  const localMilliseconds = localDate.getTime();
  if (!Number.isFinite(localMilliseconds)) return null;
  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hour ||
    localDate.getUTCMinutes() !== minute ||
    localDate.getUTCSeconds() !== second
  ) return null;

  let offsetMinutes = 0;
  if (zone !== "Z") {
    const offsetHours = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHours > 23 || offsetMinute > 59) return null;
    offsetMinutes = (offsetHours * 60 + offsetMinute) * (offsetSign === "+" ? 1 : -1);
  }
  return (
    BigInt(localMilliseconds - offsetMinutes * 60_000) * 1000n +
    BigInt(fraction.slice(3, 6))
  );
}

function sameTimestampInstant(storedValue, requestValue) {
  const storedInstant = timestampInstantMicroseconds(storedValue);
  const requestInstant = timestampInstantMicroseconds(requestValue);
  return storedInstant !== null && requestInstant !== null && storedInstant === requestInstant;
}

function durableDeliveryRowMatches(row, payload) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  if (
    row.alert_type !== payload.alertType ||
    row.market_question !== payload.marketQuestion ||
    row.reason !== payload.reason ||
    row.severity !== payload.severity ||
    row.source !== payload.source ||
    row.event_id !== payload.eventId ||
    row.protocol_version !== payload.schemaVersion ||
    row.payload_fingerprint !== payload.fingerprint ||
    !sameTimestampInstant(row.created_at, payload.sourceEventAt) ||
    !sameTimestampInstant(row.source_event_at, payload.sourceEventAt) ||
    !sameTimestampInstant(row.expires_at, payload.expiresAt)
  ) return false;

  const durablePayload = {
    alertType: row.alert_type,
    eventId: row.event_id,
    expiresAt: payload.expiresAt,
    marketQuestion: row.market_question,
    reason: row.reason,
    schemaVersion: row.protocol_version,
    severity: row.severity,
    source: row.source,
    sourceEventAt: payload.sourceEventAt,
  };
  return fingerprintAlertDeliveryV2(durablePayload) === row.payload_fingerprint;
}

function assertDurableDeliveryRow(row, payload, code, status) {
  if (!durableDeliveryRowMatches(row, payload)) {
    throw new AlertDeliveryV2Error(code, status);
  }
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
        expires_at: payload.expiresAt,
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
    assertDurableDeliveryRow(row, payload, "storage_response", 503);
    return { status: "created" };
  }

  const code = storageFailureCode(body, response.status);
  throw new AlertDeliveryV2Error(code, storageFailureStatus(code));
}
