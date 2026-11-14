# BASELINES.md — normal ranges per service (fixture)

<!-- Measured from the fixture's pre-incident hour with seed 7. A real
     BASELINES.md is written by kopai-oncall-setup Phase 1 from 7 days of
     Kopai data. Latency is AVG/MAX of Duration: percentiles are unavailable
     on this backend. -->

Window: the hour before the incident · Server spans only

| Service   | Error rate | Requests/min | Avg latency | Max latency | Error-level logs |
| --------- | ---------- | ------------ | ----------- | ----------- | ---------------- |
| frontend  | 0.1–0.3%   | 60–80        | 80 ms       | 460 ms      | none             |
| checkout  | 0.3–0.9%   | 18–26        | 175 ms      | 450 ms      | ~0–1 per 10 min  |
| payments  | 0%         | 18–26        | 150 ms      | 420 ms      | none             |
| inventory | 0%         | 18–26        | 20 ms       | 30 ms       | none             |
| search    | 0%         | 12–18        | 570 ms      | 900 ms      | none             |

Notes:

- checkout's background errors are 500s caused by inventory reservation
  conflicts (inventory answers HTTP 409), about 1 in 250 orders.
- search is slow by design (full-text queries); see `lessons.md`.
