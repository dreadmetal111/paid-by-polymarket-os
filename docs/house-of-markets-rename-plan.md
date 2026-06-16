# House of Markets Rename Plan

## Purpose

This document explains what changes and what does not change before renaming the public app from "Paid by Polymarket OS" to "House of Markets."

The goal is to rename public-facing product copy in a controlled way while keeping internal operations stable.

## Rename Decision

Working public beta brand: House of Markets.

Status: yellow-green preliminary clearance. Acceptable for controlled beta rename planning, not legal advice.

## Positioning

House of Markets is a prediction-market intelligence desk for discovering active markets, tracking event signals, and finding what is moving.

## Public Tagline

Primary:

Your home base for prediction markets.

Alternates:

- Find the markets moving before everyone else.
- Track the events behind the odds.
- Prediction-market signals without the noise.
- Discover active markets faster.

## Public App Copy Changes

Plan to update:

- Browser title
- Main header/logo text
- Hero headline/subheadline
- "Why Paid by Polymarket?" section
- Waitlist/alerts beta copy
- Discord invite copy
- Footer/disclaimer
- Public-facing "Paid by Polymarket OS" wording

## Do Not Change Yet

Do not change:

- Repo name
- Local folder path
- Render service name
- Env var names
- Supabase table names
- Scripts
- Acer service names
- API route names
- Discord webhook config
- Internal docs history

Reason: public copy can change first while internal ops remain stable.

## Draft Public Copy

Site name: House of Markets

Hero headline:

Find active prediction markets faster.

Hero subheadline:

House of Markets helps you discover grouped market opportunities, track event signals, and open real markets on Polymarket when you are ready.

Primary CTA:

Join the Alerts Beta

Secondary CTA:

Browse Live Markets

Discovery heading:

Live Market Signals

Why heading:

Why House of Markets?

Why bullets:

- Group related markets by event.
- Spot active markets without scanning endless cards.
- Track movement, volume, and liquidity signals.
- Open real markets on Polymarket.
- Keep preview actions safe until you decide to leave the site.

Disclaimer:

House of Markets is an independent market discovery and alerts project. It is not financial advice and is not an official Polymarket product or partnership.

## Discord Rename Plan

Plan to update:

- Server name to House of Markets Beta
- #start-here copy
- #alerts disclaimer
- #feedback prompt
- #announcements intro

Do not change channel structure yet.

## Domain / Handle Plan

Preferred: houseofmarkets.io

Backup: houseofmarkets.market

Do not buy premium houseofmarkets.com yet.

Suggested handles:

- @joinhouseofmarkets
- @houseofmarketsapp
- @gethouseofmarkets

## Safety Rules

- Do not claim official Polymarket partnership.
- Do not imply guaranteed profits.
- Do not promise financial advice.
- Keep "View on Polymarket" as routing language.
- Keep Preview YES / Preview NO as preview-only actions.
- Keep old internal names where changing them creates risk.

## Rollout Order

1. Update public copy locally.
2. Test homepage, category chips, grouped cards, feedback form, Discord CTA, and mobile layout.
3. Confirm admin checker still works.
4. Deploy to Render.
5. Update Discord wording.
6. Run admin checker after deploy.
7. Watch metrics for 24-48 hours.

## Success Criteria

The rename works if:

- Users understand the site faster.
- Waitlist CTA is clearer.
- No one thinks the app is official Polymarket.
- Outbound clicks still work.
- Feedback still works.
- Metrics still record.

## Next Step

If approved:

Pre-launch Fix #30: Public app copy renamed to House of Markets
