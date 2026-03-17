# Sia — Flagging Guidance

*Loaded when flagging is enabled (`enableFlagging: true`) and you reach Step 4.*
*`sia_flag` is only available when `npx sia enable-flagging` has been run.*

---

## When to Call `sia_flag`

Call `sia_flag` at most 2–3 times per session, and only for:

1. **An architectural decision made this session** that will constrain future work —
   for example, choosing a pattern, library, or structural approach that other modules
   should follow.
2. **A non-obvious root cause** discovered during debugging — something that was not
   evident from the code and that a future developer would need to know.
3. **An explicit developer preference** stated during the session ("we always do X this
   way," "never use Y for this").
4. **A new cross-cutting pattern introduced** that other modules should replicate.

The test: would the next developer who picks up this task need to know this? If yes,
flag it. If they could infer it from the code in 30 seconds, do not flag it.

---

## When NOT to Call `sia_flag`

- Routine code changes or normal implementation steps.
- Things that are obvious from the code itself.
- Single-line edits or minor refactors.
- General best practices (Sia already knows these from the codebase).
- Anything you would not bother to explain in a code review comment.

The 2–3 per session maximum is a hard ceiling. Flagging everything degrades the
signal-to-noise ratio in the graph. Be selective.

---

## How to Write a Good `reason`

The reason should be a complete, self-contained description of what happened and why
it matters. It will be stored and retrieved without context, so it must stand alone.

Good: `"chose express-rate-limit at route level, not middleware — rate limits are per-endpoint not global"`
Good: `"root cause: EventEmitter.on() not awaited in init.ts, fires before DB ready"`
Bad: `"fixed the bug"` (not self-contained)
Bad: `"important decision"` (no content)

Keep it under 100 characters after sanitization. Colons, backticks, underscores, and
forward slashes are all permitted in the reason string.
