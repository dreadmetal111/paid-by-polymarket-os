let hotMarketsCache = [];
let currentTradeTicket = null;
let accountStateCache = null;
let currentLivePreparation = null;

function formatProbability(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatChangeAsProbability(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)} pts`;
}

function formatPercentChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTimestamp(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatPoints(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pts = value * 100;
  return `${pts >= 0 ? "+" : ""}${pts.toFixed(2)} pts`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatJsonBlock(value) {
  return escapeHtml(JSON.stringify(value ?? {}, null, 2));
}

function getCurrentTradeMode() {
  const modeSelect = document.getElementById("tradeModeSelect");
  return modeSelect?.value || "PAPER";
}

function getMarketSignals(market) {
  const signals = [];

  if (market.actionSignal === "BUY YES") signals.push("🟢 BUY YES");
  else if (market.actionSignal === "BUY NO") signals.push("🔴 BUY NO");
  else signals.push("👀 WATCH");

  if ((market.hotScore || 0) > 800000) signals.push("🔥 Momentum");
  if (market.yesPriceLive > 0.4 && market.yesPriceLive < 0.6) signals.push("⚖️ Balanced");
  if ((market.liquidity || 0) > 200000) signals.push("💧 Liquid");
  if (market.yesPriceLive < 0.08 || market.yesPriceLive > 0.92) signals.push("⚠️ Extreme");
  if ((market.confidenceScore || 0) >= 80) signals.push("🎯 High Confidence");

  return signals;
}

function parseJsonText(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function renderAlertItem(alert) {
  return `
    <div class="alert-item">
      <div class="alert-message">${alert.message}</div>
      <div class="alert-time">${formatTimestamp(alert.timestamp)}</div>
    </div>
  `;
}

function renderSignalLogItem(signal) {
  const perf = signal.performancePoints ?? 0;
  const perfClass = perf > 0 ? "positive" : perf < 0 ? "negative" : "";

  const status = signal.status || "ACTIVE";
  const statusClass = status === "WIN" ? "positive" : status === "LOSS" ? "negative" : "";
  const statusLabel = status === "WIN" ? "✅ WIN" : status === "LOSS" ? "❌ LOSS" : "⏳ ACTIVE";

  return `
    <div class="alert-item">
      <div class="alert-message">${signal.actionSignal}: ${signal.question}</div>
      <div class="alert-time">Logged: ${formatTimestamp(signal.createdAt)}</div>
      <div class="alert-time">Why it stood out: ${signal.actionReason}</div>
      <div class="alert-time">Confidence: ${signal.confidenceScore}/100</div>
      <div class="alert-time">Entry: ${formatProbability(signal.entryYesPrice)}</div>
      <div class="alert-time">Current: ${formatProbability(signal.currentYesPrice)}</div>
      <div class="alert-time ${perfClass}">Performance: ${formatPoints(perf)}</div>
      <div class="alert-time ${statusClass}">Status: ${statusLabel}</div>
    </div>
  `;
}

function renderPerformanceStats(stats) {
  const winRatePct = ((stats.winRate || 0) * 100).toFixed(1);
  const avgPerfLabel = formatPoints(stats.avgPerformance || 0);
  const avgWinLabel = formatPoints(stats.avgWin || 0);
  const avgLossLabel = formatPoints(stats.avgLoss || 0);
  const expectancyLabel = formatPoints(stats.expectancy || 0);

  const signalBreakdown = Object.entries(stats.bySignal || {})
    .map(([signalType, data]) => `
      <article class="market-card">
        <h3>${signalType}</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Total</span><span class="meta-value">${data.total}</span></div>
          <div class="meta-box"><span class="meta-label">Active</span><span class="meta-value">${data.active}</span></div>
          <div class="meta-box"><span class="meta-label">Wins</span><span class="meta-value">${data.wins}</span></div>
          <div class="meta-box"><span class="meta-label">Losses</span><span class="meta-value">${data.losses}</span></div>
          <div class="meta-box"><span class="meta-label">Win Rate</span><span class="meta-value">${((data.winRate || 0) * 100).toFixed(1)}%</span></div>
          <div class="meta-box"><span class="meta-label">Avg Perf</span><span class="meta-value">${formatPoints(data.avgPerformance || 0)}</span></div>
        </div>
      </article>
    `)
    .join("");

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Performance Summary</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Total Signals</span><span class="meta-value">${stats.totalSignals ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Active</span><span class="meta-value">${stats.activeSignals ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Wins</span><span class="meta-value">${stats.wins ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Losses</span><span class="meta-value">${stats.losses ?? 0}</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>Edge Summary</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Win Rate</span><span class="meta-value">${winRatePct}%</span></div>
          <div class="meta-box"><span class="meta-label">Avg Performance</span><span class="meta-value">${avgPerfLabel}</span></div>
          <div class="meta-box"><span class="meta-label">Avg Win</span><span class="meta-value">${avgWinLabel}</span></div>
          <div class="meta-box"><span class="meta-label">Avg Loss</span><span class="meta-value">${avgLossLabel}</span></div>
          <div class="meta-box"><span class="meta-label">Expectancy</span><span class="meta-value">${expectancyLabel}</span></div>
        </div>
      </article>
    </div>

    <div class="market-grid" style="margin-top: 18px;">
      ${signalBreakdown || `<p class="empty">No signal breakdown yet.</p>`}
    </div>
  `;
}

function renderAccountPanel(account) {
  const blockers = (account.blockers || []).map((b) => `<div class="alert-time">• ${b}</div>`).join("");
  const liveToggleDisabled = !account.canEnableLiveMode ? "disabled" : "";
  const liveChecked = account.liveModeEnabled ? "checked" : "";

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Account Status</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Connected</span><span class="meta-value">${account.isConnected ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Wallet Type</span><span class="meta-value">${account.walletType || "NONE"}</span></div>
          <div class="meta-box"><span class="meta-label">Wallet</span><span class="meta-value">${account.walletAddress || "—"}</span></div>
          <div class="meta-box"><span class="meta-label">Proxy Wallet</span><span class="meta-value">${account.proxyWalletAddress || "—"}</span></div>
          <div class="meta-box"><span class="meta-label">Signature Type</span><span class="meta-value">${account.signatureType ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Funder</span><span class="meta-value">${account.funderAddress || "—"}</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>Live Readiness</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Can Enable Live</span><span class="meta-value">${account.canEnableLiveMode ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder Ready</span><span class="meta-value">${account.builderReady ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder API</span><span class="meta-value">${account.builderApiConfigured ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Relayer</span><span class="meta-value">${account.relayerReady ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Signed Handoff</span><span class="meta-value">${account.signedOrderHandoffEnabled ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Real Live Submit</span><span class="meta-value">${account.realLiveSubmitEnabled ? "ON" : "SAFE FALLBACK"}</span></div>
        </div>
        <div class="alert-item" style="margin-top: 10px;">
          <div class="alert-message">Live Mode</div>
          <label class="alert-time" style="display:flex; gap:10px; align-items:center;">
            <input type="checkbox" id="liveModeToggle" ${liveChecked} ${liveToggleDisabled} style="width:auto;" />
            Enable Live Mode
          </label>
          ${blockers ? `<div style="margin-top:10px;">${blockers}</div>` : `<div class="alert-time">No blockers detected.</div>`}
        </div>
      </article>
    </div>
  `;
}

function renderAccountControls(account = {}) {
  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Advanced Setup</h3>
        <div class="market-meta">
          <div class="meta-box">
            <span class="meta-label">Wallet Address</span>
            <input id="connectWalletAddress" type="text" placeholder="0x..." />
          </div>
          <div class="meta-box">
            <span class="meta-label">Wallet Type</span>
            <select id="connectWalletType">
              <option value="EOA">EOA</option>
              <option value="POLYMARKET_PROXY">POLYMARKET_PROXY</option>
            </select>
          </div>
          <div class="meta-box">
            <span class="meta-label">Proxy Wallet</span>
            <input id="connectProxyWallet" type="text" placeholder="Optional / required for proxy mode" />
          </div>
          <div class="meta-box">
            <span class="meta-label">Signature Type</span>
            <input id="connectSignatureType" type="number" min="0" step="1" placeholder="0" />
          </div>
          <div class="meta-box">
            <span class="meta-label">Funder Address</span>
            <input id="connectFunderAddress" type="text" placeholder="Defaults to wallet address" />
          </div>
          <div class="meta-box">
            <span class="meta-label">Action</span>
            <button id="connectAccountBtn">Connect Account</button>
          </div>
        </div>
      </article>

      <article class="market-card">
        <h3>Builder Server Status</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Config Source</span><span class="meta-value">${account.builderConfigSource || "SERVER_ENV"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder API</span><span class="meta-value">${account.builderApiConfigured ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Relayer</span><span class="meta-value">${account.relayerReady ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Live Routing</span><span class="meta-value">${account.liveRoutingEnabled ? "ON" : "OFF"}</span></div>
          <div class="meta-box"><span class="meta-label">Signed Handoff</span><span class="meta-value">${account.signedOrderHandoffEnabled ? "READY" : "NOT READY"}</span></div>
          <div class="meta-box"><span class="meta-label">Real Submit</span><span class="meta-value">${account.realLiveSubmitEnabled ? "ON" : "SAFE FALLBACK"}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">Builder readiness is now read-only.</div>
          <div class="alert-time">This status comes from Render environment variables and backend checks, not frontend toggles.</div>
        </div>
        <div style="margin-top: 14px;">
          <button id="disconnectAccountBtn">Disconnect Account</button>
        </div>
      </article>
    </div>
  `;
}

function renderPaperPortfolioStats(stats) {
  const bankroll = stats.bankroll || {};
  const closedWinRate = ((stats.closedWinRate || 0) * 100).toFixed(1);

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Bankroll</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Starting</span><span class="meta-value">${formatMoney(bankroll.startingBankroll || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Cash</span><span class="meta-value">${formatMoney(bankroll.cash || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Equity</span><span class="meta-value">${formatMoney(bankroll.equity || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Default Size</span><span class="meta-value">${formatMoney(bankroll.defaultPositionSize || 0)}</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>Paper Trading Summary</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Total Positions</span><span class="meta-value">${stats.totalPositions ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Open</span><span class="meta-value">${stats.openPositions ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Closed</span><span class="meta-value">${stats.closedPositions ?? 0}</span></div>
          <div class="meta-box"><span class="meta-label">Closed Win Rate</span><span class="meta-value">${closedWinRate}%</span></div>
        </div>
      </article>

      <article class="market-card">
        <h3>P&amp;L</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Avg Open P&amp;L</span><span class="meta-value">${formatPoints(stats.avgOpenPnl || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Realized P&amp;L</span><span class="meta-value">${formatMoney(stats.realizedPnl || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Unrealized P&amp;L</span><span class="meta-value">${formatMoney(stats.unrealizedPnlDollars || 0)}</span></div>
          <div class="meta-box"><span class="meta-label">Closed Wins</span><span class="meta-value">${stats.closedWins ?? 0}</span></div>
        </div>
      </article>
    </div>
  `;
}

function renderPaperPositionItem(position) {
  const pnl = position.pnlPoints ?? 0;
  const pnlDollar = position.pnlDollars ?? 0;
  const pnlClass = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";
  const statusClass = position.status === "OPEN" ? "" : pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";

  const closeButton = position.status === "OPEN"
    ? `<button class="close-position-btn" data-position-id="${position.id}">Close Position</button>`
    : "";

  return `
    <div class="alert-item">
      <div class="alert-message">${position.actionSignal}: ${position.question}</div>
      <div class="alert-time">Source: ${position.source || "AUTO"}</div>
      <div class="alert-time">Opened: ${formatTimestamp(position.openedAt)}</div>
      <div class="alert-time">Why it was opened: ${position.actionReason}</div>
      <div class="alert-time">Confidence: ${position.confidenceScore}/100</div>
      <div class="alert-time">Size: ${formatMoney(position.positionSizeDollars || 0)}</div>
      <div class="alert-time">Entry: ${formatProbability(position.entryYesPrice)}</div>
      <div class="alert-time">Current: ${formatProbability(position.currentYesPrice)}</div>
      <div class="alert-time ${pnlClass}">P&amp;L Points: ${formatPoints(pnl)}</div>
      <div class="alert-time ${pnlClass}">P&amp;L Dollars: ${formatMoney(pnlDollar)}</div>
      <div class="alert-time ${statusClass}">Status: ${position.status}</div>
      ${position.closeReason ? `<div class="alert-time">Close Reason: ${position.closeReason}</div>` : ""}
      ${position.closedAt ? `<div class="alert-time">Closed: ${formatTimestamp(position.closedAt)}</div>` : ""}
      ${closeButton}
    </div>
  `;
}

function renderManualTradeControls() {
  return `
    <div class="market-card">
      <h3>Manual Paper Entry</h3>
      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Market ID</span><input id="manualMarketId" type="text" placeholder="Enter market ID" /></div>
        <div class="meta-box"><span class="meta-label">Signal Side</span>
          <select id="manualActionSignal">
            <option value="BUY YES">BUY YES</option>
            <option value="BUY NO">BUY NO</option>
          </select>
        </div>
        <div class="meta-box"><span class="meta-label">Position Size ($)</span><input id="manualPositionSize" type="number" min="1" step="1" placeholder="50" /></div>
        <div class="meta-box"><span class="meta-label">Action</span><button id="openManualPositionBtn">Open Position</button></div>
      </div>
    </div>
  `;
}

function renderResetControls() {
  return `
    <div class="market-card">
      <h3>Portfolio Reset</h3>
      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Starting Bankroll</span><input id="resetStartingBankroll" type="number" min="1" step="1" placeholder="1000" /></div>
        <div class="meta-box"><span class="meta-label">Default Position Size</span><input id="resetDefaultPositionSize" type="number" min="1" step="1" placeholder="50" /></div>
        <div class="meta-box"><span class="meta-label">Action</span><button id="resetPaperPortfolioBtn">Reset Portfolio</button></div>
      </div>
    </div>
  `;
}

function renderTradeTicket(quote) {
  const mode = getCurrentTradeMode();
  const liveBlocked = mode === "LIVE" && !(accountStateCache?.canEnableLiveMode);

  return `
    <div class="market-card">
      <h3>Execution Ticket</h3>
      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Question</span><span class="meta-value">${quote.question}</span></div>
        <div class="meta-box"><span class="meta-label">Mode</span><span class="meta-value">${mode}</span></div>
        <div class="meta-box"><span class="meta-label">Side</span><span class="meta-value">${quote.side}</span></div>
        <div class="meta-box"><span class="meta-label">Selected Price</span><span class="meta-value">${formatProbability(quote.selectedPrice)}</span></div>
        <div class="meta-box"><span class="meta-label">Size</span><span class="meta-value">${formatMoney(quote.sizeDollars)}</span></div>
        <div class="meta-box"><span class="meta-label">Estimated Shares</span><span class="meta-value">${quote.estimatedShares}</span></div>
        <div class="meta-box"><span class="meta-label">Estimated Max Loss</span><span class="meta-value">${formatMoney(quote.estimatedMaxLoss)}</span></div>
        <div class="meta-box"><span class="meta-label">Potential Profit</span><span class="meta-value">${formatMoney(quote.estimatedProfitIfCorrect)}</span></div>
        <div class="meta-box"><span class="meta-label">Confidence</span><span class="meta-value">${quote.confidenceScore}/100</span></div>
        <div class="meta-box"><span class="meta-label">Why this trade</span><span class="meta-value">${quote.actionReason}</span></div>
      </div>

      ${liveBlocked ? `<div class="alert-item"><div class="alert-message">Live mode is blocked.</div><div class="alert-time">Connect an account and clear readiness blockers first.</div></div>` : ""}

      <div class="market-footer">
        <button id="executePaperTradeBtn" ${mode === "LIVE" ? "style='display:none;'" : ""}>Execute Paper Trade</button>
        <button id="prepareLiveTradeBtn">${mode === "LIVE" ? "Prepare Signed Handoff" : "Preview Live Trade"}</button>
      </div>
    </div>
  `;
}

function renderSignedOrderSubmitResult(response, isError = false) {
  const result = response?.result || {};
  const summary = result.requestSummary || {};
  const clobResponse = result.clobResponse || null;

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>${isError ? "Signed Handoff Error" : "Signed Handoff Result"}</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Status</span><span class="meta-value">${result.status || (isError ? "ERROR" : "DONE")}</span></div>
          <div class="meta-box"><span class="meta-label">Forwarded</span><span class="meta-value">${response?.forwarded ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Dry-Run Fallback</span><span class="meta-value">${response?.dryRunFallback ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Real Submission</span><span class="meta-value">${summary.realSubmissionAttempted ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder Attribution</span><span class="meta-value">${summary.builderAttributionAttached ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">User L2 Auth</span><span class="meta-value">${summary.userL2AuthAttached ? "YES" : "NO"}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">${result.message || response?.error || "No response message provided."}</div>
        </div>
      </article>

      <article class="market-card">
        <h3>Request Summary</h3>
        <div class="alert-item">
          <pre style="margin:0; white-space:pre-wrap; word-break:break-word; font-size:0.82rem; line-height:1.5; color:#cbd5e1;">${formatJsonBlock(summary)}</pre>
        </div>
      </article>
    </div>

    ${clobResponse ? `
      <div class="market-grid" style="margin-top: 18px;">
        <article class="market-card">
          <h3>CLOB Response</h3>
          <div class="alert-item">
            <pre style="margin:0; white-space:pre-wrap; word-break:break-word; font-size:0.82rem; line-height:1.5; color:#cbd5e1;">${formatJsonBlock(clobResponse)}</pre>
          </div>
        </article>
      </div>
    ` : ""}
  `;
}

function renderLivePreparation(preparation) {
  const ticket = preparation.ticket || {};
  const handoff = preparation.signedOrderHandoff || {};
  const blockedReasons = handoff.blockedReasons || [];
  const nextSteps = preparation.nextSteps || [];

  return `
    <div class="market-grid">
      <article class="market-card">
        <h3>Signed Handoff Status</h3>
        <div class="market-meta">
          <div class="meta-box"><span class="meta-label">Mode</span><span class="meta-value">${preparation.mode || "LIVE"}</span></div>
          <div class="meta-box"><span class="meta-label">Status</span><span class="meta-value">${preparation.status || "—"}</span></div>
          <div class="meta-box"><span class="meta-label">Builder Ready</span><span class="meta-value">${preparation.builderReady ? "YES" : "NO"}</span></div>
          <div class="meta-box"><span class="meta-label">Submission Mode</span><span class="meta-value">${handoff.submissionMode || "SAFE_FALLBACK_ONLY"}</span></div>
        </div>
        <div class="alert-item">
          <div class="alert-message">${preparation.message || "Live preparation complete."}</div>
          <div class="alert-time">Question: ${ticket.question || "—"}</div>
          <div class="alert-time">Side: ${ticket.side || "—"}</div>
          <div class="alert-time">Size: ${formatMoney(ticket.sizeDollars || 0)}</div>
          <div class="alert-time">Selected Price: ${formatProbability(ticket.selectedPrice)}</div>
        </div>
      </article>

      <article class="market-card">
        <h3>Signable Order Payload</h3>
        <div class="alert-item">
          <div class="alert-message">Create and sign this order on the user side.</div>
          <div class="alert-time">This app does not move the user private key to the server.</div>
          <pre style="margin:12px 0 0; white-space:pre-wrap; word-break:break-word; font-size:0.82rem; line-height:1.5; color:#cbd5e1;">${formatJsonBlock(handoff.signableOrder)}</pre>
        </div>
      </article>
    </div>

    <div class="market-grid" style="margin-top: 18px;">
      <article class="market-card">
        <h3>Submit Signed Order Handoff</h3>
        <div class="alert-item">
          <div class="alert-message">Paste signed order JSON</div>
          <textarea
            id="signedOrderInput"
            rows="10"
            placeholder="Paste signed order JSON here"
            style="width:100%; margin-top:10px; padding:12px; border-radius:12px; border:1px solid #1e293b; background:#020817; color:#f8fafc; font-size:0.9rem; line-height:1.5;"
          ></textarea>
        </div>
        <div class="alert-item" style="margin-top: 12px;">
          <div class="alert-message">Paste user L2 auth JSON</div>
          <div class="alert-time">Expected keys: address, apiKey, secret, passphrase</div>
          <textarea
            id="userAuthInput"
            rows="8"
            placeholder="Paste user auth JSON here"
            style="width:100%; margin-top:10px; padding:12px; border-radius:12px; border:1px solid #1e293b; background:#020817; color:#f8fafc; font-size:0.9rem; line-height:1.5;"
          ></textarea>
          <pre style="margin:12px 0 0; white-space:pre-wrap; word-break:break-word; font-size:0.8rem; line-height:1.45; color:#94a3b8;">${formatJsonBlock(handoff.userAuthSchema)}</pre>
        </div>
        <div style="margin-top: 14px;">
          <button id="submitSignedOrderBtn">Submit Signed Order Handoff</button>
        </div>
      </article>

      <article class="market-card">
        <h3>Handoff Notes</h3>
        <div class="alerts-list">
          ${(handoff.notes || []).map((note) => `
            <div class="alert-item">
              <div class="alert-message">${note}</div>
            </div>
          `).join("")}
          ${(blockedReasons || []).map((reason) => `
            <div class="alert-item">
              <div class="alert-message">${reason}</div>
            </div>
          `).join("")}
          ${(nextSteps || []).map((step) => `
            <div class="alert-item">
              <div class="alert-message">${step}</div>
            </div>
          `).join("")}
        </div>
      </article>
    </div>
  `;
}

function renderHotCard(market) {
  const signals = getMarketSignals(market);

  return `
    <article class="market-card">
      <h3>${market.question}</h3>

      <div class="signals">
        ${signals.map((signal) => `<span class="signal">${signal}</span>`).join("")}
      </div>

      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Yes Price</span><span class="meta-value">${formatProbability(market.yesPriceLive)}</span></div>
        <div class="meta-box"><span class="meta-label">24h Volume</span><span class="meta-value">${formatMoney(market.volume24hr)}</span></div>
        <div class="meta-box"><span class="meta-label">Liquidity</span><span class="meta-value">${formatMoney(market.liquidity)}</span></div>
        <div class="meta-box"><span class="meta-label">Confidence</span><span class="meta-value">${market.confidenceScore ?? "—"}/100</span></div>
        <div class="meta-box"><span class="meta-label">Signal</span><span class="meta-value">${market.actionSignal ?? "WATCH"}</span></div>
        <div class="meta-box"><span class="meta-label">Why it matters</span><span class="meta-value">${market.actionReason ?? "No reason yet"}</span></div>
      </div>

      <div class="market-footer">
        <span class="market-small">${market.slug}</span>
        <a class="market-link" href="${market.url}" target="_blank" rel="noopener noreferrer">Open Market</a>
      </div>

      <div class="market-footer" style="margin-top: 12px;">
        <button class="trade-action-btn" data-market-id="${market.id}" data-side="BUY YES">Preview BUY YES</button>
        <button class="trade-action-btn" data-market-id="${market.id}" data-side="BUY NO">Preview BUY NO</button>
      </div>
    </article>
  `;
}

function renderMoverCard(market) {
  const changeClass = market.percentChange >= 0 ? "positive" : "negative";

  return `
    <article class="market-card">
      <h3>${market.question}</h3>

      <div class="market-meta">
        <div class="meta-box"><span class="meta-label">Current Price</span><span class="meta-value">${formatProbability(market.yesPriceLive)}</span></div>
        <div class="meta-box"><span class="meta-label">Recent Price</span><span class="meta-value">${formatProbability(market.pastPrice)}</span></div>
        <div class="meta-box"><span class="meta-label">Price Change</span><span class="meta-value ${changeClass}">${formatChangeAsProbability(market.priceChange)}</span></div>
        <div class="meta-box"><span class="meta-label">Percent Change</span><span class="meta-value ${changeClass}">${formatPercentChange(market.percentChange)}</span></div>
      </div>

      <div class="market-footer">
        <span class="market-small">24h Vol: ${formatMoney(market.volume24hr)}</span>
        <a class="market-link" href="${market.url}" target="_blank" rel="noopener noreferrer">Open Market</a>
      </div>
    </article>
  `;
}

function applyHotFilters() {
  const container = document.getElementById("hotMarkets");
  if (!container) return;

  const minVolume = Number(document.getElementById("minVolume")?.value) || 0;
  const minPrice = Number(document.getElementById("minPrice")?.value) || 0;
  const maxPrice = Number(document.getElementById("maxPrice")?.value) || 1;

  const filtered = hotMarketsCache.filter((market) =>
    market.volume24hr >= minVolume &&
    market.yesPriceLive >= minPrice &&
    market.yesPriceLive <= maxPrice
  );

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty">No markets match your filters.</p>`;
    return;
  }

  container.innerHTML = filtered.map(renderHotCard).join("");
  bindTradeActionButtons();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function postJsonDetailed(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Server returned a non-JSON response");
  }

  return {
    httpOk: res.ok,
    data,
  };
}

async function handleConnectAccount() {
  try {
    const walletAddress = document.getElementById("connectWalletAddress")?.value?.trim();
    const walletType = document.getElementById("connectWalletType")?.value || "EOA";
    const proxyWalletAddress = document.getElementById("connectProxyWallet")?.value?.trim() || "";
    const signatureType = Number(document.getElementById("connectSignatureType")?.value || 0);
    const funderAddress = document.getElementById("connectFunderAddress")?.value?.trim() || walletAddress;

    if (!walletAddress) throw new Error("Wallet address is required");

    await postJson("/api/account/connect", {
      walletAddress,
      walletType,
      proxyWalletAddress,
      signatureType,
      funderAddress,
    });

    await loadAccountState();
  } catch (err) {
    alert(err.message || "Failed to connect account");
  }
}

async function handleDisconnectAccount() {
  try {
    await postJson("/api/account/disconnect", {});
    await loadAccountState();
  } catch (err) {
    alert(err.message || "Failed to disconnect account");
  }
}

async function handleLiveModeToggle(enabled) {
  try {
    await postJson("/api/account/live-mode", { enabled });
    await loadAccountState();
    renderTradeTicketPanel();
  } catch (err) {
    alert(err.message || "Failed to update live mode");
    await loadAccountState();
  }
}

async function handleManualOpenPosition() {
  try {
    const marketId = document.getElementById("manualMarketId")?.value?.trim();
    const actionSignal = document.getElementById("manualActionSignal")?.value;
    const positionSizeDollars = Number(document.getElementById("manualPositionSize")?.value || 0);

    if (!marketId || !actionSignal || !positionSizeDollars) {
      throw new Error("Fill in market ID, signal side, and position size");
    }

    await postJson("/api/paper-portfolio/open", { marketId, actionSignal, positionSizeDollars });
    await loadPaperPortfolio();
  } catch (err) {
    alert(err.message || "Failed to open position");
  }
}

async function handleManualClosePosition(positionId) {
  try {
    await postJson("/api/paper-portfolio/close", { positionId, reason: "Manual Close" });
    await loadPaperPortfolio();
  } catch (err) {
    alert(err.message || "Failed to close position");
  }
}

async function handleResetPaperPortfolio() {
  try {
    const startingBankroll = Number(document.getElementById("resetStartingBankroll")?.value || 1000);
    const defaultPositionSize = Number(document.getElementById("resetDefaultPositionSize")?.value || 50);

    await postJson("/api/paper-portfolio/reset", { startingBankroll, defaultPositionSize });

    await loadPaperPortfolio();
    await loadSignalLog();
    await loadPerformanceStats();
  } catch (err) {
    alert(err.message || "Failed to reset portfolio");
  }
}

async function handleQuoteTrade(marketId, side) {
  try {
    const sizeDollars = Number(document.getElementById("tradeTicketSize")?.value || 50) || 50;
    const mode = getCurrentTradeMode();

    const data = await postJson("/api/trade/quote", {
      marketId,
      side,
      sizeDollars,
      mode,
    });

    currentTradeTicket = data.quote;
    currentLivePreparation = null;
    renderTradeTicketPanel();
    renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);
  } catch (err) {
    alert(err.message || "Failed to quote trade");
  }
}

async function handleExecutePaperTrade() {
  try {
    if (!currentTradeTicket) throw new Error("No trade ticket selected");

    await postJson("/api/trade/execute", {
      marketId: currentTradeTicket.marketId,
      side: currentTradeTicket.side,
      sizeDollars: currentTradeTicket.sizeDollars,
      mode: "PAPER",
    });

    await loadPaperPortfolio();
    renderTradeExecutionResult(`<p class="loading">Paper trade executed successfully.</p>`);
  } catch (err) {
    alert(err.message || "Failed to execute paper trade");
  }
}

async function handlePrepareLiveTrade() {
  try {
    if (!currentTradeTicket) throw new Error("No trade ticket selected");

    const data = await postJson("/api/trade/prepare", {
      marketId: currentTradeTicket.marketId,
      side: currentTradeTicket.side,
      sizeDollars: currentTradeTicket.sizeDollars,
    });

    currentLivePreparation = data.preparation;
    renderTradeExecutionResult(renderLivePreparation(data.preparation));
    bindLiveHandoffControls();
  } catch (err) {
    alert(err.message || "Failed to prepare live trade");
  }
}

async function handleSubmitSignedOrderHandoff() {
  try {
    if (!currentTradeTicket) throw new Error("No trade ticket selected");
    if (!currentLivePreparation?.signedOrderHandoff) {
      throw new Error("Prepare the live handoff first");
    }

    const signedOrderRaw = document.getElementById("signedOrderInput")?.value?.trim();
    const userAuthRaw = document.getElementById("userAuthInput")?.value?.trim();

    if (!signedOrderRaw) throw new Error("Paste signed order JSON first");
    if (!userAuthRaw) throw new Error("Paste user L2 auth JSON first");

    const signedOrder = parseJsonText(signedOrderRaw, "Signed order");
    const userAuth = parseJsonText(userAuthRaw, "User auth");

    const response = await postJsonDetailed("/api/trade/submit-signed", {
      marketId: currentTradeTicket.marketId,
      side: currentTradeTicket.side,
      sizeDollars: currentTradeTicket.sizeDollars,
      signedOrder,
      userAuth,
      orderType: currentLivePreparation.signedOrderHandoff.orderType || "GTC",
      postOnly: !!currentLivePreparation.signedOrderHandoff.postOnly,
    });

    if (!response.httpOk || response.data?.ok === false) {
      renderTradeExecutionResult(renderSignedOrderSubmitResult(response.data, true));
      return;
    }

    renderTradeExecutionResult(renderSignedOrderSubmitResult(response.data, false));
  } catch (err) {
    alert(err.message || "Failed to submit signed-order handoff");
  }
}

function renderTradeTicketPanel() {
  const ticketContainer = document.getElementById("tradeTicketPanel");
  if (!ticketContainer) return;

  if (!currentTradeTicket) {
    ticketContainer.innerHTML = `<p class="empty">No trade ticket selected yet.</p>`;
    return;
  }

  ticketContainer.innerHTML = renderTradeTicket(currentTradeTicket);

  const execBtn = document.getElementById("executePaperTradeBtn");
  const prepBtn = document.getElementById("prepareLiveTradeBtn");

  if (execBtn) execBtn.onclick = handleExecutePaperTrade;
  if (prepBtn) prepBtn.onclick = handlePrepareLiveTrade;
}

function renderTradeExecutionResult(html) {
  const container = document.getElementById("tradeExecutionPanel");
  if (!container) return;
  container.innerHTML = html;
}

function bindTradeActionButtons() {
  document.querySelectorAll(".trade-action-btn").forEach((btn) => {
    btn.onclick = () => handleQuoteTrade(btn.dataset.marketId, btn.dataset.side);
  });
}

function bindDynamicPortfolioControls() {
  const openBtn = document.getElementById("openManualPositionBtn");
  const resetBtn = document.getElementById("resetPaperPortfolioBtn");

  if (openBtn) openBtn.onclick = handleManualOpenPosition;
  if (resetBtn) resetBtn.onclick = handleResetPaperPortfolio;

  document.querySelectorAll(".close-position-btn").forEach((btn) => {
    btn.onclick = () => handleManualClosePosition(btn.dataset.positionId);
  });
}

function bindLiveHandoffControls() {
  const submitBtn = document.getElementById("submitSignedOrderBtn");
  if (submitBtn) submitBtn.onclick = handleSubmitSignedOrderHandoff;
}

function bindAccountControls() {
  const connectBtn = document.getElementById("connectAccountBtn");
  const disconnectBtn = document.getElementById("disconnectAccountBtn");
  const liveToggle = document.getElementById("liveModeToggle");
  const tradeModeSelect = document.getElementById("tradeModeSelect");

  if (connectBtn) connectBtn.onclick = handleConnectAccount;
  if (disconnectBtn) disconnectBtn.onclick = handleDisconnectAccount;
  if (liveToggle) liveToggle.onchange = (e) => handleLiveModeToggle(e.target.checked);
  if (tradeModeSelect) tradeModeSelect.onchange = () => renderTradeTicketPanel();
}

async function loadAlerts() {
  const container = document.getElementById("alertsPanel");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading alerts...</p>`;

  try {
    const res = await fetch("/api/alerts");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.alerts)) throw new Error("Invalid alerts response");

    if (data.alerts.length === 0) {
      container.innerHTML = `<p class="empty">No priority alerts right now.</p>`;
      return;
    }

    container.innerHTML = data.alerts.map(renderAlertItem).join("");
  } catch (err) {
    console.error("Alerts load error:", err);
    container.innerHTML = `<p class="empty">Failed to load alerts.</p>`;
  }
}

async function loadSignalLog() {
  const container = document.getElementById("signalLogPanel");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading tracked signals...</p>`;

  try {
    const res = await fetch("/api/signal-log");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.signals)) throw new Error("Invalid signal log response");

    if (data.signals.length === 0) {
      container.innerHTML = `<p class="empty">No tracked signals yet.</p>`;
      return;
    }

    container.innerHTML = data.signals.slice(0, 20).map(renderSignalLogItem).join("");
  } catch (err) {
    console.error("Signal log load error:", err);
    container.innerHTML = `<p class="empty">Failed to load tracked signals.</p>`;
  }
}

async function loadPerformanceStats() {
  const container = document.getElementById("performanceStatsPanel");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading performance stats...</p>`;

  try {
    const res = await fetch("/api/performance-stats");
    const data = await res.json();

    if (!data.ok || !data.stats) throw new Error("Invalid performance stats response");

    container.innerHTML = renderPerformanceStats(data.stats);
  } catch (err) {
    console.error("Performance stats load error:", err);
    container.innerHTML = `<p class="empty">Failed to load performance stats.</p>`;
  }
}

async function loadAccountState() {
  const stateContainer = document.getElementById("accountStatePanel");
  const controlsContainer = document.getElementById("accountControlsPanel");
  if (!stateContainer || !controlsContainer) return;

  stateContainer.innerHTML = `<p class="loading">Loading account state...</p>`;
  controlsContainer.innerHTML = `<p class="loading">Loading account controls...</p>`;

  try {
    const res = await fetch("/api/account-state");
    const data = await res.json();

    if (!data.ok || !data.account) throw new Error("Invalid account state response");

    accountStateCache = data.account;
    stateContainer.innerHTML = renderAccountPanel(data.account);
    controlsContainer.innerHTML = renderAccountControls(data.account);
    bindAccountControls();
  } catch (err) {
    console.error("Account state load error:", err);
    stateContainer.innerHTML = `<p class="empty">Failed to load account state.</p>`;
    controlsContainer.innerHTML = `<p class="empty">Failed to load account controls.</p>`;
  }
}

async function loadPaperPortfolio() {
  const statsContainer = document.getElementById("paperPortfolioStatsPanel");
  const controlsContainer = document.getElementById("paperPortfolioControlsPanel");
  const openContainer = document.getElementById("openPositionsPanel");
  const closedContainer = document.getElementById("closedPositionsPanel");

  if (!statsContainer || !controlsContainer || !openContainer || !closedContainer) return;

  statsContainer.innerHTML = `<p class="loading">Loading paper portfolio...</p>`;
  controlsContainer.innerHTML = `<p class="loading">Loading controls...</p>`;
  openContainer.innerHTML = `<p class="loading">Loading open positions...</p>`;
  closedContainer.innerHTML = `<p class="loading">Loading closed positions...</p>`;

  try {
    const res = await fetch("/api/paper-portfolio");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.positions) || !data.stats) {
      throw new Error("Invalid paper portfolio response");
    }

    const openPositions = data.positions.filter((p) => p.status === "OPEN");
    const closedPositions = data.positions.filter((p) => p.status === "CLOSED");

    statsContainer.innerHTML = renderPaperPortfolioStats(data.stats);
    controlsContainer.innerHTML = renderManualTradeControls() + renderResetControls();

    openContainer.innerHTML = openPositions.length
      ? openPositions.map(renderPaperPositionItem).join("")
      : `<p class="empty">No open paper positions.</p>`;

    closedContainer.innerHTML = closedPositions.length
      ? closedPositions.slice(0, 20).map(renderPaperPositionItem).join("")
      : `<p class="empty">No closed paper positions yet.</p>`;

    bindDynamicPortfolioControls();
  } catch (err) {
    console.error("Paper portfolio load error:", err);
    statsContainer.innerHTML = `<p class="empty">Failed to load paper portfolio.</p>`;
    controlsContainer.innerHTML = `<p class="empty">Failed to load controls.</p>`;
    openContainer.innerHTML = `<p class="empty">Failed to load open positions.</p>`;
    closedContainer.innerHTML = `<p class="empty">Failed to load closed positions.</p>`;
  }
}

async function loadTopOpportunities() {
  const container = document.getElementById("topOpportunities");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading opportunities...</p>`;

  try {
    const res = await fetch("/api/liveMarkets");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.markets)) throw new Error("Invalid opportunities response");

    const ranked = data.markets
      .slice()
      .sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0))
      .slice(0, 6);

    if (ranked.length === 0) {
      container.innerHTML = `<p class="empty">No opportunities found.</p>`;
      return;
    }

    container.innerHTML = ranked.map(renderHotCard).join("");
    bindTradeActionButtons();
  } catch (err) {
    console.error("Top opportunities load error:", err);
    container.innerHTML = `<p class="empty">Failed to load opportunities.</p>`;
  }
}

async function loadHotMarkets() {
  const container = document.getElementById("hotMarkets");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading hot markets...</p>`;

  try {
    const res = await fetch("/api/liveMarkets");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.markets)) throw new Error("Invalid hot markets response");

    if (data.markets.length === 0) {
      hotMarketsCache = [];
      container.innerHTML = `<p class="empty">No hot markets found.</p>`;
      return;
    }

    hotMarketsCache = data.markets;
    applyHotFilters();
  } catch (err) {
    console.error("Hot markets load error:", err);
    container.innerHTML = `<p class="empty">Failed to load hot markets.</p>`;
  }
}

async function loadBiggestMovers() {
  const container = document.getElementById("biggestMovers");
  if (!container) return;

  container.innerHTML = `<p class="loading">Loading biggest movers...</p>`;

  try {
    const res = await fetch("/api/biggestMovers");
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.markets)) throw new Error("Invalid biggest movers response");

    if (data.markets.length === 0) {
      container.innerHTML = `<p class="empty">Mover data is warming up. Check back shortly.</p>`;
      return;
    }

    container.innerHTML = data.markets.map(renderMoverCard).join("");
  } catch (err) {
    console.error("Biggest movers load error:", err);
    container.innerHTML = `<p class="empty">Failed to load biggest movers.</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshAlerts = document.getElementById("refreshAlerts");
  const refreshOpp = document.getElementById("refreshOpportunities");
  const refreshHot = document.getElementById("refreshHot");
  const refreshMovers = document.getElementById("refreshMovers");
  const refreshSignals = document.getElementById("refreshSignals");
  const refreshPerformance = document.getElementById("refreshPerformance");
  const refreshPaperPortfolio = document.getElementById("refreshPaperPortfolio");
  const refreshAccount = document.getElementById("refreshAccount");
  const applyBtn = document.getElementById("applyFilters");

  if (refreshAlerts) refreshAlerts.addEventListener("click", loadAlerts);
  if (refreshOpp) refreshOpp.addEventListener("click", loadTopOpportunities);
  if (refreshHot) refreshHot.addEventListener("click", loadHotMarkets);
  if (refreshMovers) refreshMovers.addEventListener("click", loadBiggestMovers);
  if (refreshSignals) refreshSignals.addEventListener("click", loadSignalLog);
  if (refreshPerformance) refreshPerformance.addEventListener("click", loadPerformanceStats);
  if (refreshPaperPortfolio) refreshPaperPortfolio.addEventListener("click", loadPaperPortfolio);
  if (refreshAccount) refreshAccount.addEventListener("click", loadAccountState);
  if (applyBtn) applyBtn.addEventListener("click", applyHotFilters);

  renderTradeTicketPanel();
  renderTradeExecutionResult(`<p class="empty">No execution prep run yet.</p>`);

  loadAccountState();
  loadAlerts();
  loadPerformanceStats();
  loadPaperPortfolio();
  loadSignalLog();
  loadTopOpportunities();
  loadHotMarkets();
  loadBiggestMovers();

  setInterval(loadAccountState, 60000);
  setInterval(loadAlerts, 60000);
  setInterval(loadPerformanceStats, 60000);
  setInterval(loadPaperPortfolio, 60000);
  setInterval(loadSignalLog, 60000);
  setInterval(loadTopOpportunities, 60000);
  setInterval(loadHotMarkets, 60000);
  setInterval(loadBiggestMovers, 60000);
});