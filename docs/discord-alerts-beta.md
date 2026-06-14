# Discord Alerts Beta

## MVP Explanation

Paid by Polymarket Alerts Beta lets early waitlist users become some of the first free Discord alert beta users.

The MVP flow is intentionally simple:

- A user submits their email to the PBP Alerts Beta waitlist.
- After a successful signup, the public UI shows a Discord alerts beta call-to-action.
- If a public Discord invite is configured, the user can open the invite.
- If no invite is configured, the UI says the Discord beta invite is coming soon.

This does not create a Discord bot, Discord OAuth flow, automatic role assignment, or paid access system.

## Required Environment Variable

Set this on Render when the Discord beta invite is ready:

```bash
PBP_DISCORD_INVITE_URL=https://discord.gg/your-public-invite
```

The app exposes this only through the public-safe endpoint:

```http
GET /api/public-config
```

If `PBP_DISCORD_INVITE_URL` is missing or invalid, the endpoint returns `discordInviteEnabled: false`.

## Safety Boundaries

- Discord webhook URLs remain private.
- Discord bot tokens are not used.
- Discord OAuth is not used.
- Discord roles are not assigned automatically.
- Email signup does not automatically identify Discord users.
- Discord user IDs are not stored yet.
- No trading keys are requested.
- No real trading is built into this flow.
- Do not claim guaranteed profits, trading advice, official Polymarket approval, or partnership.

## Current User Experience

After a successful PBP Alerts waitlist signup:

- If the invite is configured, users see: “Join free Discord alerts beta.”
- If the invite is not configured, users see: “Discord beta invite coming soon.”

The Latest Alert Signals card also points interested users toward the alerts beta.

## Future Roadmap

- Private beta Discord channel
- Discord roles
- Watchlists
- Slash commands
- Event-specific alerts
- Premium channels later

Keep the MVP simple until there is enough beta demand to justify the next Discord integration step.
