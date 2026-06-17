# Post-Application Operating Plan

## Purpose

Keep House of Markets stable, collect proof, and avoid risky changes while the Builder Program application is under review.

## Current Status

- Brand: House of Markets
- Domain: https://house-of-markets.com
- Builder Program application: submitted
- Public app: live
- Event detail page v0: live
- Visual market intelligence polish: live
- Discord alerts beta: live
- Acer alert worker/watchtower: live
- Supabase storage: healthy

## Daily Review Routine

Run once per day:

```powershell
cd "C:\Users\dylan\OneDrive\Desktop\paid-by-polymarket-os"
powershell -ExecutionPolicy Bypass -File .\scripts\check-admin-status.ps1
```

Track:

- `waitlist.count`
- `outboundClicks.count`
- `feedback.count`
- `alertSignals.count`
- `latestSignupAt`
- `latestClickAt`
- `latestFeedbackAt`
- `latestAlertAt`
- `storageMode`
- Storage checks

## Discord Review

Check:

- New joins
- `#feedback`
- `#market-chat`
- `#alerts` noise
- Questions about categories, watchlists, or event detail pages

## Stability Rules

Do not add during review period:

- Real trading
- Wallet connection
- Private API keys
- Builder API key usage
- Gasless transactions
- Attributed order flow
- Payments
- Subscriptions

Reason:

Current application story is discovery, event intelligence, safe previews, and outbound routing to Polymarket. Trading features should wait until there is Builder guidance or clear product need.

## Safe Product Work Allowed

Allowed improvements:

- Better event detail pages
- Better grouped market discovery
- Clearer copy
- Better alert reasons
- Improved feedback prompts
- Screenshots and proof assets
- Documentation cleanup
- Bug fixes

## Proof To Collect

Collect:

- Screenshots of homepage
- Intelligence strip
- Grouped cards
- Event detail page
- `View on Polymarket` CTA
- `Preview YES` / `Preview NO`
- Discord beta
- Admin checker summary with private fields excluded
- Outbound click increases
- Waitlist increases
- Feedback quotes only if private info is removed

## If Polymarket Responds

If accepted or contacted:

- Reply quickly
- Ask about builder-code attribution path
- Ask what they want to see next
- Do not paste secrets
- Do not expose private keys
- Confirm whether discovery-only routing is useful to them

If rejected or no response:

- Continue collecting traction
- Improve product depth
- Reapply later with stronger metrics and screenshots

## Next Safe Builds

Suggested order:

1. Builder screenshot and demo proof packet
2. Event detail page v1
3. Alert quality tuning
4. Watchlist interest capture
5. Builder attribution planning doc only

## Claims To Avoid

- Do not claim Builder Program acceptance
- Do not claim official Polymarket partnership
- Do not claim guaranteed profits
- Do not claim financial advice
- Do not imply trades happen inside House of Markets
- Do not imply builder attribution is live
