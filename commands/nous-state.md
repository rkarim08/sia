---
description: Show current Nous cognitive state — drift score, active preferences, recent signals
---

Call the `nous_state` MCP tool with no arguments. Summarise:

- Current drift score (0.0–1.0) and whether it exceeds the warning threshold
- Active Preference nodes (with trust tier and last-updated time)
- Recent signals (surprise, discomfort, significance events) from this session
- Any open Concern nodes the user should know about

Keep the summary under ~10 lines. If drift is high, recommend running `/nous-reflect` next.

### Worked example

```
$ /nous-state
[nous] drift: 0.42 (below 0.70 threshold)
[nous] active preferences: 4 (T1: 2, T2: 2)
  · Never mock DB in integration tests (T1)
  · Use phase-named branches for new work (T1)
  · Prefer Bun over Node (T2)
  · Biome for lint/format (T2)
[nous] recent signals: 1 surprise (low), 0 discomfort
[nous] open concerns: 2 (run /nous-concern to see)
```
