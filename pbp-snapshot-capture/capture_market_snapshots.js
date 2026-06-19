#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://house-of-markets.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

function isoNow() {
  return new Date().toISOString();
}

function safeLog(message) {
  console.log(`[${isoNow()}] ${message}`);
}

function safeWarn(message) {
  console.warn(`[${isoNow()}] ${message}`);
}

function getConfig() {
  const adminSecret = process.env.PBP_ADMIN_SECRET;
  const baseUrl = process.env.PBP_BASE_URL || DEFAULT_BASE_URL;
  const timeoutMs = Number.parseInt(
    process.env.PBP_SNAPSHOT_CAPTURE_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`,
    10
  );

  if (!adminSecret) {
    throw new Error("PBP_ADMIN_SECRET is required in the environment.");
  }

  let endpointUrl;
  try {
    endpointUrl = new URL("/api/internal/capture-market-snapshots", baseUrl);
  } catch {
    throw new Error("PBP_BASE_URL must be a valid URL.");
  }

  return {
    adminSecret,
    endpointUrl: endpointUrl.toString(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureOnce(config, attempt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.endpointUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.adminSecret}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload = null;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = null;
      }
    }

    if (!response.ok || !payload?.ok) {
      const safeStatus = `status=${response.status}`;
      const safeMessage = payload?.error ? ` error=${payload.error}` : "";
      throw new Error(`Snapshot capture failed on attempt ${attempt}: ${safeStatus}${safeMessage}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const config = getConfig();
  safeLog("Starting market snapshot capture.");

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const payload = await captureOnce(config, attempt);
      safeLog(
        [
          "Snapshot capture succeeded.",
          `captured=${payload.captured ?? 0}`,
          `skipped=${payload.skipped ?? 0}`,
          `storageMode=${payload.storageMode || "unknown"}`,
          `snapshotHour=${payload.snapshotHour || "unknown"}`,
        ].join(" ")
      );
      return;
    } catch (error) {
      lastError = error;
      const safeMessage = error?.message || "Unknown capture error.";
      safeWarn(`Snapshot capture attempt ${attempt} failed. ${safeMessage}`);

      if (attempt < 2) {
        safeLog("Retrying market snapshot capture once.");
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  safeWarn(`Snapshot capture failed after retry. ${lastError?.message || "Unknown error."}`);
  process.exitCode = 1;
}

main().catch((error) => {
  safeWarn(`Snapshot capture worker crashed safely. ${error?.message || "Unknown error."}`);
  process.exitCode = 1;
});
