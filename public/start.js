const START_FUNNEL_ENDPOINT = "/api/events/start-funnel";
const WAITLIST_ENDPOINT = "/api/waitlist";
const START_SOURCE_BASE = "instagram-start-free-scan";

const START_ALLOWED_EVENT_NAMES = new Set([
  "start_page_view",
  "start_lead_submit",
  "start_lead_success",
  "start_lead_existing",
  "start_live_board_click",
]);

function sanitizeAttributionValue(value, fallback = "none", maxLength = 40) {
  const text = String(value || "")
    .trim()
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^\w .:/?#&=+-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, maxLength);

  return text || fallback;
}

function getStartAttribution() {
  const params = new URLSearchParams(window.location.search);
  const utmSource = sanitizeAttributionValue(params.get("utm_source"), "direct");
  const utmMedium = sanitizeAttributionValue(params.get("utm_medium"), "none");
  const utmCampaign = sanitizeAttributionValue(params.get("utm_campaign"), "free-scan");
  const utmContent = sanitizeAttributionValue(params.get("utm_content"), "none");
  const ref = sanitizeAttributionValue(params.get("ref"), "none");

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    ref,
    analyticsSource: `${utmSource}:${utmMedium}`.slice(0, 120),
    analyticsCampaign: utmCampaign.slice(0, 120),
    analyticsContent: `${utmContent}:${ref}`.slice(0, 120),
  };
}

function buildWaitlistSource(attribution) {
  return [
    START_SOURCE_BASE,
    `src=${attribution.utmSource}`,
    `med=${attribution.utmMedium}`,
    `camp=${attribution.utmCampaign}`,
    `content=${attribution.utmContent}`,
    `ref=${attribution.ref}`,
  ]
    .join("|")
    .slice(0, 120);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function postJson(url, payload, { keepalive = false } = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    keepalive,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  });
}

function trackStartEvent(eventName) {
  if (!START_ALLOWED_EVENT_NAMES.has(eventName)) return Promise.resolve();

  const attribution = getStartAttribution();
  const payload = {
    eventName,
    source: attribution.analyticsSource,
    campaign: attribution.analyticsCampaign,
    content: attribution.analyticsContent,
  };

  if (navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });
    if (navigator.sendBeacon(START_FUNNEL_ENDPOINT, blob)) {
      return Promise.resolve();
    }
  }

  return postJson(START_FUNNEL_ENDPOINT, payload, { keepalive: true }).catch(() => {});
}

function setStatus(message, type = "") {
  const status = document.getElementById("startFormStatus");
  if (!status) return;

  status.className = `start-form-status ${type}`.trim();
  status.textContent = message;
}

function setLoading(isLoading) {
  const button = document.getElementById("startSubmitButton");
  const input = document.getElementById("startEmail");

  if (button) {
    button.disabled = isLoading;
    button.textContent = isLoading ? "Saving..." : "Get the free market scan";
  }

  if (input) {
    input.disabled = isLoading;
  }
}

async function handleStartFormSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const input = form?.querySelector("#startEmail");
  const email = String(input?.value || "").trim().toLowerCase();

  if (!isValidEmail(email)) {
    setStatus("Enter a valid email address.", "error");
    input?.focus();
    return;
  }

  const attribution = getStartAttribution();
  const source = buildWaitlistSource(attribution);

  setLoading(true);
  setStatus("Saving your free scan request...", "loading");
  trackStartEvent("start_lead_submit");

  try {
    const data = await postJson(WAITLIST_ENDPOINT, {
      email,
      source,
    });

    if (data.status === "existing") {
      setStatus(
        "You are already on the list. The free scan will be available here shortly.",
        "success"
      );
      trackStartEvent("start_lead_existing");
      return;
    }

    setStatus(
      "Your request is saved. The free scan will be available here shortly.",
      "success"
    );
    trackStartEvent("start_lead_success");
  } catch (error) {
    setStatus(error.message || "Could not save your request. Please try again.", "error");
  } finally {
    setLoading(false);
  }
}

function initStartPage() {
  const form = document.getElementById("freeScanForm");
  form?.addEventListener("submit", handleStartFormSubmit);

  document.querySelectorAll("[data-start-live-board]").forEach((link) => {
    link.addEventListener("click", () => {
      trackStartEvent("start_live_board_click");
    });
  });

  trackStartEvent("start_page_view");
}

initStartPage();
