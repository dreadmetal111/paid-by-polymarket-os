# Builder Program Application Packet v1

## Product Name

House of Markets.

Former working name: Paid by Polymarket OS.

## One-Sentence Summary

House of Markets is an independent prediction-market intelligence layer that helps users discover active market events, compare related Polymarket markets, and open real markets on Polymarket when ready.

## One-Paragraph Summary

House of Markets helps users move from market discovery to Polymarket action with less noise. The product groups related Polymarket markets into event families, adds focused event detail pages for comparing related outcomes, highlights movement, volume, and liquidity signals, and keeps `Preview YES` / `Preview NO` as safe preview-only actions. When a user is ready to act, the primary path is `View on Polymarket`, which routes them to the real market on Polymarket. The alerts beta and Discord loop extend the discovery layer by helping users monitor live market signals over time. House of Markets is independent and does not claim to be an official Polymarket product or partnership.

## Problem

Polymarket has many related markets spread across repeated event themes. Discovery can feel fragmented, noisy, and card-heavy.

Users may see many similar markets without an easy way to understand the event family, compare related outcomes, or decide which market is worth opening.

## Solution

House of Markets groups related markets into event families, highlights active signals, and gives users focused event pages before routing them to Polymarket.

The product helps users:

- Find active prediction-market events faster.
- Compare related markets in one focused view.
- Understand volume, liquidity, and movement signals.
- Preview interest safely before leaving the site.
- Open the real market on Polymarket when ready.

## Current Live Flow

1. User lands on House of Markets.
2. User sees live intelligence strip and active market signals.
3. User browses grouped events by category.
4. User opens event detail page.
5. User compares related markets.
6. User previews YES/NO safely.
7. User clicks `View on Polymarket`.

## Current Live Features

- House of Markets branding.
- Grouped market discovery.
- Category chips.
- Visual intelligence strip.
- Heat badges.
- Movement visuals.
- Event detail page v0.
- Event sorting.
- `View on Polymarket` buttons.
- Safe `Preview YES` / `Preview NO`.
- Alerts beta waitlist.
- Discord alerts beta.
- Feedback form.
- Admin checker.
- Acer alert worker/watchtower.

## Builder Program Fit

House of Markets fits the Builder Program because it improves discovery and creates a cleaner path into Polymarket markets.

The current product:

- Organizes repeated markets into useful event families.
- Helps users understand related outcomes before opening a market.
- Increases outbound market engagement through `View on Polymarket`.
- Educates users before market open with public-safe signals and preview actions.
- Creates a future path to builder order attribution.
- Avoids fake trading claims and does not pretend to execute trades inside House of Markets.

The current Builder story is discovery, outbound routing, and future order-attribution readiness.

## Current Metrics Snapshot

Use the latest safe admin checker output before submitting or sharing this packet. Do not include private emails, raw feedback, IPs, webhook URLs, Supabase keys, or admin secrets.

- `waitlist.count`:
- `outboundClicks.count`:
- `feedback.count`:
- `alertSignals.count`:
- `latestSignupAt`:
- `latestClickAt`:
- `latestFeedbackAt`:
- `latestAlertAt`:
- `storageMode`:
- `storage checks`:

Safe admin command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-admin-status.ps1
```

## Builder Integration Roadmap

Phase 1 current:

- Public discovery.
- Outbound links.
- Alerts beta.
- Feedback loop.
- No real trading.

Phase 2 attribution planning:

- Builder profile/code.
- Order attribution docs.
- Safe attributed routing design.

Phase 3 future after approval:

- Wallet onboarding.
- Gasless trading.
- Attributed orders.
- Builder-fee-compatible routing.

## What We Are Asking For

Draft ask:

- Feedback on Builder Program fit.
- Guidance on attribution-ready routing.
- Grant/support consideration.
- Technical guidance.
- Eventual attributed order flow path.

## Screenshot Checklist

Capture:

- Homepage hero.
- Intelligence strip.
- Grouped cards.
- Heat badges.
- Category chips.
- Event detail page.
- Related cards.
- `View on Polymarket`.
- `Preview YES` / `Preview NO`.
- Discord beta.
- Admin checker summary without private fields.

## Claims To Avoid

- Do not claim Builder Program acceptance.
- Do not claim official Polymarket partnership.
- Do not claim guaranteed profits.
- Do not claim financial advice.
- Do not claim in-app trade execution.
- Do not claim builder attribution is live.

## Application Draft

House of Markets is an independent prediction-market discovery and alerts layer built around Polymarket market discovery. The product helps users find active market events faster, compare related markets in a focused event detail view, and route to the real market on Polymarket when they are ready.

The current version focuses on public discovery and user intent routing. It groups related markets into event families, provides category browsing, adds a live market intelligence strip, highlights volume, liquidity, and movement signals, and includes an event detail page where users can compare related outcomes. The primary action is `View on Polymarket`. The app also includes safe `Preview YES` / `Preview NO` actions that help users evaluate interest without implying in-app trade execution.

House of Markets also includes an alerts beta with a waitlist, live public alert signals, and a Discord alerts loop. This creates a retention layer around discovery: users can browse active markets on the website, monitor signals through alerts, and return to Polymarket when a market becomes relevant.

The project is intentionally careful about safety and claims. House of Markets is not an official Polymarket product or partnership, does not claim guaranteed profits, does not provide financial advice, and does not currently execute trades, connect wallets, or use private trading API keys. The current Builder Program story is discovery, outbound routing, and future attribution readiness.

We are looking for feedback on whether this discovery and alerts layer is a good fit for the Builder Program, guidance on attribution-ready routing, and technical direction for a future path toward builder-attributed order flow if the product is accepted and the integration is approved.
