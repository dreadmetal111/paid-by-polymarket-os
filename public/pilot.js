(function pilotReadonlyModule(global) {
  "use strict";

  const ENDPOINTS = Object.freeze({
    markets: "/api/liveMarkets",
    alerts: "/api/alerts/recent",
  });
  const REQUEST_DEADLINE_MS = 8000;
  const MAX_MARKETS = 60;
  const MAX_ALERTS = 20;
  const ALL_CATEGORIES = "All";

  let started = false;

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function finiteNumber(value, minimum, maximum) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (minimum !== undefined && value < minimum) return null;
    if (maximum !== undefined && value > maximum) return null;
    return value;
  }

  function requiredText(value, maximumLength) {
    if (typeof value !== "string") throw new Error("Invalid text field");
    const text = value.trim();
    if (!text || text.length > maximumLength) throw new Error("Invalid text field");
    return text;
  }

  function optionalText(value, maximumLength) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string") throw new Error("Invalid text field");
    const text = value.trim();
    if (text.length > maximumLength) throw new Error("Invalid text field");
    return text;
  }

  function nullableMetric(object, primaryKey, fallbackKey, primaryRange, fallbackRange, fallbackScale) {
    if (own(object, primaryKey)) {
      if (object[primaryKey] === null || object[primaryKey] === undefined) return null;
      const value = finiteNumber(object[primaryKey], primaryRange[0], primaryRange[1]);
      if (value === null) throw new Error("Invalid numeric field");
      return value;
    }
    if (!fallbackKey || !own(object, fallbackKey) || object[fallbackKey] === null || object[fallbackKey] === undefined) {
      return null;
    }
    const value = finiteNumber(object[fallbackKey], fallbackRange[0], fallbackRange[1]);
    if (value === null) throw new Error("Invalid numeric field");
    return value * fallbackScale;
  }

  function activityMetric(object, primaryKey, fallbackKey) {
    const key = own(object, primaryKey) ? primaryKey : fallbackKey;
    if (!key || !own(object, key) || object[key] === null || object[key] === undefined) return null;
    const value = finiteNumber(object[key], 0);
    if (value === null) throw new Error("Invalid activity field");
    return value;
  }

  function normalizeMarket(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid market record");
    const categoryValue = own(raw, "displayCategory") && raw.displayCategory
      ? raw.displayCategory
      : raw.category;

    return Object.freeze({
      id: requiredText(raw.id, 180),
      question: requiredText(raw.question, 400),
      category: requiredText(categoryValue, 120),
      eventTitle: optionalText(raw.eventTitle, 240),
      probability: nullableMetric(raw, "yesProbability", "yesPriceLive", [0, 100], [0, 1], 100),
      movement: nullableMetric(raw, "movement", "oneDayPriceChange", [-100, 100], [-1, 1], 100),
      volume: activityMetric(raw, "volume24hr", null),
      liquidity: activityMetric(raw, "liquidity", null),
      updatedAt: optionalText(raw.lastUpdated, 80),
    });
  }

  function normalizeMarketsPayload(payload) {
    if (!payload || typeof payload !== "object" || payload.ok !== true || !Array.isArray(payload.markets)) {
      throw new Error("Invalid live markets response");
    }
    if (payload.markets.length > 5000) throw new Error("Live markets response is too large");
    return {
      items: payload.markets.map(normalizeMarket).slice(0, MAX_MARKETS),
      returnedCount: payload.markets.length,
      dataTimestamp: optionalText(payload.lastRefreshedAt, 80),
    };
  }

  function normalizeAlert(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid alert record");
    return Object.freeze({
      alertType: requiredText(raw.alertType, 120),
      question: requiredText(raw.marketQuestion, 400),
      reason: optionalText(raw.reason, 600),
      severity: optionalText(raw.severity, 40),
      createdAt: optionalText(raw.createdAt, 80),
    });
  }

  function normalizeAlertsPayload(payload) {
    if (!payload || typeof payload !== "object" || payload.ok !== true || !Array.isArray(payload.alerts)) {
      throw new Error("Invalid recent alerts response");
    }
    if (payload.alerts.length > 1000) throw new Error("Recent alerts response is too large");
    return {
      items: payload.alerts.map(normalizeAlert).slice(0, MAX_ALERTS),
      dataTimestamp: optionalText(payload.generatedAt, 80),
    };
  }

  function validTimestamp(value, nowMs) {
    if (typeof value !== "string") return null;
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/);
    if (!parts) return null;
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = Number(parts[6]);
    const offsetHour = parts[8] === undefined ? 0 : Number(parts[8]);
    const offsetMinute = parts[9] === undefined ? 0 : Number(parts[9]);
    const daysInMonth = month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 0;
    if (
      day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 ||
      offsetHour > 23 || offsetMinute > 59
    ) {
      return null;
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp > nowMs) return null;
    return timestamp;
  }

  function formatTimestamp(value, nowMs) {
    const timestamp = validTimestamp(value, nowMs);
    if (timestamp === null) return "Unavailable";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function formatProbability(value) {
    if (value === null) return "Unavailable";
    const precision = value > 0 && value < 1 ? 2 : 1;
    return `${value.toFixed(precision)}%`;
  }

  function formatMovement(value) {
    if (value === null) return "Unavailable";
    return `${value > 0 ? "+" : ""}${value.toFixed(2)} pts`;
  }

  function formatActivity(value) {
    if (value === null) return "Unavailable";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: value >= 1000000 ? "compact" : "standard",
      maximumFractionDigits: value >= 1000 ? 1 : 2,
    }).format(value);
  }

  function makeElement(documentRef, tag, className, textValue) {
    const element = documentRef.createElement(tag);
    if (className) element.className = className;
    if (textValue !== undefined) element.textContent = textValue;
    return element;
  }

  function makeMetric(documentRef, label, value, className) {
    const box = makeElement(documentRef, "div", className || "");
    box.append(
      makeElement(documentRef, "span", "", label),
      makeElement(documentRef, "strong", "", value)
    );
    return box;
  }

  function setStatus(element, message, isError) {
    element.textContent = message;
    element.classList.toggle("error", !!isError);
  }

  function createApp(documentRef, fetchRef, runtime) {
    const elements = {
      refresh: documentRef.getElementById("refreshButton"),
      filters: documentRef.getElementById("categoryFilters"),
      markets: documentRef.getElementById("marketResults"),
      marketStatus: documentRef.getElementById("marketStatus"),
      marketRetention: documentRef.getElementById("marketRetention"),
      marketDataTime: documentRef.getElementById("marketDataTime"),
      marketCheckTime: documentRef.getElementById("marketCheckTime"),
      alerts: documentRef.getElementById("alertResults"),
      alertStatus: documentRef.getElementById("alertStatus"),
      alertRetention: documentRef.getElementById("alertRetention"),
      alertDataTime: documentRef.getElementById("alertDataTime"),
      alertCheckTime: documentRef.getElementById("alertCheckTime"),
      backdrop: documentRef.getElementById("detailBackdrop"),
      detail: documentRef.getElementById("marketDetail"),
      detailClose: documentRef.getElementById("detailClose"),
      detailCategory: documentRef.getElementById("detailCategory"),
      detailEvent: documentRef.getElementById("detailEvent"),
      detailTitle: documentRef.getElementById("detailTitle"),
      detailMetrics: documentRef.getElementById("detailMetrics"),
      detailWhy: documentRef.getElementById("detailWhy"),
      detailTime: documentRef.getElementById("detailTime"),
    };

    if (Object.values(elements).some((element) => !element)) throw new Error("Pilot page is incomplete");

    const state = {
      markets: [],
      alerts: [],
      category: ALL_CATEGORIES,
      loading: false,
      marketHasSucceeded: false,
      alertHasSucceeded: false,
      marketLastKnown: false,
      alertLastKnown: false,
      marketTrigger: null,
      marketReturnedCount: 0,
      focusRefreshAfterLoad: false,
    };

    async function requestJson(endpoint) {
      const controller = typeof runtime.AbortController === "function" ? new runtime.AbortController() : null;
      let timerId;
      const deadline = new Promise((_, reject) => {
        timerId = runtime.setTimeout(() => {
          if (controller) controller.abort();
          reject(new Error("Request deadline exceeded"));
        }, REQUEST_DEADLINE_MS);
      });

      try {
        const request = (async () => {
          const response = await fetchRef(endpoint, {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            ...(controller ? { signal: controller.signal } : {}),
          });
          if (!response || response.ok !== true) throw new Error("Request failed");
          return response.json();
        })();
        return await Promise.race([request, deadline]);
      } finally {
        runtime.clearTimeout(timerId);
      }
    }

    function renderFilters() {
      const categories = Array.from(new Set(state.markets.map((market) => market.category)))
        .sort((left, right) => left.localeCompare(right));
      if (state.category !== ALL_CATEGORIES && !categories.includes(state.category)) state.category = ALL_CATEGORIES;

      const buttons = [ALL_CATEGORIES, ...categories].map((category) => {
        const button = makeElement(documentRef, "button", "category-button", category);
        button.type = "button";
        button.dataset.category = category;
        button.setAttribute("aria-pressed", String(state.category === category));
        button.addEventListener("click", () => {
          state.category = category;
          renderFilters();
          renderMarkets();
        });
        return button;
      });
      elements.filters.replaceChildren(...buttons);
    }

    function marketWhy(market) {
      const parts = [];
      if (market.movement !== null) parts.push(`the feed reports ${formatMovement(market.movement)} recent movement`);
      if (market.volume !== null) parts.push(`${formatActivity(market.volume)} in 24-hour volume`);
      if (market.liquidity !== null) parts.push(`${formatActivity(market.liquidity)} in liquidity`);
      if (!parts.length) return "Its question caught your attention, while the feed has no usable activity figures to compare yet.";
      return `It offers concrete figures to compare: ${parts.join(", ")}. These describe reported market activity, not forecast confidence or expected returns.`;
    }

    function closeDetail() {
      if (elements.backdrop.hidden) return;
      elements.backdrop.hidden = true;
      documentRef.body.classList.remove("dialog-open");
      const trigger = state.marketTrigger;
      state.marketTrigger = null;
      if (trigger && typeof trigger.focus === "function") trigger.focus();
    }

    function closeDetailForRefresh() {
      if (!elements.backdrop.hidden) state.focusRefreshAfterLoad = true;
      closeDetail();
    }

    function openDetail(market, trigger) {
      state.marketTrigger = trigger;
      elements.detailCategory.textContent = market.category;
      const retention = state.marketLastKnown
        ? (state.loading ? "Refresh in progress: last-known market data." : "Last-known market data: latest market refresh failed.")
        : "Data from the last successful market check.";
      elements.detailEvent.textContent = `${market.eventTitle || "Event title unavailable"} · ${retention}`;
      elements.detailTitle.textContent = market.question;
      elements.detailMetrics.replaceChildren(
        makeMetric(documentRef, "YES probability", formatProbability(market.probability), "detail-metric"),
        makeMetric(documentRef, "Movement", formatMovement(market.movement), "detail-metric"),
        makeMetric(documentRef, "24h volume", formatActivity(market.volume), "detail-metric"),
        makeMetric(documentRef, "Liquidity", formatActivity(market.liquidity), "detail-metric")
      );
      elements.detailWhy.textContent = marketWhy(market);
      elements.detailTime.textContent = `Market data time: ${formatTimestamp(market.updatedAt, runtime.Date.now())}`;
      elements.backdrop.hidden = false;
      documentRef.body.classList.add("dialog-open");
      elements.detailClose.focus();
    }

    function renderMarketCard(market) {
      const card = makeElement(documentRef, "article", "market-card");
      const event = makeElement(documentRef, "p", "event-title", market.eventTitle || "Event title unavailable");
      const title = makeElement(documentRef, "h3", "", market.question);
      const probability = makeElement(documentRef, "p", "card-probability", formatProbability(market.probability));
      probability.append(makeElement(documentRef, "small", "", "YES · price-derived"));
      const metrics = makeElement(documentRef, "div", "metric-row");
      metrics.append(
        makeMetric(documentRef, "Movement", formatMovement(market.movement)),
        makeMetric(documentRef, "24h volume", formatActivity(market.volume)),
        makeMetric(documentRef, "Liquidity", formatActivity(market.liquidity))
      );
      const time = makeElement(documentRef, "p", "card-time", `Market data time: ${formatTimestamp(market.updatedAt, runtime.Date.now())}`);
      const button = makeElement(documentRef, "button", "detail-button", "Review details");
      button.type = "button";
      button.dataset.marketId = market.id;
      button.addEventListener("click", () => openDetail(market, button));
      card.append(makeElement(documentRef, "span", "category-pill", market.category), event, title, probability, metrics, time, button);
      return card;
    }

    function renderMarkets() {
      const visible = state.category === ALL_CATEGORIES
        ? state.markets
        : state.markets.filter((market) => market.category === state.category);
      if (!visible.length) {
        const message = state.markets.length
          ? "No markets are available in this category. Return to All to continue."
          : "No active markets were returned at the last successful check.";
        elements.markets.replaceChildren(makeElement(documentRef, "p", "empty-state", message));
      } else {
        elements.markets.replaceChildren(...visible.map(renderMarketCard));
      }
      elements.markets.setAttribute("aria-busy", "false");
    }

    function renderAlertCard(alert) {
      const card = makeElement(documentRef, "article", "alert-card");
      const top = makeElement(documentRef, "div", "alert-topline");
      top.append(
        makeElement(documentRef, "span", "alert-type", alert.alertType.replace(/[_-]+/g, " ")),
        makeElement(documentRef, "span", "alert-time", `Alert time: ${formatTimestamp(alert.createdAt, runtime.Date.now())}`)
      );
      const reason = makeElement(documentRef, "p", "alert-reason");
      reason.append(makeElement(documentRef, "strong", "", "Why saved: "));
      reason.append(documentRef.createTextNode(alert.reason || "Reason unavailable in saved record."));
      card.append(top, makeElement(documentRef, "h3", "", alert.question), reason);
      return card;
    }

    function renderAlerts() {
      if (!state.alerts.length) {
        elements.alerts.replaceChildren(makeElement(documentRef, "p", "empty-state", "No saved alerts were returned at the last successful check."));
      } else {
        elements.alerts.replaceChildren(...state.alerts.map(renderAlertCard));
      }
      elements.alerts.setAttribute("aria-busy", "false");
    }

    async function loadMarkets() {
      try {
        const normalized = normalizeMarketsPayload(await requestJson(ENDPOINTS.markets));
        const checkedAt = runtime.Date.now();
        closeDetailForRefresh();
        state.markets = normalized.items;
        state.marketReturnedCount = normalized.returnedCount;
        state.marketHasSucceeded = true;
        state.marketLastKnown = false;
        elements.marketRetention.hidden = true;
        elements.marketDataTime.textContent = formatTimestamp(normalized.dataTimestamp, checkedAt);
        elements.marketCheckTime.textContent = formatTimestamp(new runtime.Date(checkedAt).toISOString(), checkedAt);
        setStatus(elements.marketStatus, state.markets.length
          ? (state.marketReturnedCount > state.markets.length
            ? `Showing the first ${state.markets.length} of ${state.marketReturnedCount} returned markets. Categories reflect this shown sample.`
            : `${state.markets.length} market${state.markets.length === 1 ? "" : "s"} available from the latest successful check.`)
          : "The latest successful check returned no active markets.", false);
        renderFilters();
        renderMarkets();
      } catch {
        closeDetailForRefresh();
        state.marketLastKnown = state.marketHasSucceeded;
        elements.marketRetention.hidden = !state.marketLastKnown;
        setStatus(elements.marketStatus, state.marketLastKnown
          ? "Market refresh failed. Retained results are last-known, not current success."
          : "Markets are unavailable. No successful market data is displayed.", true);
        if (!state.marketLastKnown) {
          state.markets = [];
          elements.marketDataTime.textContent = "Unavailable";
          renderFilters();
          renderMarkets();
        }
      }
    }

    async function loadAlerts() {
      try {
        const normalized = normalizeAlertsPayload(await requestJson(ENDPOINTS.alerts));
        const checkedAt = runtime.Date.now();
        state.alerts = normalized.items;
        state.alertHasSucceeded = true;
        state.alertLastKnown = false;
        elements.alertRetention.hidden = true;
        elements.alertDataTime.textContent = formatTimestamp(normalized.dataTimestamp, checkedAt);
        elements.alertCheckTime.textContent = formatTimestamp(new runtime.Date(checkedAt).toISOString(), checkedAt);
        setStatus(elements.alertStatus, state.alerts.length
          ? `${state.alerts.length} saved alert${state.alerts.length === 1 ? "" : "s"} available from the latest successful check.`
          : "The latest successful check returned no saved alerts.", false);
        renderAlerts();
      } catch {
        state.alertLastKnown = state.alertHasSucceeded;
        elements.alertRetention.hidden = !state.alertLastKnown;
        setStatus(elements.alertStatus, state.alertLastKnown
          ? "Saved-alert refresh failed. Retained records are last-known, not current success."
          : "Saved alerts are unavailable. No successful alert records are displayed.", true);
        if (!state.alertLastKnown) {
          state.alerts = [];
          elements.alertDataTime.textContent = "Unavailable";
          renderAlerts();
        }
      }
    }

    async function refresh() {
      if (state.loading) return;
      closeDetailForRefresh();
      state.loading = true;
      elements.refresh.disabled = true;
      elements.refresh.textContent = "Refreshing…";
      elements.markets.setAttribute("aria-busy", "true");
      elements.alerts.setAttribute("aria-busy", "true");
      if (state.marketHasSucceeded) {
        state.marketLastKnown = true;
        elements.marketRetention.hidden = false;
        setStatus(elements.marketStatus, "Refreshing markets; displayed results are last-known until this check succeeds.", false);
      } else {
        setStatus(elements.marketStatus, "Loading markets…", false);
      }
      if (state.alertHasSucceeded) {
        state.alertLastKnown = true;
        elements.alertRetention.hidden = false;
        setStatus(elements.alertStatus, "Refreshing saved alerts; displayed records are last-known until this check succeeds.", false);
      } else {
        setStatus(elements.alertStatus, "Loading saved alerts…", false);
      }

      await Promise.allSettled([loadMarkets(), loadAlerts()]);
      state.loading = false;
      elements.refresh.disabled = false;
      elements.refresh.textContent = "Refresh data";
      elements.markets.setAttribute("aria-busy", "false");
      elements.alerts.setAttribute("aria-busy", "false");
      if (state.focusRefreshAfterLoad && elements.backdrop.hidden) elements.refresh.focus();
      state.focusRefreshAfterLoad = false;
    }

    elements.refresh.addEventListener("click", refresh);
    elements.detailClose.addEventListener("click", closeDetail);
    elements.backdrop.addEventListener("click", (event) => {
      if (event.target === elements.backdrop) closeDetail();
    });
    documentRef.addEventListener("keydown", (event) => {
      if (elements.backdrop.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeDetail();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        elements.detailClose.focus();
      }
    });

    return Object.freeze({ refresh, closeDetail, state });
  }

  function start() {
    if (started) return null;
    started = true;
    const app = createApp(global.document, global.fetch.bind(global), {
      AbortController: global.AbortController,
      Date: global.Date,
      setTimeout: global.setTimeout.bind(global),
      clearTimeout: global.clearTimeout.bind(global),
    });
    app.refresh();
    return app;
  }

  global.PilotReadonly = Object.freeze({ start, createApp });
  if (global.document.readyState === "loading") {
    global.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})(globalThis);
