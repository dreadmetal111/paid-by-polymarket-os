# Daily Beta Review Routine

## 1. Purpose

This routine helps decide whether to build, wait, or fix confusion based on real Paid by Polymarket beta behavior.

Use it to review product health, early user signals, alert usefulness, and whether the public beta is helping people discover active Polymarket markets faster.

## 2. Daily Timing

Run this once per day during the soft launch, preferably at the same time each day.

Keep the review lightweight. The goal is to notice patterns, not to overreact to every small change.

## 3. Admin Metrics Check

Run this PowerShell block from your local machine:

```powershell
cd "C:\Users\dylan\OneDrive\Desktop\paid-by-polymarket-os"
powershell -ExecutionPolicy Bypass -File .\scripts\check-admin-status.ps1
```

Track:

* waitlist.count
* outboundClicks.count
* feedback.count
* alertSignals.count
* latestSignupAt
* latestClickAt
* latestFeedbackAt
* latestAlertAt
* storageMode
* all storage checks

Do not paste private emails, private feedback, secrets, or raw admin exports into public chats.

## 4. Discord Check

Review:

- New joins
- `#feedback` posts
- `#market-chat` discussion
- `#alerts` noise level
- Whether alerts are understandable
- Whether users ask for specific categories or watchlists

Look for repeated themes instead of reacting to one-off comments.

## 5. Website Spot Check

Quickly check:

- Homepage loads
- Category chips still work
- Grouped cards still look good
- Feedback form is visible
- Discord CTA works
- View on Polymarket works
- Mobile layout still works

Use the normal public URL for public-beta checks. Use debug mode only when checking internal/demo sections.

## 6. Acer Node Check

Run on Acer only if alerts seem stale or broken:

```bash
sudo systemctl status pbp-alert-worker --no-pager
sudo systemctl status pbp-watchtower --no-pager
```

Optional logs:

```bash
sudo journalctl -u pbp-alert-worker -n 50 --no-pager
sudo journalctl -u pbp-watchtower -n 50 --no-pager
```

Confirm services are active and alerts are being generated when market activity triggers them.

Do not paste private logs, private network details, webhook URLs, or secrets into public chats.

## 7. Daily Notes Template

Copy this into the daily notes:

```markdown
Date:
waitlist.count:
outboundClicks.count:
feedback.count:
alertSignals.count:
Discord joins:
Most common feedback theme:
Any bugs noticed:
Decision: wait / fix confusion / improve discovery / improve alerts / build next feature
```

## 8. Decision Rules

- If outbound clicks increase, improve discovery/ranking/event pages.
- If waitlist increases, improve alerts/watchlists.
- If feedback points to confusion, fix copy/navigation first.
- If alert noise complaints appear, tune alert thresholds.
- If no one clicks or joins, revisit the first screen/value proposition.
- If everything is healthy, avoid unnecessary changes and keep collecting data.

## 9. What Not To Do During Review

- Do not paste secrets into chat.
- Do not expose emails or private feedback publicly.
- Do not overreact to one comment.
- Do not add paid features before demand is clearer.
- Do not change API keys or trading flows during routine review.

## 10. Next Likely Product Build

Event detail page v0 for grouped market families.

This should help users open a grouped family, compare related markets, and understand the event context without building real trading, accounts, or payments.
