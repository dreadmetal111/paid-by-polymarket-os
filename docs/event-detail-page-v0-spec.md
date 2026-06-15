# Event Detail Page v0 Spec

## 1. Purpose

Event detail pages help users compare related markets in one place instead of scanning repeated cards.

Paid by Polymarket now groups related markets such as 2026 FIFA World Cup, Election / Midterms, Government leadership, Crypto, NBA, NHL / Stanley Cup, and Fed / Rates. The next product step is letting users open one grouped family into a focused event page or event section.

## 2. First Version Scope

Event detail page v0 should include:

- Event title
- Category
- Event/group description
- Number of related markets
- All related outcomes/markets
- Full market questions
- Outcome label when available
- YES price / probability when available
- Volume
- Liquidity
- Recent movement if available
- View on Polymarket CTA
- Preview YES / Preview NO safe preview actions

## 3. Out of Scope for v0

Do not include yet:

- Real trading
- Wallet connection
- User accounts
- Paid subscriptions
- Charts
- Discord watchlists
- Email alerts
- Event-specific notifications
- Polymarket Builder order attribution
- Private API keys

## 4. Navigation Flow

Suggested flow:

Grouped card -> Open Event / View Event -> event detail page or focused event section.

The grouped homepage card remains a quick summary. The event detail view becomes the place to compare all related outcomes or child markets.

## 5. Suggested URL Pattern

Use a safe frontend route or query parameter first:

- `/?event=2026-fifa-world-cup`

Later, if routing supports it:

- `/event/2026-fifa-world-cup`

The first version can be implemented with frontend state from the existing `liveMarkets` response.

## 6. Data Needed

Useful fields:

- `marketFamilyKey`
- `eventGroup`
- `displayCategory`
- `eventTitle`
- `eventSlug`
- `outcomeLabel`
- `marketQuestion`
- `yesPrice`
- `volume`
- `liquidity`
- `priceChange` / movement
- `marketUrl`
- `marketId`

## 7. Sorting Inside Event Page

Suggested sort options:

- Highest volume
- Most liquid
- Biggest movement
- Highest probability
- Lowest probability
- Alphabetical / outcome label

## 8. UI Layout

Simple layout:

- Event header
- Summary stats row
- Outcome table/list
- Child market cards on mobile
- Feedback/alert CTA near bottom

The desktop view can use a compact table-style list. The mobile view should use readable child market cards so long questions do not collapse or feel cramped.

## 9. Alert/Discord Future

Future extensions:

- “Notify me about this event”
- “Send this event to Discord alerts”
- Event-specific watchlists later

These should come after the event detail page proves useful for browsing and comparison.

## 10. Safety Rules

- Not financial advice.
- No guaranteed profits.
- Do not claim official Polymarket partnership.
- Full market question remains visible.
- Preview YES / Preview NO must remain safe preview only.
- View on Polymarket is the real market action.

## 11. Success Criteria

Event detail v0 is successful if:

- Grouped events are easier to understand.
- Repeated market families feel organized.
- Users click View on Polymarket from event outcomes.
- Users understand the difference between preview and real market opening.
- Mobile layout remains clean.

## 12. Implementation Notes for Later

- Reuse existing grouped market family data.
- Do not require private API keys.
- Preserve `/api/liveMarkets` compatibility.
- Consider adding `/api/events` or `/api/market-families` later only if needed.
- Start with frontend state from the existing `liveMarkets` response if possible.
