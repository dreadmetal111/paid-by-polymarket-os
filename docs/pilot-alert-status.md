# Latest Alert Signals pilot status

The homepage reads saved alerts from `/api/alerts/recent` and keeps their publication time distinct from the browser's retrieval time.

- **Checking:** labeled examples remain visible while the request is pending.
- **Stored alerts loaded:** cards show returned saved alerts. The latest valid `createdAt` value is labeled as a publication time, while the browser's last successful check is shown separately.
- **No saved alerts returned:** a valid empty response says no saved alerts were returned and keeps labeled examples visible.
- **Unavailable:** HTTP, timeout, JSON, or response-shape failures say the alerts could not be loaded, show the last attempt time, restore labeled examples, and clear the publication shown in the summary strip.

A publication time is accepted only when `createdAt` is an explicit ISO string containing a complete date, time, and timezone. Calendar, clock, and offset components are checked before parsing. UTC `Z`, `+00:00`, and fractional seconds (including Supabase microseconds) are accepted. Missing zones, impossible dates, coercible non-string values, invalid time or offset components, and future instants remain unavailable or unverified and never populate the latest-publication summary.

There is intentionally no age threshold. The request and response body share an eight-second deadline, and the existing 60-second homepage check schedule is unchanged.

Verification on 2026-10-21: the focused alert-status test passed 27/27, and the explicit three-file Node run passed 47/47.
