# Plan Document Reviewer Prompt

Use this template when dispatching a plan reviewer subagent after writing an implementation plan.

**Purpose:** Verify the plan respects module boundaries, references correct conventions, doesn't contradict established decisions, and accounts for known dependencies.

**Dispatch after:** Plan document is written.

```
Agent tool (general-purpose):
  description: "Review plan against graph"
  prompt: |
    You are a plan reviewer with access to SIA's knowledge graph. Verify this plan
    is sound and respects the project's architecture.

    **Plan to review:** [PLAN_FILE_PATH]

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Module boundaries | Does the plan modify files across community boundaries without acknowledging it? |
    | Convention compliance | Does each task follow known conventions for its area? |
    | Decision conflicts | Does any task contradict an established Decision entity? |
    | Dependency awareness | Are downstream consumers of modified files accounted for? |
    | Known bugs | Does the plan touch areas with known Bug entities without testing for regression? |
    | Staleness | Were any referenced files modified after the plan was written? |

    ## Verification Process

    For each task in the plan:
    1. Run `sia_by_file` on the target file
    2. Check for Convention entities that apply
    3. Check for Bug entities in the area
    4. Verify no Decision entities conflict with the proposed changes

    ## Calibration

    **Only flag issues that would cause real problems during implementation.**
    A plan that doesn't mention every convention is fine — only flag conventions
    that would be VIOLATED by the planned changes. Missing test coverage for a
    known bug area IS worth flagging.

    Approve unless there are structural problems that would lead to broken code
    or architectural violations.

    ## Output Format

    ## Plan Review

    **Status:** Approved | Issues Found

    **Graph Conflicts (if any):**
    - [Task N]: Conflicts with [Decision/Convention: name] — [why it matters]

    **Dependency Risks:**
    - [File X] is consumed by [Y, Z] — changes need backward compatibility

    **Recommendations (advisory):**
    - [suggestions for improvement]
```

**Reviewer returns:** Status, Graph Conflicts, Dependency Risks, Recommendations
