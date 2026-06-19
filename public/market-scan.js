const SCAN_FUNNEL_ENDPOINT = "/api/events/start-funnel";

const SCAN_ALLOWED_EVENT_NAMES = new Set([
  "start_checklist_open",
  "start_checklist_print",
  "start_checklist_download",
  "start_live_board_click",
]);

function sanitizeScanAttributionValue(value, fallback = "none", maxLength = 40) {
  const text = String(value || "")
    .trim()
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^\w .:/?#&=+-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, maxLength);

  return text || fallback;
}

function getScanAttribution() {
  const params = new URLSearchParams(window.location.search);
  const utmSource = sanitizeScanAttributionValue(params.get("utm_source"), "direct");
  const utmMedium = sanitizeScanAttributionValue(params.get("utm_medium"), "none");
  const utmCampaign = sanitizeScanAttributionValue(params.get("utm_campaign"), "market-scan");
  const utmContent = sanitizeScanAttributionValue(params.get("utm_content"), "checklist");
  const ref = sanitizeScanAttributionValue(params.get("ref"), "none");

  return {
    source: `${utmSource}:${utmMedium}`.slice(0, 120),
    campaign: utmCampaign.slice(0, 120),
    content: `${utmContent}:${ref}`.slice(0, 120),
  };
}

function postScanEvent(eventName) {
  if (!SCAN_ALLOWED_EVENT_NAMES.has(eventName)) return Promise.resolve();

  const payload = {
    eventName,
    ...getScanAttribution(),
  };

  if (navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });
    if (navigator.sendBeacon(SCAN_FUNNEL_ENDPOINT, blob)) {
      return Promise.resolve();
    }
  }

  return fetch(SCAN_FUNNEL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

function initMarketScanPage() {
  postScanEvent("start_checklist_open");

  document.querySelectorAll("[data-scan-live-board]").forEach((link) => {
    link.addEventListener("click", () => {
      postScanEvent("start_live_board_click");
    });
  });

  const printButton = document.getElementById("printScanButton");
  printButton?.addEventListener("click", () => {
    postScanEvent("start_checklist_print");
    window.setTimeout(() => window.print(), 120);
  });

  const downloadButton = document.getElementById("downloadScanPdfButton");
  downloadButton?.addEventListener("click", () => {
    postScanEvent("start_checklist_download");
  });
}

initMarketScanPage();
