# Discord Alerts Beta Ops Checklist

## Purpose

This checklist helps run the free Paid by Polymarket Discord Alerts Beta safely during the public beta.

The goal is to give early users a simple place to see alerts, ask questions, and share feedback without exposing private infrastructure or implying trading advice.

## Discord Channel Setup

Recommended starter channels:

- `#start-here`
- `#alerts`
- `#feedback`

Keep the server simple for the public beta. Do not add paid roles, complex automation, or trading execution flows yet.

## #start-here

Use this channel to explain what the beta is:

- Paid by Polymarket is a lightweight Polymarket market discovery and alerts beta.
- Alerts are meant to help users notice market movement and activity faster.
- Alerts are informational only.
- Users should do their own research before opening any market.
- The beta is early and feedback is welcome.

Include this disclaimer:

> Alerts are not financial advice. Alerts do not guarantee profits. Paid by Polymarket is not officially approved by, partnered with, or endorsed by Polymarket.

## #alerts

Use this channel for alert posts only.

Alerts may include:

- Market movement alerts
- High-volume market alerts
- Volume/liquidity spike alerts
- New high-activity market alerts

What alerts mean:

- An alert means a market crossed a configured activity or movement threshold.
- An alert does not mean a trade is recommended.
- An alert does not mean the market outcome is more likely to happen with certainty.
- An alert is a signal to inspect the market, not an instruction to trade.

How often alerts may post:

- Alerts may post when market activity triggers the Acer alert worker rules.
- Some periods may have no alerts.
- Busy market periods may produce several alerts.
- If the channel feels noisy, tune alert thresholds before broadening access.

## #feedback

Use this channel for beta feedback.

Ask users:

- Were the alerts useful or noisy?
- Did any alert make you want to open Polymarket?
- Were alert reasons clear?
- Which categories or market types do you want to track?
- What should be simplified?
- What felt confusing?

Do not ask users to paste private wallet details, private keys, emails, or financial information.

## Moderation Rules

Recommended rules:

- Be respectful.
- No spam.
- No harassment.
- No financial advice.
- No guaranteed-profit claims.
- No pump groups or coordinated manipulation.
- No private keys, seed phrases, wallet secrets, or API keys.
- No impersonation of Polymarket or Paid by Polymarket operators.
- Keep alert discussion focused on product feedback and market discovery.

Remove posts that make aggressive trading claims, request secrets, or imply guaranteed outcomes.

## What Not To Expose

Never share:

- Discord webhook URLs
- Discord bot tokens
- Private environment values
- Supabase service role keys
- Admin secrets
- Acer Node private IPs or private network details
- Waitlist emails
- Private feedback messages outside the intended admin context
- Wallet private keys, seed phrases, or trading credentials

The public Discord invite can be shared only when the beta server is ready.

## Acer Alert Worker Check

On Acer Node, check that the alert worker is still running:

```bash
systemctl status pbp-alert-worker
```

Check recent logs:

```bash
journalctl -u pbp-alert-worker -n 80 --no-pager
```

Confirm:

- The service is active.
- The worker is polling live markets.
- Alerts are being generated when market activity triggers them.
- Discord alert sends are succeeding.
- Render alert ingest warnings are not repeating.

Do not paste secrets, webhook URLs, private IPs, or raw private logs into public chats.

## Public Site Metrics Check

From the local project folder, set the admin secret locally before running the checker:

```powershell
$env:PBP_ADMIN_SECRET = "paste-your-admin-secret-here"
```

Then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-admin-status.ps1
```

Confirm safe summary fields:

- `storageMode`
- `waitlist.count`
- `alertSignals.count`
- `outboundClicks.count`
- `feedback.count`
- `checks.waitlistStorage`
- `checks.alertStorage`
- `checks.outboundClickStorage`
- `checks.feedbackStorage`

Do not use `/api/admin/waitlist` unless an email export is actually needed.

## Public Site Discord Invite Check

If `PBP_DISCORD_INVITE_URL` is configured on Render, confirm:

- The waitlist form submits successfully.
- After signup, the page shows “Join free Discord alerts beta.”
- The button opens the intended Discord invite.

If the invite is not configured, confirm:

- The waitlist form submits successfully.
- The page shows “Discord beta invite coming soon.”

Never configure a webhook URL as the public invite URL.

## Noise Review

Review the Discord alerts channel regularly:

- Are the alerts readable?
- Are reasons clear?
- Are too many similar markets posting?
- Are low-value markets getting through?
- Are users asking for a category that is not covered?

If alerts feel noisy, tune thresholds before inviting more users.

## Next Roadmap

Later improvements:

- Discord roles
- Watchlists
- Event-specific alerts
- Slash commands
- Private beta channel
- Premium channels later

Do not add paid Discord access until the free beta shows clear demand.
