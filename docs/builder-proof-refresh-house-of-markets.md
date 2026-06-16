# Builder Proof Refresh: House of Markets

## Current Public Brand

House of Markets

House of Markets was formerly called Paid by Polymarket OS. The app was renamed to reduce affiliation confusion, make the public product feel more independent, and avoid implying that it is an official Polymarket property.

House of Markets is an independent project. It is not an official Polymarket product or partnership.

## Current Product Flow

1. User lands on House of Markets.
2. User browses grouped live market families.
3. User opens an event detail view.
4. User compares related markets and outcomes.
5. User can preview YES/NO safely.
6. User can click `View on Polymarket` to open the real market.

This creates a simple product loop:

Discover active event -> compare related markets -> open real market on Polymarket.

## Builder Program Relevance

This matters for Polymarket because House of Markets:

- Improves market discovery.
- Organizes repeated and related market cards into event families.
- Gives users a focused event detail view for comparing related outcomes.
- Sends interested users to Polymarket through `View on Polymarket`.
- Uses safe preview behavior instead of pretending to execute trades.
- Supports Discord alerts beta as a discovery loop.
- Tracks outbound click proof in a privacy-safe way.

## Live Features To Show

- House of Markets branding.
- Grouped market discovery.
- Category chips.
- Event detail page v0.
- Related child market cards.
- `View on Polymarket` buttons.
- `Preview YES` / `Preview NO` safe previews.
- Alerts beta waitlist.
- Discord alerts beta.
- Feedback form.

## Current Metrics Snapshot

Use the latest safe admin checker output before sharing Builder proof. Do not include private emails, secrets, raw feedback, IPs, webhook URLs, or Supabase keys.

Latest documented baseline:

- `waitlist.count`: 2+; refresh with admin checker before submission.
- `outboundClicks.count`: 4+; refresh with admin checker before submission.
- `feedback.count`: enabled; refresh exact count with admin checker before submission.
- `alertSignals.count`: 18+; refresh with admin checker before submission.
- `latestSignupAt`: refresh with admin checker before submission.
- `latestClickAt`: refresh with admin checker before submission.
- `latestFeedbackAt`: refresh with admin checker before submission.
- `latestAlertAt`: refresh with admin checker before submission.
- `storageMode`: supabase.
- `storage checks`: waitlistStorage ok, alertStorage ok, outboundClickStorage ok, feedbackStorage enabled / verify with admin checker.

Safe admin command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-admin-status.ps1
```

## Screenshot Checklist

Capture these screenshots for Builder Program proof:

- Homepage hero showing House of Markets.
- Grouped market discovery.
- Category chips.
- Event detail page.
- Event child market cards.
- `View on Polymarket` CTA.
- Safe `Preview YES` / `Preview NO`.
- Discord alerts beta server.
- Admin checker summary with private fields excluded.

## Claims To Avoid

- Do not claim Builder Program acceptance.
- Do not claim official Polymarket partnership.
- Do not claim guaranteed profits.
- Do not claim financial advice.
- Do not imply live trading happens inside House of Markets.

## Recommended Builder Narrative

House of Markets is an independent discovery and alerts layer for Polymarket. It helps users find active prediction-market events, compare related markets in a focused event view, and route to Polymarket when they are ready to act. The product is designed to increase useful discovery and outbound market engagement while keeping trading actions on Polymarket.
