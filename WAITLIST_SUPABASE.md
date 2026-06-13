# PBP Waitlist Supabase Storage

The public waitlist API uses Supabase when all three Supabase environment variables are present:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_WAITLIST_TABLE`

If any of those are missing, the app keeps using the local JSON fallback at `data/waitlist-submissions.json` or `PBP_WAITLIST_DATA_FILE`.

If all Supabase variables are configured but Supabase returns an error, the API returns an error instead of silently writing to JSON. This avoids splitting the waitlist across two storage systems.

## Supabase SQL

Run this in the Supabase SQL editor:

```sql
create extension if not exists pgcrypto;

create table if not exists public.pbp_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'pbp-alerts-homepage',
  created_at timestamptz not null default now(),
  constraint pbp_waitlist_email_lowercase check (email = lower(email)),
  constraint pbp_waitlist_email_basic_format check (
    email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

create unique index if not exists pbp_waitlist_email_unique
  on public.pbp_waitlist (lower(email));

create index if not exists pbp_waitlist_created_at_idx
  on public.pbp_waitlist (created_at desc);

alter table public.pbp_waitlist enable row level security;
```

No public anon policies are required. The server writes and exports waitlist rows with the service role key only.

## Render Environment Variables

In Render, open the Paid by Polymarket OS web service, then go to **Environment** and add:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
SUPABASE_WAITLIST_TABLE=pbp_waitlist
PBP_ADMIN_SECRET=YOUR_ADMIN_EXPORT_SECRET
```

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only. Do not paste it into frontend code, browser console snippets, public docs, or screenshots.

After saving environment variables, redeploy the Render service.

## Local Supabase Test

PowerShell:

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY"
$env:SUPABASE_WAITLIST_TABLE="pbp_waitlist"
$env:PBP_ADMIN_SECRET="local-admin-secret"
$env:PORT="3101"
npm start
```

macOS/Linux:

```bash
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY" \
SUPABASE_WAITLIST_TABLE="pbp_waitlist" \
PBP_ADMIN_SECRET="local-admin-secret" \
PORT=3101 \
npm start
```

In another terminal:

```bash
curl -s -X POST http://127.0.0.1:3101/api/waitlist \
  -H "Content-Type: application/json" \
  -d '{"email":"supabase-test@example.com","source":"local-supabase-test"}'

curl -s http://127.0.0.1:3101/api/admin/waitlist \
  -H "Authorization: Bearer local-admin-secret"
```

Run the same POST twice to confirm duplicate prevention. The second response should return `status: "existing"`.

## Render Test

```bash
curl -s -X POST https://paid-by-polymarket-os.onrender.com/api/waitlist \
  -H "Content-Type: application/json" \
  -d '{"email":"render-supabase-test@example.com","source":"render-supabase-test"}'

curl -s https://paid-by-polymarket-os.onrender.com/api/admin/waitlist \
  -H "Authorization: Bearer YOUR_ADMIN_EXPORT_SECRET"
```

Use the `Authorization` header for admin export. Query parameter auth still works, but headers are safer because secrets are less likely to land in URLs and logs.

## JSON Fallback Test

Leave the Supabase env vars unset:

```bash
PBP_WAITLIST_DATA_FILE="/tmp/pbp-waitlist-test.json" \
PBP_ADMIN_SECRET="local-admin-secret" \
PORT=3101 \
npm start
```

Then test:

```bash
curl -s -X POST http://127.0.0.1:3101/api/waitlist \
  -H "Content-Type: application/json" \
  -d '{"email":"json-fallback-test@example.com","source":"json-fallback-test"}'

curl -s http://127.0.0.1:3101/api/admin/waitlist \
  -H "Authorization: Bearer local-admin-secret"
```
