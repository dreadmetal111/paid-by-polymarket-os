# PBP Alerts Launch Readiness

Beginner-friendly launch-readiness summary for Paid by Polymarket OS and PBP Alerts.

## 1. Current Status

- PBP Alerts MVP is live.
- Waitlist is live.
- Supabase durable storage is working.
- Admin status endpoint is working.
- Acer alert worker is pushing sanitized alerts to Render.
- Public homepage displays live sanitized alert signals.

## 2. Confirmed Live System Path

Safe public alert pipeline:

- Acer alert worker -> `POST /api/internal/alerts` -> Supabase `alert_signals` -> `GET /api/alerts/recent` -> Homepage Latest Alert Signals

This path is designed to publish only sanitized public alert records.

## 3. Privacy / Safety Boundaries

- Acer Node remains private.
- Discord webhook remains private.
- Supabase service role key remains private.
- Admin routes remain protected.
- Waitlist emails are not displayed publicly.
- Public alerts are sanitized only.
- Do not paste secrets, private logs, local IPs, webhook URLs, admin export data, or real emails into public chats, screenshots, or docs.

## 4. Admin Commands

Before running the admin checker, set `PBP_ADMIN_SECRET` locally in the same PowerShell session:

```powershell
$env:PBP_ADMIN_SECRET = "paste-your-admin-secret-here"
```

Run the local admin status checker with ExecutionPolicy bypass:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-admin-status.ps1
```

Check the public recent-alert feed:

```powershell
Invoke-RestMethod -Method Get -Uri "https://paid-by-polymarket-os.onrender.com/api/alerts/recent" | ConvertTo-Json -Depth 5
```

The public recent-alert command must not require any secret because it only returns sanitized alert records.

## 5. Launch Readiness Checklist

- [ ] Homepage loads.
- [ ] Waitlist form submits.
- [ ] Admin status shows `storageMode` as `supabase`.
- [ ] `waitlistStorage` is `ok`.
- [ ] `alertStorage` is `ok`.
- [ ] `alertSignals.count` is visible.
- [ ] `/api/alerts/recent` returns sanitized alerts.
- [ ] Latest Alert Signals shows live alerts.
- [ ] Mobile layout looks clean.
- [ ] No private infrastructure is visible on the frontend.

## 6. Not Ready Yet / Later

- Stripe/payment tiers.
- User accounts.
- Paid Discord access.
- Email automation.
- Full admin dashboard UI.
- Polymarket Builder application materials.
- Real-money independent prediction market.

## 7. Recommended Next Product Step

- Collect a few real waitlist signups.
- Improve alert quality and noise filtering.
- Add simple "join beta" copy.
- Later test Stripe only after signs of demand.
