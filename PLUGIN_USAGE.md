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
| Review knowledge graph state       | `/sia-status` · `/sia-stats`        |
| Understand the current session     | `/nous-state`                       |
| Debug a regression                 | `/sia-debug-workflow`               |
| Plan a feature                     | `/sia-plan`                         |
| Wrap up a branch                   | `/sia-finish`                       |

Shortest path for a new user: `/sia-setup` → `/sia-tour` → start working normally. Sia captures automatically; you only call skills when you want a targeted action.

## Skills (47)

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
| [sia-export-knowledge](skills/sia-export-knowledge/SKILL.md) | Human-readable KNOWLEDGE.md export | Team onboarding; stakeholder share |
| [sia-export-import](skills/sia-export-import/SKILL.md) | Portable JSON export/import | Backup; migrate machine |

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
| [sia-stats](skills/sia-stats/SKILL.md) | Graph capacity / growth stats | Quick size check |
| [sia-status](skills/sia-status/SKILL.md) | Health dashboard (capture rate, conflicts) | "Is SIA healthy?" |
| [sia-upgrade](skills/sia-upgrade/SKILL.md) | Self-update via npm / git / binary | New release available |
| [sia-workspace](skills/sia-workspace/SKILL.md) | Multi-repo workspace management | Cross-repo knowledge |
| [sia-team](skills/sia-team/SKILL.md) | Team sync server join / leave / status | Team-sync configuration |
| [sia-sync](skills/sia-sync/SKILL.md) | Manual push / pull of team knowledge | Mid-session re-sync |

### Team / PM

| Skill | What it does | When to invoke |
|---|---|---|
| [sia-pm-decision-log](skills/sia-pm-decision-log/SKILL.md) | Formal decision log | Stakeholder review; audit |
| [sia-pm-risk-dashboard](skills/sia-pm-risk-dashboard/SKILL.md) | Technical risk assessment | Sprint planning; pre-release |
| [sia-pm-sprint-summary](skills/sia-pm-sprint-summary/SKILL.md) | PM-ready sprint summary | Sprint review; retro |

### QA

| Skill | What it does | When to invoke |
|---|---|---|
| [sia-qa-coverage](skills/sia-qa-coverage/SKILL.md) | Coverage-gap analysis | Pre-release; test-improvement sprint |
| [sia-qa-flaky](skills/sia-qa-flaky/SKILL.md) | Flaky test pattern miner | CI flake triage |
| [sia-qa-report](skills/sia-qa-report/SKILL.md) | Risk-based QA report | QA cycle kickoff |

## Agents (24)

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
| [sia-security-audit](agents/sia-security-audit.md) | Security review with paranoid mode and Tier 4 exposure | Security review |
| [sia-test-advisor](agents/sia-test-advisor.md) | Test strategy from past failures + edge cases | Test-planning session |

## Commands (non-shim)

Most commands are thin shims that forward to a skill (`Run the /sia-X skill`) or dispatch an agent (`Dispatch the @sia-Y agent`). The ones below have substantive bodies worth reading directly:

### Direct MCP wrappers

| Command | What it does |
|---|---|
| [/at-time](commands/at-time.md) | Query graph state at a past timestamp |
| [/community](commands/community.md) | Inspect community partitioning at a level |
| [/freshness](commands/freshness.md) | Run the freshness engine |

### Nous cognitive layer

| Command | What it does |
|---|---|
| [/nous-state](commands/nous-state.md) | Current drift, preferences, recent signals |
| [/nous-reflect](commands/nous-reflect.md) | Per-preference alignment breakdown + action |
| [/nous-curiosity](commands/nous-curiosity.md) | Explore under-retrieved high-trust knowledge |
| [/nous-concern](commands/nous-concern.md) | Surface open Concern nodes as prioritised insights |
| [/nous-modify](commands/nous-modify.md) | Create / update / deprecate a Preference node (always requires a reason) |

### Agent-delegation commands

The remaining non-shim commands dispatch agents. Each has a one-line summary of the agent plus a link to its full definition — see `commands/*.md`. The full agent list is in the Agents table above.

---

## Regeneration

This file is authored by hand for 1.1.7 but should be regenerated from skill/agent/command frontmatter + Usage sections in future releases. A `scripts/generate-plugin-usage.sh` template is included for that purpose. Run it with `--verify` to diff the generated output against this file (used by the Phase 6 validator).

```bash
bash scripts/generate-plugin-usage.sh            # prints regenerated tables to stdout
bash scripts/generate-plugin-usage.sh --verify   # exits non-zero if drift detected
```
