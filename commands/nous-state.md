---
description: Show current Nous cognitive state — drift score, active preferences, recent signals
---

Call the `nous_state` MCP tool with no arguments. Summarise:

- Current drift score (0.0–1.0) and whether it exceeds the warning threshold
- Active Preference nodes (with trust tier and last-updated time)
- Recent signals (surprise, discomfort, significance events) from this session
- Any open Concern nodes the user should know about

Keep the summary under ~10 lines. If drift is high, recommend running `/nous-reflect` next.
