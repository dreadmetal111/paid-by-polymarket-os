# Acer Node Operations Source

This directory is the version-controlled disaster-recovery source for the private House of Markets Acer Node.

## Included

- heartbeat service
- PBP Watchtower
- PBP alert worker
- hourly market snapshot capture worker and timer
- systemd service definitions and network-readiness drop-ins
- persistent Docker ingress firewall
- Uptime Kuma Compose definition
- safe environment examples

## Excluded

- real `.env` files
- Discord webhook URLs
- Supabase service-role credentials
- Render ingest secrets
- databases and SQLite state
- Uptime Kuma/Portainer volumes
- runtime task/status files
- private keys

## Canonical install paths

```text
/home/dylan/projects/automation/heartbeat
/home/dylan/projects/automation/pbp-watchtower
/home/dylan/projects/automation/pbp-alert-worker
/home/dylan/projects/automation/pbp-snapshot-capture
```

Systemd definitions belong under `/etc/systemd/system/`. The firewall script belongs at `/usr/local/sbin/pbp-docker-firewall.sh`.

Secrets must be recreated from the appropriate secret manager or private backup and must never be committed.
