# House of Markets Snapshot Capture

`pbp-snapshot-capture` is a one-shot Acer Node worker that calls the protected House of Markets snapshot endpoint once per hour through a systemd timer.

It does not create market history locally. The public app endpoint already handles idempotent hourly upserts/skips and Supabase/local fallback storage.

## Files

- `capture_market_snapshots.js` - one-shot Node worker
- `snapshot-capture.env.example` - safe env template with placeholders only
- `pbp-snapshot-capture.service` - systemd one-shot service template
- `pbp-snapshot-capture.timer` - hourly persistent systemd timer template

## Configuration

The real Acer env file must be named:

```bash
~/projects/automation/pbp-snapshot-capture/snapshot-capture.env
```

Safe template:

```text
PBP_BASE_URL=https://house-of-markets.com
PBP_ADMIN_SECRET=replace-on-acer-only
```

Optional timeout override:

```text
PBP_SNAPSHOT_CAPTURE_TIMEOUT_MS=30000
```

Never commit the real env file. Never paste `PBP_ADMIN_SECRET` into docs, logs, screenshots, chats, or git commits.

## Copy Or Update Worker On Acer

From the local project folder, copy the worker folder to Acer using your Acer username and host:

```powershell
scp -r .\pbp-snapshot-capture YOUR_ACER_USER@YOUR_ACER_HOST:~/projects/automation/
```

On Acer, confirm the target folder exists:

```bash
mkdir -p ~/projects/automation/pbp-snapshot-capture
cd ~/projects/automation/pbp-snapshot-capture
```

If you prefer to copy files manually, make sure these files are present in:

```bash
~/projects/automation/pbp-snapshot-capture
```

## Install Node.js On Acer If Needed

```bash
sudo apt update
sudo apt install -y nodejs
node --version
```

## Create The Private Env File On Acer

```bash
cd ~/projects/automation/pbp-snapshot-capture
cp snapshot-capture.env.example snapshot-capture.env
chmod 600 snapshot-capture.env
nano snapshot-capture.env
```

Set the values:

```text
PBP_BASE_URL=https://house-of-markets.com
PBP_ADMIN_SECRET=paste-the-real-admin-secret-on-acer-only
```

## Install The systemd Units

Edit both templates and replace `YOUR_UBUNTU_USERNAME` with the Acer Ubuntu username:

```bash
nano pbp-snapshot-capture.service
nano pbp-snapshot-capture.timer
```

Install the units:

```bash
sudo cp pbp-snapshot-capture.service /etc/systemd/system/pbp-snapshot-capture.service
sudo cp pbp-snapshot-capture.timer /etc/systemd/system/pbp-snapshot-capture.timer
sudo systemctl daemon-reload
```

## Manually Test Once

Run the service once:

```bash
sudo systemctl start pbp-snapshot-capture.service
sudo systemctl status pbp-snapshot-capture.service --no-pager
```

Inspect recent logs:

```bash
sudo journalctl -u pbp-snapshot-capture.service -n 50 --no-pager
```

Expected safe log fields:

- timestamp
- captured
- skipped
- storageMode
- snapshotHour

The logs must not contain the admin secret, authorization headers, emails, or private watchlist rows.

## Enable The Hourly Timer

```bash
sudo systemctl enable --now pbp-snapshot-capture.timer
```

Check timer status:

```bash
sudo systemctl status pbp-snapshot-capture.timer --no-pager
systemctl list-timers pbp-snapshot-capture.timer --no-pager
```

The timer runs hourly with `Persistent=true`, so a missed run can execute after reboot. It also includes a small randomized delay to avoid every hourly job firing at exactly the same second.

## Manual Node Test Without systemd

For a direct test from the worker folder:

```bash
set -a
. ./snapshot-capture.env
set +a
node capture_market_snapshots.js
```

The first run in a UTC hour should report captured rows. A second run in the same hour should report mostly skipped rows because the backend upserts/skips duplicate hourly snapshots.

## Operational Checks

After enabling the timer:

```bash
systemctl list-timers pbp-snapshot-capture.timer --no-pager
sudo journalctl -u pbp-snapshot-capture.service -n 50 --no-pager
```

Later, from the local project folder, verify admin status:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-admin-status.ps1
```

Confirm:

- `marketSnapshots.count` is visible
- `marketSnapshots.latestSnapshotAt` updates after a new UTC hour
- `checks.marketSnapshotStorage` is `ok`

## Safety Notes

- This worker only calls the protected capture endpoint.
- It does not fetch or print private rows.
- It does not store snapshots locally on Acer.
- It does not change alert worker behavior.
- It does not change watchtower behavior.
- It does not create fake history.
