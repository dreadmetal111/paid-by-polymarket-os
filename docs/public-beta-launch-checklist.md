# Public Beta Launch Checklist

> **Current status (2026-10-21): historical checklist; needs revalidation.** The earlier `Go`, QA, and proof-count statements below record prior public-beta evidence. They do not clear the current customer pilot after recovery. Deployment/activation and bounded natural V2 worker-to-durable-row-to-public-card delivery are now verified, but pilot-required write/journey evidence, actual release controls, backup/isolated-restore proof, and the owner availability/capacity decision remain open. Use the [2026-10-21 pilot readiness gate](pilot-readiness-2026-10-21.md) for the evidence limits and current decision. Customer pilot admission remains **not cleared**, and this checklist authorizes no outreach, trading, paid action, production change, or release approval.

## 1. Public Beta Status

Historical public beta decision: Go, with limited beta positioning. This decision predates the current recovery gate and needs revalidation before any customer pilot.

The historical assessment was that Paid by Polymarket was ready for a small public beta or soft launch, but not for a major paid launch, broad marketing push, or official Builder Program reapplication. Revalidate that assessment against the current gate before acting on it.

## 2. Current Public URL

[https://paid-by-polymarket-os.onrender.com/](https://paid-by-polymarket-os.onrender.com/)

## 3. What Is Live

- Discovery-first homepage.
- Why Paid by Polymarket section.
- PBP Alerts Beta waitlist.
- Public beta feedback form.
- Live market discovery cards.
- Filtered and fresh market data.
- Latest Alert Signals.
- `View on Polymarket` CTA.
- `Preview Trade` secondary action.
- Outbound Polymarket click tracking.
- Supabase-backed waitlist storage.
- Supabase-backed alert signal storage.
- Supabase-backed outbound click event storage.
- Supabase-backed beta feedback storage, with local JSON fallback.
- Advanced/internal demo sections hidden from the normal public beta homepage.
- Internal/demo sections available with `?debug=1`.
- Protected admin status checker.

Internal debug URL:

[https://paid-by-polymarket-os.onrender.com/?debug=1](https://paid-by-polymarket-os.onrender.com/?debug=1)

## 4. Historical Public-Site QA Results — Revalidate

These results were recorded previously. This documentation update did not rerun them; reverify pilot-critical journeys, forms, and mobile behavior when clearing the separate customer-pilot gate.

- Homepage load: PASSED.
- Why Paid by Polymarket section: PASSED.
- PBP Alerts Beta section: PASSED.
- Latest Alert Signals: PASSED.
- Market Discovery cards: PASSED.
- View on Polymarket click tracking: PASSED.
- Preview Trade secondary action: PASSED.
- Waitlist submit: PASSED.
- Beta feedback submit: PASSED.
- Advanced/internal demo sections hidden on normal public URL: PASSED.
- Advanced/internal demo sections available with `?debug=1`: PASSED.
- Mobile layout: PASSED.
- Admin checker after interactions: PASSED.

## 5. Historical Proof Signals — Revalidate

These are earlier, undated lower-bound counts, not current evidence of recruited users, revenue, profitable demand, or buy-ready demand.

- `waitlist.count`: 2+
- `outboundClicks.count`: 3+
- `alertSignals.count`: 18+
- `feedback.count`: tracked via beta feedback storage.
- `storageMode`: supabase
- `waitlistStorage`: ok
- `alertStorage`: ok
- `outboundClickStorage`: ok
- `feedbackStorage`: ok when feedback status is included in admin status.

What these mean:

- Waitlist count = an earlier interest signal, not proof of demand, revenue, or purchase intent.
- Outbound clicks = recorded market opens, not a count of unique or recruited users.
- Alert signal count = stored records; it does not prove worker health, source freshness, or new V2 delivery.
- Feedback count = qualitative beta feedback and user confusion signal.

Do not include real emails or private data in public updates, screenshots, logs, or launch posts.

## 6. Go Criteria

- Public homepage loads.
- Market cards load.
- Alert signals display safely.
- Waitlist works.
- Feedback collection works.
- Outbound click tracking works.
- Admin checker returns ok.
- Advanced/internal demo sections are hidden from the normal public URL.
- Advanced/internal demo sections are available with `?debug=1` for internal testing.
- No secrets appear publicly.
- No official Polymarket approval claim appears.
- No guaranteed profit or trading advice language appears.
- Mobile layout works.

## 7. No-Go Criteria

- Homepage fails to load.
- Market cards fail to load.
- Waitlist storage fails.
- Alert storage fails.
- Outbound click storage fails.
- Feedback storage fails and beta feedback is considered launch-critical.
- Public page exposes private info.
- Public page claims official approval or guaranteed profits.
- `View on Polymarket` CTA breaks.
- Mobile layout is unusable.

## 8. Safe Public Positioning

Safe language:

- "A lightweight Polymarket market discovery and alerts beta."
- "Find active markets faster."
- "Watch live market signals."
- "Open relevant Polymarket markets faster."
- "Join the PBP Alerts beta."

## 9. Do Not Claim

- Do not claim official Polymarket approval.
- Do not claim Builder Program acceptance.
- Do not claim partnership.
- Do not claim guaranteed profits.
- Do not claim trading advice.
- Do not claim market predictions are certain.
- Do not claim user funds are handled by PBP.
- Do not claim PBP executes trades.

## 10. Intentionally Deferred

- Stripe/payment launch.
- Paid subscriptions.
- Official Builder reapplication.
- Wallet connection.
- Real order execution.
- Builder-attributed order flow.
- Advanced user accounts.
- Public admin dashboard.
- Aggressive marketing launch.

## 11. Known Polish Backlog

- Add more variety to "Why it matters" copy.
- Improve market ranking over time.
- Improve alert quality and noise control.
- Improve public beta copy.
- Eventually prepare Builder application summary.
- Eventually add better analytics summary for proof signals.

## 12. Recommended Soft Launch Plan

- Share with a small number of trusted users first.
- Ask users whether the market cards help them find interesting markets faster.
- Ask users whether alert signals are useful.
- Track waitlist signups.
- Track outbound clicks.
- Avoid paid ads until the value proposition is clearer.
- Collect feedback before Builder reapplication.

## 13. Historical Decision — Superseded for Current Pilot Clearance

Historical decision: GO for limited public beta / soft launch. For current status, see the [2026-10-21 pilot readiness gate](pilot-readiness-2026-10-21.md); the customer pilot is not cleared.

Not ready for:

- Paid launch.
- Official Builder reapplication.
- Broad marketing push.
