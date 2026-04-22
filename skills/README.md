# `skills/` — Sia Skill Library

Each subdirectory contains one skill: `skills/<skill-name>/SKILL.md`. The
skill name is what the user invokes: `skills/sia-search/` → `/sia-search`.
Skills may include additional reference files (e.g., the contextual playbooks
under `skills/sia-playbooks/`).

End-user invocation guidance lives in
[`PLUGIN_USAGE.md`](../PLUGIN_USAGE.md). This file is for contributors
authoring skills.

## Skill file shape

Every skill ships a `SKILL.md` with YAML frontmatter and a body:

```markdown
---
name: sia-<workflow>
description: <TRIGGER-STYLE description — see style guide below>
---

# <Skill Title>

<Body — step-by-step guide the main Claude thread follows when the skill is loaded.>
```

## Trigger-style description — style guide (Phase 2)

The `description` field is what the skill router reads to decide *when* to auto-load
a skill. A good description names the capability **and** the triggering conditions.

- **Start with a capability verb in present tense**: "Searches", "Guides", "Generates", "Compares".
- **Name the triggering conditions explicitly** — the router is a keyword matcher.
  Include phrases like "Use when the user asks...", "Use when conflicts exist...",
  "Use at end of session...". The more specific the trigger phrase, the less routing drift.
- **Avoid marketing copy** ("powerful", "seamless"). Be mechanical.
- Aim for 1–3 sentences, under ~300 characters.

Good:
> Lists and resolves knowledge conflicts in the SIA graph where multiple entities contradict each other. Use when conflict_group_id appears in results, or when the user asks about contradictions in captured knowledge.

Bad:
> A powerful conflict resolution tool for handling knowledge issues.

## Skills vs agents vs commands

| Layer    | Runs in                       | Has tool grants? | Typical scope                                      |
|----------|-------------------------------|------------------|----------------------------------------------------|
| Skill    | The main Claude thread        | Inherits thread  | Multi-step workflow guides loaded on demand        |
| Agent    | A spawned subagent            | Explicit         | Parallel / specialized sub-session with its own tools |
| Command  | User-invoked entry point      | N/A              | A `/slash` shortcut that forwards to skill or agent |

If the workflow is "do this sequence of steps in the current thread," author a skill.
If it benefits from its own tool grants and can run in parallel with the main work,
author an agent instead.

## Authoring a new skill

1. Check [`PLUGIN_USAGE.md`](../PLUGIN_USAGE.md) — does an existing skill already cover this?
2. Create `skills/<name>/SKILL.md` with the frontmatter shape above.
3. Write the trigger-style description following the guide above.
4. Author the body as a numbered step-by-step guide that the agent will *follow*,
   not as abstract documentation. Bias toward concrete tool calls.
5. If the skill needs reference material, add sibling files under `skills/<name>/`
   (e.g., `reference-*.md`) and link to them from SKILL.md.
6. Run `bash scripts/validate-plugin.sh` — fails on missing frontmatter or count drift.
7. Add a matching `commands/<name>.md` shim if the skill should be user-invocable by a shorter alias.
8. Update [`PLUGIN_USAGE.md`](../PLUGIN_USAGE.md) to list the new skill with its *when-to-invoke* trigger.

## Related directories

- [`../commands/README.md`](../commands/README.md) — slash-command shims that forward to skills.
- [`../agents/README.md`](../agents/README.md) — subagents (for parallel, tool-scoped work).
- [`sia-playbooks/`](sia-playbooks/) — contextual playbooks loaded by CLAUDE.md based on task classification.
