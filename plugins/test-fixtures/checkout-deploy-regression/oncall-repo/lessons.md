# lessons.md — the living incident log (fixture)

Status: quiet week; no open incidents.

---

## 2026-10-12 · search "slow" report, not an incident · #latency-regression · thread-link

- What happened: someone reported search as slow; avg latency ~570 ms.
- Root cause: none. Search runs full-text queries and has always been in
  the 250–900 ms range (Kopai, 7 days, link).
- Fix: n/a.
- Gotcha / rule: compare search latency with its baseline, not with other
  services. Slow-but-normal search is a classic distraction during other
  incidents.
