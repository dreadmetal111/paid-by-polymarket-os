# PBP Alert Worker

`pbp-alert-worker` is a small Python service for Paid by Polymarket OS. It fetches the public live markets endpoint, stores snapshots in SQLite, compares each new snapshot against prior snapshots, creates alerts, and sends those alerts to Discord when a webhook is configured.

It is designed for Ubuntu Server 24.04 and the Acer Node path:

```bash
~/projects/automation/pbp-alert-worker
```

## What It Does

- Fetches `https://paid-by-polymarket-os.onrender.com/api/liveMarkets`
- Stores full fetch snapshots and per-market rows in SQLite
- Compares the newest market row with the previous row for the same market
- Creates alert rows for:
  - new high-volume markets
  - probability movement
  - volume/liquidity spikes
- Sends unsent alerts to Discord through `DISCORD_WEBHOOK_URL`
- Exposes local Flask endpoints on port `5090`:
  - `/`
  - `/alerts`
  - `/health`

## Files

- `pbp_alert_worker.py` - the Python worker and Flask app
- `requirements.txt` - Python dependencies
- `alert-worker.env.example` - safe env template with no secrets
- `pbp-alert-worker.service.example` - systemd service example
- `README.md` - install, run, and test commands

## Install On Acer Node

Create the target directory:

```bash
mkdir -p ~/projects/automation/pbp-alert-worker
cd ~/projects/automation/pbp-alert-worker
```

Put these files in that directory, then install Python basics:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip
```

Create and activate a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Create the private env file:

```bash
cp alert-worker.env.example alert-worker.env
chmod 600 alert-worker.env
nano alert-worker.env
```

Paste the Discord webhook only into `alert-worker.env`:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Do not paste secrets into `alert-worker.env.example`, the README, shell history, or git commits.

## Run Manually

Initialize the SQLite database:

```bash
source .venv/bin/activate
python pbp_alert_worker.py --init-db
```

Run one fetch/compare/dispatch cycle:

```bash
python pbp_alert_worker.py --once
```

Run the local service:

```bash
python pbp_alert_worker.py
```

In another terminal, test the local endpoints:

```bash
curl http://127.0.0.1:5090/
curl http://127.0.0.1:5090/health
curl http://127.0.0.1:5090/alerts
```

## Install As A systemd Service

Edit the service example and replace `YOUR_UBUNTU_USERNAME` with the Acer Node username:

```bash
nano pbp-alert-worker.service.example
```

Install and start the service:

```bash
sudo cp pbp-alert-worker.service.example /etc/systemd/system/pbp-alert-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now pbp-alert-worker
```

Check status and logs:

```bash
sudo systemctl status pbp-alert-worker
journalctl -u pbp-alert-worker -f
```

Restart after config changes:

```bash
sudo systemctl restart pbp-alert-worker
```

Stop the service:

```bash
sudo systemctl stop pbp-alert-worker
```

## Configuration

All config lives in `alert-worker.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PBP_MARKETS_URL` | `https://paid-by-polymarket-os.onrender.com/api/liveMarkets` | Market source URL |
| `PBP_DATABASE_PATH` | `pbp-alert-worker.sqlite3` | SQLite database path |
| `PBP_HOST` | `0.0.0.0` | Flask bind host |
| `PBP_PORT` | `5090` | Flask port |
| `PBP_FETCH_INTERVAL_SECONDS` | `180` | Seconds between background fetches |
| `PBP_REQUEST_TIMEOUT_SECONDS` | `20` | HTTP request timeout |
| `DISCORD_WEBHOOK_URL` | blank | Discord webhook secret |
| `PBP_DISCORD_ENABLED` | `true` | Set `false` to store alerts without sending |
| `PBP_MAX_DISCORD_ALERTS_PER_CYCLE` | `10` | Discord send cap per cycle |
| `PBP_ALERT_ON_FIRST_RUN` | `false` | First run builds a baseline instead of notifying |
| `PBP_ALERT_COOLDOWN_MINUTES` | `60` | Per-market cooldown for movement/spike alerts |
| `PBP_MIN_NEW_MARKET_VOLUME_24H` | `100000` | New high-volume market threshold |
| `PBP_PROBABILITY_MOVE_POINTS` | `5` | YES probability movement threshold in points |
| `PBP_VOLUME_SPIKE_MULTIPLIER` | `2.0` | Volume spike multiplier |
| `PBP_VOLUME_SPIKE_MIN_CHANGE` | `25000` | Minimum volume increase for spike alerts |
| `PBP_LIQUIDITY_SPIKE_MULTIPLIER` | `1.5` | Liquidity spike multiplier |
| `PBP_LIQUIDITY_SPIKE_MIN_CHANGE` | `25000` | Minimum liquidity increase for spike alerts |
| `PBP_LOG_LEVEL` | `INFO` | Python logging level |

## SQLite Tables

- `snapshots` - one row per API fetch
- `market_snapshots` - normalized market rows for each snapshot
- `alerts` - generated alert objects and Discord send state

The database is local state. It is safe to delete if you want a fresh baseline, but doing so removes alert history.

## Beginner-Safe Notes

- The real env file must be named `alert-worker.env`.
- The example env file intentionally contains no webhook.
- `/health` only reports whether Discord is configured; it never returns the webhook.
- The first run does not alert by default because every market would look new. Keep `PBP_ALERT_ON_FIRST_RUN=false` unless you intentionally want first-run high-volume notifications.
- If Discord is not configured, alerts are still stored in SQLite and visible at `/alerts`.
