# House of Markets — #54B Architecture and Ownership Canon

**Status:** Adopted canon  
**Prepared:** 2026-06-20  
**Project:** House of Markets / Paid by Polymarket OS  
**Purpose:** Define exactly what runs where, which system owns each responsibility, how data moves, and what must never depend on Dylan's Windows workstation.

---

## 1. Executive decision

House of Markets uses five operating layers:

1. **Render** — public web application and public API
2. **Supabase** — durable cloud data store
3. **GitHub** — source-of-truth code and deployment history
4. **Acer Node** — private always-on automation and monitoring host
5. **Windows Workstation** — development and manual QA only

Operating rule:

> Turning off the Windows workstation must not interrupt the public site, snapshots, alert detection, Discord delivery, monitoring, or scheduled automation.

The Acer Node has passed reboot recovery, network-readiness, firewall, Docker, service, and Tailscale persistence tests. It is the approved always-on operations host.

---

## 2. Product definition

House of Markets is the public-facing brand and product experience.

Paid by Polymarket OS is the underlying prediction-market discovery, ranking, alerting, routing, and automation system.

Primary product promise:

> See what prediction markets are moving, understand why, and track what matters.

The product is a discovery and intelligence layer. It is not an official Polymarket product, a betting-picks service, or an independent real-money prediction market.

---

## 3. System ownership matrix

| Layer | Status | Owns | Must not own |
|---|---|---|---|
| Render | LIVE | Public site, public API, normalized market responses, public product routes, safe server-side builder logic | Long-running hourly workers, private admin dashboards, local-only monitoring |
| Supabase | LIVE / EXPANDING | Durable market snapshot history; approved future home for public alert records, attribution events, waitlist records, and analytics events | UI rendering, scheduled workers, secret-bearing business logic |
| GitHub | LIVE | Canonical non-secret source code, documentation, deployment history, change review, rollback points | Runtime secrets, webhook URLs, unencrypted environment files |
| Acer Node | LIVE | Hourly snapshot capture, alert worker, Watchtower, Discord delivery, Uptime Kuma, Portainer, heartbeat, private operational logs, systemd timers | Public customer traffic, canonical product source, irreplaceable business data stored only locally |
| Windows Workstation | DEV ONLY | VS Code, Git operations, browser testing, manual QA, design/content work, controlled local development | Any required 24/7 task, production cron, alert delivery, snapshot capture, public hosting |

---

## 4. Render responsibilities

Render hosts the public Node.js/Express application and static frontend.

Key public responsibilities:

- serve the public House of Markets website
- expose `/api/liveMarkets`
- normalize external prediction-market data
- serve ranked market views and market detail routes
- serve public historical chart data sourced from durable storage
- handle builder/referral routing logic where supported
- keep guarded real-submit behavior OFF by default
- receive alert-ingest events from the Acer Node where configured

Rules:

- Render is the only public application runtime.
- The browser must never call Acer private services directly.
- Builder and service secrets remain server-side.
- Render's local filesystem is never treated as durable storage.
- Background jobs must not depend on Render staying awake continuously.
- A Render redeploy must not erase durable market or alert history.

---

## 5. Supabase responsibilities

### Current confirmed role

Supabase stores durable market snapshot history produced by the Acer snapshot worker.

### Approved expansion role

Supabase should become the durable cloud system of record for:

- market snapshots
- public alert events
- alert delivery status summaries
- link attribution and click events
- waitlist or beta signup records
- future product analytics needed by the public site

Rules:

- Durable business data must survive Acer replacement or Render redeployment.
- Acer SQLite databases are operational state and local audit caches, not the sole business record.
- Public clients receive only data permitted by API or row-level-security policy.
- Service-role keys remain server-side or on the private Acer Node.
- Schema changes must be documented and reproducible.

---

## 6. GitHub responsibilities

GitHub is the source of truth for all non-secret project assets.

It owns:

- Render application source
- frontend assets
- backend routes and services
- database migrations or schema files
- Acer worker source code
- systemd unit templates and safe deployment scripts
- architecture documents
- runbooks
- issue and milestone history

Never commit:

- `.env` files
- Discord webhook URLs
- Supabase service-role keys
- builder API secrets or passphrases
- alert-ingest secrets
- private keys
- copied production databases containing sensitive records

Every production change should be traceable to a commit or documented operational change.

The Acer service code and service templates should be mirrored into a private or appropriately secured repository if they are not already version-controlled.

---

## 7. Acer Node responsibilities

The Acer Node is the private always-on operations host.

Current confirmed services:

- `pbp-alert-worker.service`
- `pbp-watchtower.service`
- `pbp-snapshot-capture.service`
- `pbp-snapshot-capture.timer`
- `heartbeat.service`
- `pbp-docker-firewall.service`
- Docker
- Tailscale
- SSH
- Uptime Kuma
- Portainer

### Current ports

| Port | Service | Access policy |
|---:|---|---|
| 22 | SSH | Tailscale and approved home LAN |
| 3001 | Uptime Kuma | Tailscale and approved home LAN |
| 5050 | Heartbeat | Tailscale, approved home LAN, internal monitoring |
| 5080 | Watchtower | Tailscale, approved home LAN, internal monitoring |
| 5090 | Alert worker API | Tailscale and approved home LAN |
| 8000 | Portainer Edge tunnel | Blocked externally |
| 9443 | Portainer | Tailscale and approved home LAN |

Rules:

- No Acer service is exposed as a public customer API.
- UFW defaults to deny incoming and deny routed traffic.
- Docker-published ports are additionally filtered through persistent firewall rules.
- Workers wait for real outbound HTTPS readiness before starting.
- Services restart automatically after failure and reboot.
- Environment files stay private and permission-restricted.
- Logs must never print secret values.
- Local SQLite state should be backed up, but durable public data belongs in Supabase.

---

## 8. Windows Workstation responsibilities

The Windows workstation is approved as a development and QA machine.

It owns:

- VS Code editing
- Git pull, commit, and push
- local Node/Python testing
- browser QA
- image and content production
- controlled database inspection
- manual deployment verification
- SSH administration of the Acer Node through Tailscale

Rules:

- It may be powered off at any time without breaking production.
- No production timer, bot, alert worker, or monitoring process may live only on Windows.
- Local repositories must be pushed before BIOS, OS, or hardware maintenance.
- Local `.env` files and credentials references must be backed up securely, never committed.
- BIOS, TPM, Secure Boot, and Windows upgrades are maintenance work, not production infrastructure work.

---

## 9. Canonical data flows

### Public discovery

```text
User browser
  -> Render public site
  -> Render internal API
  -> external market data sources
  -> normalization/ranking
  -> public market cards and detail views
  -> builder/referral-linked Polymarket route
```

### Historical snapshots

```text
Acer snapshot timer
  -> Render /api/liveMarkets
  -> normalized market records
  -> Supabase market snapshot history
  -> Render historical-chart API
  -> public chart and export views
```

### Alerts

```text
Acer alert worker
  -> Render /api/liveMarkets
  -> compare current and prior state
  -> local operational state / SQLite
  -> Discord alert
  -> Render alert ingest where configured
  -> approved durable alert record in Supabase
```

### Monitoring

```text
Acer Watchtower
  -> Render homepage and public API
  -> local health database and task log
  -> Discord state-change or daily report

Uptime Kuma
  -> Acer private services
  -> private operational dashboard
```

### Deployment

```text
Windows development
  -> Git commit and push
  -> GitHub source of truth
  -> Render deployment
  -> public smoke test
  -> Acer Watchtower observes production health
```

---

## 10. Single source of truth by domain

| Domain | Source of truth |
|---|---|
| Public application code | GitHub |
| Public runtime | Render |
| Durable snapshots and product records | Supabase |
| Live operational worker state | Acer Node |
| Monitoring status | Uptime Kuma + Watchtower |
| Secrets | Render secret environment and private Acer environment files |
| Product roadmap and architecture | GitHub documentation |
| Local development copy | Windows workstation, synchronized from GitHub |

No domain may have two competing sources of truth.

---

## 11. Failure boundaries

### Windows workstation offline

- public site continues
- snapshots continue
- alerts continue
- Discord delivery continues
- monitoring continues

### Acer Node offline

- public Render site continues
- live market discovery continues
- existing Supabase history remains available
- new hourly snapshots stop
- new alerts and Acer monitoring stop
- recovery action: restore Acer or deploy workers to a replacement private/cloud host

### Render offline

- public site and API unavailable
- Acer Watchtower detects failure
- snapshot and alert workers retry safely
- Discord receives a degradation notice when connectivity allows

### Supabase offline

- live discovery may continue from Render's market sources
- historical writes and durable alert records pause or fail safely
- workers must retry without duplicating records
- public historical features should show a controlled unavailable state

### GitHub unavailable

- running production continues
- deployments and source updates pause
- no runtime should require GitHub to answer user requests

---

## 12. Security and secret ownership

### Render-only or server-side secrets

- builder API credentials
- builder secret/passphrase
- guarded real-submit flags and confirmation values
- Supabase service credentials used by the public backend
- any relayer credentials

### Acer-only secrets

- Discord webhook URL
- Render alert-ingest secret
- private Supabase service credentials used by workers
- worker-specific environment configuration

Mandatory rules:

- never paste secret values into chat, screenshots, logs, or Git
- compare secrets only by presence or irreversible fingerprint
- rotate any secret that is accidentally exposed
- keep real live submit disabled until a separate controlled approval gate

---

## 13. Change-management workflow

Every meaningful change follows this order:

1. Define one scoped outcome.
2. Identify the owning layer.
3. Edit the canonical source.
4. Keep secrets outside source control.
5. Test locally or in a safe isolated path.
6. Commit and push to GitHub.
7. Deploy or restart only the owning runtime.
8. Run smoke tests.
9. Review Watchtower, worker, and platform logs.
10. Update the architecture or runbook when ownership changes.

Do not implement the same logic independently on Render, Acer, and Windows.

---

## 14. Product architecture boundary

The main consumer journey belongs on Render:

```text
/             public homepage
/discover     live market discovery
/market/...   individual market intelligence
/alerts       Discord alerts explanation and beta signup
/start        free market-scan funnel
/market-scan  educational checklist
```

Experimental or operator tooling should not dominate the public homepage.

Possible later separation:

```text
/lab          paper trading and experimental tools
/admin        authenticated operational controls
/resources    educational products
```

---

## 15. #55 Free Discord Alerts Beta boundary

### Render

- public `/alerts` explanation
- beta signup or join flow
- recent public alert examples
- safe public alert API backed by durable records

### Supabase

- durable alert-event table
- delivery/publication status fields
- beta signup records if used
- deduplication keys and timestamps

### Acer Node

- detect qualifying events
- write durable alert record
- send Discord message
- retry safely
- report worker health

### GitHub

- worker and public-site source
- schema/migration files
- alert-rule documentation
- beta runbook

### Windows

- development, QA, and manual Discord/content review only

### Explicitly excluded from #55

- Stripe checkout
- premium roles
- real-money execution expansion
- a full user-account system
- an independent prediction market
- unrelated infrastructure additions

---

## 16. #54B acceptance checklist

- [x] Render's role is defined.
- [x] Supabase's role is defined.
- [x] GitHub's role is defined.
- [x] Acer Node's role is defined.
- [x] Windows workstation's role is defined.
- [x] Public and private traffic boundaries are defined.
- [x] Secret ownership is defined.
- [x] Data flows are defined.
- [x] Failure boundaries are defined.
- [x] #55 scope is constrained by the architecture.
- [x] Canon is committed to GitHub.
- [ ] Acer worker source and service templates are confirmed backed up in version control.
- [ ] Supabase schema/migrations used by snapshots are confirmed present in source control.

Once the final two items are complete, mark:

```text
#54B Product Architecture and Clarity Reset: LIVE
```

---

## 17. Final operating rule

> Render serves the product. Supabase remembers. GitHub defines. Acer operates. Windows develops.

No new feature should blur those responsibilities without an explicit architecture decision.
