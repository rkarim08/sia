# Root Cause Tracing with SIA

Trace bugs to their upstream origin by mapping dependency chains through the knowledge graph.

## When to Use

Use root cause tracing when:
- The symptom is in file A but the cause is likely in a dependency
- Multiple files are affected and you need to find the common ancestor
- A fix in one place doesn't resolve the issue (upstream cause)

## The Process

### Step 1 — Map the broken entity's neighborhood

```
sia_expand({ entity_id: "<broken_entity>", depth: 2, edge_types: ["calls", "imports", "depends_on"] })
```

This returns a subgraph showing everything the broken code depends on and everything that depends on it.

### Step 2 — Read the edges

| Edge Type | Direction | Meaning |
|---|---|---|
| `calls` | outgoing | This code calls that code — bug may be in the callee |
| `imports` | outgoing | This code imports that module — breaking change in dependency |
| `depends_on` | outgoing | Logical dependency — behavioral contract may have changed |
| `calls` | incoming | Something calls this code — caller may be passing bad input |

### Step 3 — Follow the chain upstream

For each dependency in the expansion:

```
sia_by_file({ file_path: "<dependency_file>" })
```

Check if the dependency has:
- Recent Decision entities (was it intentionally changed?)
- Bug entities (is it already known to be broken?)
- Convention entities that were violated

### Step 4 — Find the root

The root cause is the **deepest entity in the chain where the bug originates**. Signs you've found it:
- Changing this entity fixes all downstream symptoms
- A Decision entity here explains why the behavior changed
- A Convention entity here was violated

### Step 5 — Verify with community context

```
sia_community({ entity_id: "<suspected_root>" })
```

Check if other entities in the same community are also affected. If yes, the root cause impacts the entire module — not just one file.

## Worked Example

**Symptom:** API endpoint returns 500.

1. `sia_expand` on the endpoint handler → depends on `AuthMiddleware`, `UserService`, `Database`
2. `sia_by_file` on each → `UserService` has a recent Decision: "Changed user lookup to use email instead of ID"
3. The Decision coincides with the bug's timeline → root cause found
4. Fix: Update the endpoint to pass email, not ID

## Anti-Pattern: Fixing Symptoms

**Never fix just the symptom.** If the API returns 500 because UserService changed its contract, adding a try-catch to the endpoint masks the real issue. Trace upstream, fix at the source.
