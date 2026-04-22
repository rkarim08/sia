# Sia Plugin Usage Guide

This guide indexes every capability the Sia Claude Code plugin ships. For deep documentation on any component, follow the link.

See also: [README.md](README.md) (product overview), [CLAUDE.md](CLAUDE.md) (agent behavioural contract), [ARCHITECTURE.md](ARCHITECTURE.md) (system design).

## Quick start

| I want to...                       | Command or skill                    |
|------------------------------------|-------------------------------------|
| Install Sia for the first time     | `/sia-setup`                        |
| Build / refresh the graph          | `/sia-learn` · `/sia-learn --incremental` |
| Search the graph                   | `/sia-search <query>`               |
| Look up a file in the graph        | `sia_by_file` MCP tool              |
| Visualize the graph interactively  | `/sia-visualize-live`               |
| Check plugin health                | `/sia-doctor`                       |
| Capture a decision manually        | `/sia-capture`                      |
| Review knowledge graph state       | `/sia-health`                       |
| Understand the current session     | `/nous-state`                       |
| Debug a regression                 | `/sia-debug-workflow`               |
| Plan a feature                     | `/sia-plan`                         |
| Wrap up a branch                   | `/sia-finish`                       |

Shortest path for a new user: `/sia-setup` → `/sia-tour` → start working normally. Sia captures automatically; you only call skills when you want a targeted action.

## Skills (42)

### Core

| Skill | What it does | When to invoke |
|---|---|---|
| [sia-setup](skills/sia-setup/SKILL.md) | Guided first-run bootstrap (install + learn + tour) | Fresh install; first session on a new repo |
| [sia-install](skills/sia-install/SKILL.md) | Creates databases + registers repo (no indexing) | DB scaffold when you want to learn manually |
| [sia-learn](skills/sia-learn/SKILL.md) | Full / incremental graph build | First index; after big refactor; stale graph |
| [sia-search](skills/sia-search/SKILL.md) | Hybrid graph retrieval | Any moment you need prior context |
| [sia-capture](skills/sia-capture/SKILL.md) | Guided knowledge-capture session | End of a session; after architectural decisions |
| [sia-nous](skills/sia-nous/SKILL.md) | Cognitive layer tool selector | Drift warnings; anti-sycophancy; Preference edits |
| [sia-tour](skills/sia-tour/SKILL.md) | Interactive guided tour of what SIA knows | Onboarding; post-learn inspection |
| [sia-playbooks](skills/sia-playbooks/SKILL.md) | Loads task-specific playbooks (CLAUDE.md uses this) | Task classifier routes here automatically |

### Knowledge management

| Skill | What it does | When to invoke |
|---|---|---|
| [sia-augment](skills/sia-augment/SKILL.md) | Toggle auto-enrichment of Grep/Glob/Bash results with graph context | Silence noisy augmentation; debug PreToolUse hook behavior |
| [sia-digest](skills/sia-digest/SKILL.md) | 24-hour knowledge digest | Start of workday; daily standup |
| [sia-history](skills/sia-history/SKILL.md) | Temporal explore of graph evolution | "What decisions were made this week?" |
| [sia-compare](skills/sia-compare/SKILL.md) | Diff graph state across two time points | Release retro; sprint audit |
| [sia-at-time](skills/sia-at-time/SKILL.md) | Query graph as-of a historical moment | Regression root cause; audit |
| [sia-community-inspect](skills/sia-community-inspect/SKILL.md) | Inspect community partitioning | Module-boundary understanding; dispatch checks |
| [sia-conflicts](skills/sia-conflicts/SKILL.md) | List/resolve knowledge conflicts | Conflict flag appears; post-import cleanup |
| [sia-freshness](skills/sia-freshness/SKILL.md) | Fresh/stale/rotten classification | Weekly health check; pre-prune |
| [sia-prune](skills/sia-prune/SKILL.md) | Hard-delete archived entities | DB size grows; after freshness scan |
| [sia-reindex](skills/sia-reindex/SKILL.md) | Full tree-sitter re-walk | Large refactor; rename-heavy commits |
| [sia-index](skills/sia-index/SKILL.md) | Index external content (markdown / URL) | Add docs, ADRs, meeting notes to the graph |
| [sia-export](skills/sia-export/SKILL.md) | Export/import — `--format json` (portable), `--format markdown` (KNOWLEDGE.md), `--import <path>` | Backup; migration; onboarding; stakeholder share |

### Development workflow

| Skill | What it does | When to invoke |
|---|---|---|
| [sia-brainstorm](skills/sia-brainstorm/SKILL.md) | Design dialogue pre-loaded with graph context | Before any creative work |
| [sia-plan](skills/sia-plan/SKILL.md) | Implementation plan writer with graph constraints | Spec → task breakdown |
| [sia-execute](skills/sia-execute/SKILL.md) | Sandboxed code execution + indexing | Run scripts / snippets with SIA context |
| [sia-execute-plan](skills/sia-execute-plan/SKILL.md) | Plan execution with staleness detection | Following an authored plan |
| [sia-dispatch](skills/sia-dispatch/SKILL.md) | Parallel agent dispatch with independence checks | 2+ independent tasks |
| [sia-debug-workflow](skills/sia-debug-workflow/SKILL.md) | Temporal debug workflow | Bug / test failure / regression |
| [sia-test](skills/sia-test/SKILL.md) | Graph-informed TDD | Implementing with TDD; adding regression tests |
| [sia-verify](skills/sia-verify/SKILL.md) | Verification gate with area-specific checks | Before claiming "done" |
| [sia-verify-before-completion](skills/sia-verify-before-completion/SKILL.md) | Verify-then-claim discipline with past-failure lookup | Pre-commit / pre-PR / pre-deploy |
| [sia-review-respond](skills/sia-review-respond/SKILL.md) | Graph-backed code-review responses | PR comments arrive |
| [sia-finish](skills/sia-finish/SKILL.md) | Branch finishing with semantic PR summaries | Branch ready to merge |
| [sia-impact](skills/sia-impact/SKILL.md) | Pre-refactor impact analysis | Before rename / signature change |
| [sia-learn](skills/sia-learn/SKILL.md) | (Also lives in Core) | See above |

### Visualization & operations

| Skill | What it does | When to invoke |
|---|---|---|
| [sia-visualize](skills/sia-visualize/SKILL.md) | Static HTML D3 graph | Shareable snapshot |
| [sia-visualize-live](skills/sia-visualize-live/SKILL.md) | Live updating graph with filters | Interactive exploration |
| [sia-doctor](skills/sia-doctor/SKILL.md) | System health diagnostics | Any MCP error; empty graph; post-upgrade |
| [sia-health](skills/sia-health/SKILL.md) | Graph health + stats dashboard (entity counts, conflicts, capture rate, tier breakdown) | "Is SIA healthy?"; quick size check |
| [sia-upgrade](skills/sia-upgrade/SKILL.md) | Self-update via npm / git / binary | New release available |
| [sia-workspace](skills/sia-workspace/SKILL.md) | Multi-repo workspace management | Cross-repo knowledge |
| [sia-team](skills/sia-team/SKILL.md) | Team sync server join / leave / status | Team-sync configuration |
| [sia-sync](skills/sia-sync/SKILL.md) | Manual push / pull of team knowledge | Mid-session re-sync |

### Team / PM

| Skill | What it does | When to invoke |
|---|---|---|
| [sia-pm](skills/sia-pm/SKILL.md) | PM reports — `--type sprint-summary` / `risk-dashboard` / `decision-log` | Sprint close; pre-release risk review; stakeholder audit |

### QA

| Skill | What it does | When to invoke |
|---|---|---|
| [sia-qa](skills/sia-qa/SKILL.md) | QA reports — `--mode coverage` / `flaky` / `full` | Pre-release; flake triage; QA cycle kickoff |

## Agents (26)

Agents are dispatched via `@sia-<name>` or their corresponding `/<name>` command. Each agent is self-contained with a `whenToUse` section, examples, and tools list.

| Agent | What it does | When to dispatch |
|---|---|---|
| [sia-changelog-writer](agents/sia-changelog-writer.md) | Generates changelogs and release notes from the graph | Release prep |
| [sia-code-reviewer](agents/sia-code-reviewer.md) | Code review with historical + convention context | PR review; pre-merge check |
| [sia-conflict-resolver](agents/sia-conflict-resolver.md) | Walks through conflicting entities and applies chosen resolution | Conflicts exist in the graph |
| [sia-convention-enforcer](agents/sia-convention-enforcer.md) | Scans diff against active Conventions | Lightweight pre-commit check |
| [sia-debug-specialist](agents/sia-debug-specialist.md) | Temporal root-cause investigation | Active bug investigation |
| [sia-decision-reviewer](agents/sia-decision-reviewer.md) | Past decisions, rejected approaches, active constraints | Before a new architectural choice |
| [sia-dependency-tracker](agents/sia-dependency-tracker.md) | Cross-repo dependency and API-contract monitor | Workspace-level changes |
| [sia-doc-writer](agents/sia-doc-writer.md) | Generates ADRs, README sections, module docs from captured Decisions + Conventions | Refreshing project docs; drafting an ADR |
| [sia-explain](agents/sia-explain.md) | Explains SIA itself — entities, tools, skills, agents | User learning the plugin |
| [sia-feature](agents/sia-feature.md) | Feature development with architectural context | New feature work |
| [sia-knowledge-capture](agents/sia-knowledge-capture.md) | Systematic uncaptured-knowledge extraction from session | End of session |
| [sia-lead-architecture-advisor](agents/sia-lead-architecture-advisor.md) | Architecture drift detection | Leadership review |
| [sia-lead-team-health](agents/sia-lead-team-health.md) | Knowledge distribution, bus-factor, capture trends | Team-health check |
| [sia-migration](agents/sia-migration.md) | Graph updates during major refactor | Rename/restructure waves |
| [sia-onboarding](agents/sia-onboarding.md) | Full multi-topic onboarding session | New team member |
| [sia-orientation](agents/sia-orientation.md) | Quick single-answer architecture Q&A | "Why was X chosen?" |
| [sia-pm-briefing](agents/sia-pm-briefing.md) | Plain-language PM project briefings | Status update for non-engineers |
| [sia-pm-risk-advisor](agents/sia-pm-risk-advisor.md) | Technical risk surfaced in business-impact language | PM risk review |
| [sia-pr-writer](agents/sia-pr-writer.md) | Drafts a PR body from branch diff + captured Decisions/Bugs/Solutions | Before `gh pr create`; PR body refresh |
| [sia-qa-analyst](agents/sia-qa-analyst.md) | QA intelligence — risk, coverage, recommendations | QA cycle prep |
| [sia-qa-regression-map](agents/sia-qa-regression-map.md) | Scored regression risk table per module | Test prioritisation |
| [sia-refactor](agents/sia-refactor.md) | Dependency-graph impact analysis | Before structural refactor |
| [sia-regression](agents/sia-regression.md) | Regression-risk assessment of proposed changes | PR / change risk review |
| [sia-search-debugger](agents/sia-search-debugger.md) | Diagnoses empty / off-target `sia_search` results | Search returns nothing when results are expected |
| [sia-security-audit](agents/sia-security-audit.md) | Security review with paranoid mode and Tier 4 exposure | Security review |
| [sia-test-advisor](agents/sia-test-advisor.md) | Test strategy from past failures + edge cases | Test-planning session |

## Commands (42)

The command palette was pruned in 1.2.1 from 74 → 40 under a principled rule: keep a command if it takes arguments, wraps an MCP tool directly, is part of the Nous cognitive layer, or is a high-frequency daily-workflow short alias. Otherwise the canonical `/sia-<name>` skill or `@sia-<name>` agent is the entry point (both autocomplete from the palette). See [CHANGELOG.md](CHANGELOG.md#121---2026-04-21) for the rule in full and the cut list. In the Unreleased Phase C1 round, `/stats`+`/status` merged into `/health`, and `/pm`, `/qa`, `/export` were added as short aliases for the new consolidated skills.

### Direct MCP wrappers

| Command | What it does |
|---|---|
| [/at-time](commands/at-time.md) | Query graph state at a past timestamp |
| [/community](commands/community.md) | Inspect community partitioning at a level |

### Nous cognitive layer

| Command | What it does |
|---|---|
| [/nous-state](commands/nous-state.md) | Current drift, preferences, recent signals |
| [/nous-reflect](commands/nous-reflect.md) | Per-preference alignment breakdown + action |
| [/nous-curiosity](commands/nous-curiosity.md) | Explore under-retrieved high-trust knowledge |
| [/nous-concern](commands/nous-concern.md) | Surface open Concern nodes as prioritised insights |
| [/nous-modify](commands/nous-modify.md) | Create / update / deprecate a Preference node (always requires a reason) |

### Short aliases (daily workflow)

Every command below is a 2-line shim forwarding to the matching `/sia-<name>` skill or `@sia-<name>` agent; the short form is kept for palette ergonomics. Pass-through arg examples: `/search <query>`, `/learn --incremental`.

| Command | Forwards to | When to use |
|---|---|---|
| [/setup](commands/setup.md) | `/sia-setup` skill | First-run bootstrap |
| [/install](commands/install.md) | `/sia-install` skill | DB scaffold, no indexing |
| [/learn](commands/learn.md) | `/sia-learn` skill | Build / refresh the graph |
| [/search](commands/search.md) | `/sia-search` skill | Hybrid graph retrieval |
| [/capture](commands/capture.md) | `/sia-capture` skill | End-of-session knowledge capture |
| [/tour](commands/tour.md) | `/sia-tour` skill | Guided graph tour |
| [/doctor](commands/doctor.md) | `/sia-doctor` skill | System health check |
| [/health](commands/health.md) | `/sia-health` skill | Graph health dashboard (entity counts, conflicts, capture rate, tier breakdown) |
| [/pm](commands/pm.md) | `/sia-pm` skill | PM reports — `--type sprint-summary \| risk-dashboard \| decision-log` |
| [/qa](commands/qa.md) | `/sia-qa` skill | QA reports — `--mode coverage \| flaky \| full` |
| [/export](commands/export.md) | `/sia-export` skill | Export/import — `--format json \| markdown`, `--import <path>` |
| [/upgrade](commands/upgrade.md) | `/sia-upgrade` skill | Self-update |
| [/finish](commands/finish.md) | `/sia-finish` skill | Wrap up a branch |
| [/debug](commands/debug.md) | `/sia-debug-workflow` skill | Temporal root-cause tracing |
| [/plan](commands/plan.md) | `/sia-plan` skill | Implementation plan with graph context |
| [/test](commands/test.md) | `/sia-test` skill | Graph-informed TDD |
| [/verify](commands/verify.md) | `/sia-verify` skill | Area-specific verification gate |
| [/brainstorm](commands/brainstorm.md) | `/sia-brainstorm` skill | Pre-loaded design dialogue |
| [/execute](commands/execute.md) | `/sia-execute` skill | Sandboxed code execution |
| [/execute-plan](commands/execute-plan.md) | `/sia-execute-plan` skill | Plan execution with staleness detection |
| [/dispatch](commands/dispatch.md) | `/sia-dispatch` skill | Parallel agent dispatch |
| [/conflicts](commands/conflicts.md) | `/sia-conflicts` skill | List / resolve graph conflicts |
| [/freshness](commands/freshness.md) | `/sia-freshness` skill | Fresh / stale / rotten scan |
| [/digest](commands/digest.md) | `/sia-digest` skill | 24-hour knowledge digest |
| [/workspace](commands/workspace.md) | `/sia-workspace` skill | Multi-repo workspace |
| [/sync](commands/sync.md) | `/sia-sync` skill | Manual team knowledge push/pull |

### Agent-canonical slash entries

The short alias is kept for the highest-frequency agent dispatches; all other agents are reachable as `@sia-<name>` directly. See the [Agents table](#agents-26) for the full list.

| Command | Dispatches | When to dispatch |
|---|---|---|
| [/code-reviewer](commands/code-reviewer.md) | `@sia-code-reviewer` | PR review with historical + convention context |
| [/pr-writer](commands/pr-writer.md) | `@sia-pr-writer` | Draft a PR body from captured Decisions / Bugs |
| [/refactor](commands/refactor.md) | `@sia-refactor` | Dependency-graph impact analysis |
| [/regression](commands/regression.md) | `@sia-regression` | Regression-risk assessment |
| [/security-audit](commands/security-audit.md) | `@sia-security-audit` | Paranoid-mode security review |
| [/knowledge-capture](commands/knowledge-capture.md) | `@sia-knowledge-capture` | Systematic session-level knowledge extraction |
| [/onboarding](commands/onboarding.md) | `@sia-onboarding` | Full multi-topic onboarding session |
| [/orientation](commands/orientation.md) | `@sia-orientation` | Quick single-answer architecture Q&A |
| [/explain](commands/explain.md) | `@sia-explain` | Explains SIA itself — entities, tools, skills, agents |

---

## Regeneration

This file is authored by hand for 1.1.7 but should be regenerated from skill/agent/command frontmatter + Usage sections in future releases. A `scripts/generate-plugin-usage.sh` template is included for that purpose. Run it with `--verify` to diff the generated output against this file (used by the Phase 6 validator).

```bash
bash scripts/generate-plugin-usage.sh            # prints regenerated tables to stdout
bash scripts/generate-plugin-usage.sh --verify   # exits non-zero if drift detected
```
