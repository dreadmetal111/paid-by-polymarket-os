# PBP Alerts Admin Operating Checklist

Simple daily and weekly operating checklist for Paid by Polymarket OS and PBP Alerts. Use this to verify the system without dumping private waitlist data.

## 1. Daily Admin Check

- Check the protected admin status endpoint: `GET /api/admin/status`

- Confirm:
  - `storageMode` is `supabase`
  - waitlist `count` is visible
  - `latestSignupAt` looks reasonable
  - `checks.waitlistStorage` is `ok`
- Do not use `/api/admin/waitlist` unless email export is actually needed.

## 2. Waitlist Safety Rule

- `/api/admin/status` is safe for routine checks.
- `/api/admin/waitlist` exposes emails and should be used only when needed.
- Never paste real waitlist emails into public chats, screenshots, or logs.

## 3. Render Check

- Check the Render service is live.
- Check the latest deploy succeeded.
- Look for repeated backend errors in logs.

## 4. Supabase Check

- Confirm `waitlist_submissions` exists.
- Confirm new signups appear.
- Do not expose the `service_role` key.
- Use Table Editor or SQL Editor only when needed.

## 5. Acer Node / Alerts Worker Check

- Check PBP alert worker health if on local network or Tailscale.
- Confirm recent alerts are being generated when market activity triggers them.
- Confirm the Discord alerts channel is receiving alerts when expected.

## 6. Discord Check

- Confirm the Paid by Polymarket alerts channel is not spammed.
- Confirm alerts are readable and useful.
- Watch for false positives or noisy alert types.

## 7. Weekly Product Review

- How many waitlist signups?
- Did alerts fire?
- Which alert examples are best for homepage or social proof?
- Any Render, Supabase, or Acer reliability issues?
- What should be improved next?

## 8. Current Milestone Status

- v0.1 Alerts landing/waitlist UI live
- v0.2 Backend waitlist route live
- v0.3 Protected admin waitlist export live
- v0.4 Supabase durable waitlist storage live
- v0.5 Protected admin status endpoint live
