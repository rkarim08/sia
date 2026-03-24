# SIA Setup — Detailed Phase Guide

Progressive disclosure for the setup wizard. SKILL.md has the overview; this file has the details and error recovery for each phase.

## Phase 1: Project Detection

**What happens:** Detect project type, package manager, test runner, framework.

**Checks:**
- `package.json` → Node.js project (bun/npm/yarn/pnpm)
- `Cargo.toml` → Rust project
- `go.mod` → Go project
- `pyproject.toml` / `setup.py` → Python project
- `.git` → Git repository (required)

**Error recovery:**
| Error | Fix |
|---|---|
| No `.git` directory | Run `git init` first — SIA needs git for temporal tracking |
| No package manifest | SIA can still work — tree-sitter indexes raw source files |
| Multiple manifests | Ask user which is primary; index all |

## Phase 2: Database Configuration

**What happens:** Create SQLite databases for entities, edges, embeddings.

**Checks:**
- Write permission to `.sia/` directory
- SQLite available (bundled with bun/node)
- Sufficient disk space (estimate: ~1MB per 1000 entities)

**Error recovery:**
| Error | Fix |
|---|---|
| Permission denied | Check `.sia/` directory ownership; suggest `chmod` |
| Disk full | Warn user; suggest pruning old data or different location |
| Existing databases | Ask: fresh install or upgrade? Don't overwrite without consent |

## Phase 3: Code Indexing

**What happens:** Run tree-sitter AST parser on all source files.

**Checks:**
- Tree-sitter grammars available for detected languages
- File count and estimated indexing time
- Ignore patterns (node_modules, dist, build, .git)

**Error recovery:**
| Error | Fix |
|---|---|
| No grammar for language | Warn and skip — SIA works without AST, just less richly |
| Timeout on large repos | Suggest indexing a subdirectory first; `--include` flag |
| Parse errors on specific files | Log and continue — partial index is better than none |

## Phase 4: Documentation Ingestion

**What happens:** Ingest markdown docs, README, CLAUDE.md as Tier 4 entities.

**Checks:**
- Find all `.md` files in repo root and docs/
- Skip node_modules, vendor, generated docs
- Chunk large documents (>2000 tokens per chunk)

**Error recovery:**
| Error | Fix |
|---|---|
| No markdown files | Skip — not required |
| Very large docs (>50 files) | Index incrementally; show progress |

## Phase 5: Community Detection

**What happens:** Run Louvain community detection on the entity graph.

**Checks:**
- Minimum 10 entities required for meaningful communities
- Graph must have edges (code entities need imports/calls relationships)

**Error recovery:**
| Error | Fix |
|---|---|
| Too few entities | Skip community detection; re-run after more sessions |
| No edges | AST indexing may have failed; re-run `sia-reindex` |
| Single giant community | Normal for small projects; communities emerge as graph grows |

## Phase 6: Verification

**What happens:** Verify the setup is complete and show results.

**Success criteria:**
- [ ] Databases exist and are readable
- [ ] Entity count > 0
- [ ] At least one community detected (or explained why not)
- [ ] `sia_search` returns results for a basic query

**Present to user:**
> "SIA is ready. Your project has {N} entities across {M} communities.
> Try `sia search <topic>` to query the graph, or run `/sia-tour` for a guided walkthrough."
