---
name: sia-execute
description: Executes code in SIA's isolated sandbox environment with automatic knowledge capture. Use when running code snippets, testing expressions, or executing scripts with SIA context.
---

# SIA Execute

Run code in an isolated sandbox with automatic knowledge graph integration.

## When To Use

Use this skill when you need to:
- Execute code snippets in a sandboxed environment
- Run an existing file in a sandbox subprocess
- Batch multiple operations (execute + search) in one call

## MCP Tools

### sia_execute — Run inline code

```
sia_execute({
  code: "console.log('hello')",
  language: "javascript",
  intent: "Test logging output",
  timeout: 10000
})
```

Parameters:
- **code** (required): The code to execute
- **language** (optional): Runtime language (supports 14+ runtimes)
- **intent** (optional): Description of what the code should do
- **timeout** (optional): Execution timeout in ms (default: 30s, configurable via `sandboxTimeoutMs`)
- **env** (optional): Environment variables to pass

### sia_execute_file — Run an existing file

```
sia_execute_file({
  file_path: "scripts/migrate.ts",
  language: "typescript",
  intent: "Run database migration"
})
```

Parameters:
- **file_path** (required): Path to the file to execute
- **language** (optional): Override language detection
- **command** (optional): Custom command to run the file
- **intent** (optional): Description of expected behavior
- **timeout** (optional): Execution timeout in ms

### sia_batch_execute — Multiple operations in one call

```
sia_batch_execute({
  operations: [
    { type: "execute", code: "1 + 1", language: "python" },
    { type: "search", query: "related algorithms" }
  ],
  timeout_per_op: 5000
})
```

## Notes

- Sandbox execution uses credential passthrough with an environment allowlist
- Results are automatically indexed in the knowledge graph
- Context mode activates when output exceeds the threshold, chunking results for better retrieval
