# PBP Alerts Admin Operating Checklist

Simple daily and weekly operating checklist for Paid by Polymarket OS and PBP Alerts. Use this to verify the system without dumping private waitlist data.

## 1. Daily Admin Check

- Check the protected admin status endpoint: `GET /api/admin/status`
- The easiest local check is:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-admin-status.ps1
```

- Confirm:
  - `storageMode` is `supabase`
  - waitlist `count` is visible
  - `latestSignupAt` looks reasonable
  - `checks.waitlistStorage` is `ok`
  - feedback `count` is visible when feedback status is deployed
  - `checks.feedbackStorage` is `ok` when feedback status is deployed
- Do not use `/api/admin/waitlist` unless email export is actually needed.

## 2. Daily Alert Bridge Check

- Run `scripts/check-admin-status.ps1`.
- Confirm `alertSignals.count` is visible.
- Confirm `alertSignals.latestAlertAt` updates when real alerts are pushed.
- Confirm `checks.alertStorage` is `ok`.
- Confirm the public recent-alert endpoint returns sanitized alerts only:

```powershell
Invoke-RestMethod -Method Get -Uri "https://paid-by-polymarket-os.onrender.com/api/alerts/recent" | ConvertTo-Json -Depth 5
```

## 3. Waitlist Safety Rule

- `/api/admin/status` is safe for routine checks.
- `/api/admin/waitlist` exposes emails and should be used only when needed.
- Never paste real waitlist emails into public chats, screenshots, or logs.

## 4. Beta Feedback Check

- Confirm the public beta feedback form submits successfully.
- Confirm `feedback.count` appears in protected admin status when feedback status is deployed.
- Confirm `checks.feedbackStorage` is `ok` when feedback status is deployed.
- Do not paste private feedback messages, real emails, or raw feedback submissions into public chats, screenshots, or logs.

## 5. Public URL / Debug URL Check

- Normal public URL: [https://paid-by-polymarket-os.onrender.com/](https://paid-by-polymarket-os.onrender.com/)
- Internal debug URL: [https://paid-by-polymarket-os.onrender.com/?debug=1](https://paid-by-polymarket-os.onrender.com/?debug=1)
- Confirm advanced/internal demo sections are hidden on the normal public URL.
- Confirm advanced/internal demo sections are visible with `?debug=1` for internal testing.
- Do not share the debug URL as the normal public beta entry point.

## 6. Render Check

- Check the Render service is live.
- Check the latest deploy succeeded.
- Look for repeated backend errors in logs.

## 7. Supabase Check

- Confirm `waitlist_submissions` exists.
- Confirm `alert_signals` exists.
- Confirm `beta_feedback` exists if feedback storage is enabled in Supabase.
- Confirm new waitlist signups appear.
- Confirm new sanitized alert signals appear.
- Confirm new beta feedback appears when testing feedback storage.
- Do not expose the Supabase service role key.
- Use Table Editor or SQL Editor only when needed.

## 8. Acer Node / Alerts Worker Check

- Check PBP alert worker health if on local network or Tailscale.
- Confirm recent alerts are being generated when market activity triggers them.
- Confirm the Discord alerts channel is receiving alerts when expected.
- Confirm the worker is pushing sanitized alert signals to Render when configured.
- Do not expose Acer IPs, local network details, local paths, or private worker logs publicly.

## 9. Discord Check

- Confirm the Paid by Polymarket alerts channel is not spammed.
- Confirm alerts are readable and useful.
- Watch for false positives or noisy alert types.
- Do not expose Discord webhook URLs.

## 10. Privacy Safety Rules

- Do not paste real emails.
- Do not paste private feedback messages.
- Do not paste secrets.
- Do not expose Acer IPs.
- Do not expose Discord webhooks.
- Do not expose the Supabase service role key.
- Do not paste admin export data or raw feedback submissions into public chats, screenshots, or logs.

## 11. Weekly Product Review

- How many waitlist signups?
- How many beta feedback submissions?
- Did alerts fire?
- Did sanitized alert signals reach the homepage?
- Did users report confusion or missing features in beta feedback?
- Which alert examples are best for homepage or social proof?
- Any Render, Supabase, or Acer reliability issues?
- What should be improved next?

## 12. Current Milestone Status

- v0.1 Alerts landing/waitlist UI live
- v0.2 Backend waitlist route live
- v0.3 Protected admin waitlist export live
- v0.4 Supabase durable waitlist storage live
- v0.5 Protected admin status endpoint live
- v0.6 Admin ops checklist live
- v0.7 Safe public alert preview live
- v0.8 Mobile polish live
- v0.9 Local admin status checker live
- v1.0 Render-side alert bridge foundation live
- v1.1 Admin checker includes alert status live
- v1.2 Acer alert worker to Render alert bridge live
- v1.3 Homepage displays live sanitized alert signals live
- v1.4 Public live alert feed status badge live
- v1.5 Public beta feedback collection live
- v1.6 Advanced/internal demo sections hidden from normal public beta live
