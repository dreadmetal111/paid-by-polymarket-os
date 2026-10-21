# Latest Alert Signals pilot status

The homepage reads saved alerts from `/api/alerts/recent` and keeps the public stored alert timestamp distinct from the browser's retrieval time.

- **Checking:** labeled examples remain visible while the request is pending.
- **Stored alerts loaded:** cards label `createdAt` neutrally as the alert time, while the browser's last successful check is shown separately. The same five-field public response is used for legacy and V2 records; no protocol or timestamp-source metadata is exposed.
- **No saved alerts returned:** a valid empty response says no saved alerts were returned and keeps labeled examples visible.
- **Unavailable:** HTTP, timeout, JSON, or response-shape failures say the alerts could not be loaded, show the last attempt time, restore labeled examples, and clear the alert time shown in the summary strip.

The stored `createdAt` timestamp has protocol-dependent semantics: the legacy receiver writes its insertion time, while the V2 receiver preserves the original source event time. Because the public response does not identify the protocol, the product UI uses only the neutral labels **Alert time** and **Latest alert time**. It does not present the timestamp as publication, receipt, or source time.

An alert time is accepted only when `createdAt` is an explicit ISO string containing a complete date, time, and timezone. Calendar, clock, and offset components are checked before parsing. UTC `Z`, `+00:00`, and fractional seconds (including Supabase microseconds) are accepted. Missing zones, impossible dates, coercible non-string values, invalid time or offset components, and future instants remain unavailable or unverified and never populate the latest-alert-time summary.

There is intentionally no age threshold. The request and response body share an eight-second deadline, and the existing 60-second homepage check schedule is unchanged. Alert age or successful retrieval must not be used to infer receiver or worker health.

Verification on 2026-10-21: the focused alert-status test passed 27/27, and the explicit three-file Node run passed 47/47.
