# Evidence-Based Pushback Patterns

Templates for responding to code review feedback using SIA graph citations. The principle: don't argue from memory — argue from the graph.

## Pattern 1: Convention Conflict

**When:** Reviewer suggests a change that violates an established convention.

**Query:**
```
sia_search({ query: "<convention area>", node_types: ["Convention"], limit: 5 })
```

**Response template:**
> The current implementation follows **[Convention: {name}]** (entity {id}, captured {date}): "{convention content}". The suggested change would deviate from this established pattern. Should we update the convention, or keep the current approach?

**Key:** Always offer to update the convention. Conventions aren't immutable — but changes should be explicit.

## Pattern 2: Decision Rationale

**When:** Reviewer questions why something was done a certain way.

**Query:**
```
sia_search({ query: "<decision area>", node_types: ["Decision"], limit: 5 })
```

**Response template:**
> This approach was chosen based on **[Decision: {name}]** (captured {date}): "{rationale}". Alternatives considered were: {alternatives}. The deciding factor was: {key_reason}.

**Key:** Include the alternatives that were considered — this shows the decision was deliberate, not accidental.

## Pattern 3: YAGNI via Backlinks

**When:** Reviewer suggests adding a feature or generalization.

**Query:**
```
sia_backlinks({ node_id: "<entity_being_extended>" })
```

**Response template (zero consumers):**
> I checked the usage graph for `{entity}` — it currently has **{N} consumers**: {list or "none"}. Adding {suggested feature} would be unused by any current consumer. Should we defer this until there's a concrete use case?

**Response template (few consumers):**
> The usage graph shows {N} consumers of `{entity}`: {list}. None of them use {suggested pattern}. This might be YAGNI — want to revisit when a consumer needs it?

## Pattern 4: Tried Before

**When:** Reviewer suggests an approach that was previously tried and rejected.

**Query:**
```
sia_search({ query: "<suggested approach>", node_types: ["Decision"], limit: 10 })
```

Look for entities with `t_valid_until` set (invalidated decisions).

**Response template:**
> This approach was previously tried — see **[Decision: {name}]** (captured {date}, invalidated {invalidation_date}): "{why it was rejected}". What's different now that would make this approach succeed?

**Key:** Always ask what changed. Sometimes circumstances genuinely are different — the question prevents dismissing valid suggestions.

## Pattern 5: Accept with Citation

**When:** Reviewer's feedback is valid and should be implemented.

**Response template:**
> Good catch — this aligns with **[Convention: {name}]** which I should have followed. Implementing now.

Or if it reveals a gap:

> You're right. I'm capturing this as a new convention:
> ```
> sia_note({ kind: "Convention", name: "<new pattern>", content: "<description>" })
> ```

## Anti-Pattern: Blind Agreement

**Never agree with feedback without verifying it first.** Even valid-sounding suggestions may conflict with established decisions. Always check the graph before accepting or rejecting.

## Quick Reference

| Situation | Query | Response Strategy |
|---|---|---|
| "Change this pattern" | `sia_search` for Convention | Cite convention, offer to update |
| "Why did you do it this way?" | `sia_search` for Decision | Cite decision + alternatives |
| "Add this feature" | `sia_backlinks` | Show consumer count (YAGNI check) |
| "Use approach X instead" | `sia_search` for invalidated entities | Show if tried-and-rejected |
| "Good point, fix this" | Verify with `sia_by_file` | Accept with citation, capture if new |
