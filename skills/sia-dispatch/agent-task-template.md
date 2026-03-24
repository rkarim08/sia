# Agent Task Template

Use this template when constructing task descriptions for parallel agents dispatched via sia-dispatch.

## Template

For each agent, construct the task description using this structure:

```
Agent tool:
  description: "<3-5 word task summary>"
  prompt: |
    ## Task
    <What this agent should accomplish>

    ## Graph Context
    ### Conventions for this area
    <Paste sia_search Convention results here>

    ### Known bugs to watch for
    <Paste sia_search Bug results here>

    ### Dependencies
    <Paste sia_by_file results — what calls/imports/depends_on this code>

    ## Constraints
    - Do NOT modify files outside your domain: <list files>
    - Follow these conventions: <list from graph>
    - Test for these known edge cases: <list from Bug entities>

    ## When You're Stuck
    - If you need to modify a file outside your domain → STOP and report
    - If a convention conflicts with the task → report the conflict
    - If tests fail for reasons unrelated to your changes → report, don't fix
```

## How to Fill the Template

### Step 1 — Extract conventions

```
sia_search({ query: "conventions <agent's domain>", node_types: ["Convention"], limit: 5 })
```

Include each Convention's `name` and `content` in the "Conventions" section.

### Step 2 — Extract known bugs

```
sia_search({ query: "bugs <agent's domain>", node_types: ["Bug"], limit: 5 })
```

Include each Bug's `name` as an edge case to test for.

### Step 3 — Extract dependencies

```
sia_by_file({ file_path: "<agent's primary file>" })
```

List incoming edges (callers) as things the agent must not break.

## Worked Example

```
Agent tool:
  description: "Implement auth middleware"
  prompt: |
    ## Task
    Implement JWT validation middleware for the Express API.

    ## Graph Context
    ### Conventions for this area
    - [Convention: Middleware returns structured JSON errors] — all middleware
      must return { error: string, code: number }, not plain text
    - [Convention: Auth tokens in Authorization header] — Bearer scheme only

    ### Known bugs to watch for
    - [Bug: Token expiry off-by-one] — JWT expiry check was < instead of <=,
      caused 401s at exact expiry second. Test boundary condition.

    ### Dependencies
    - `src/routes/users.ts` imports this middleware
    - `src/routes/admin.ts` imports this middleware
    - Changes must be backward-compatible with both consumers

    ## Constraints
    - Do NOT modify files outside src/middleware/
    - Follow structured JSON error convention
    - Test token expiry boundary condition

    ## When You're Stuck
    - If you need to modify route files → STOP and report
    - If the JWT library API doesn't match expectations → report
```

## Why This Matters

Without structured context, parallel agents make incompatible assumptions. This template ensures each agent gets the same quality of graph context, preventing post-integration conflicts.
