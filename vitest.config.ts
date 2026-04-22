// Vitest configuration for the main test suite.
//
// IMPORTANT: run tests via `bun run test` (which invokes vitest) rather than
// `bun test` (Bun's native runner). `bun test` ignores this config file, the
// `@/…` alias map, and the per-file isolation that prevents `vi.mock(...)`
// pollution across test files. Running `bun test` directly will appear to
// produce several hundred failures; those failures are an artefact of the
// wrong runner, not real regressions.

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/unit/**/*.test.ts"],
		globals: true,
	},
	resolve: {
		alias: {
			"bun:sqlite": resolve(__dirname, "tests/__mocks__/bun-sqlite.ts"),
			"@/graph": resolve(__dirname, "src/graph"),
			"@/workspace": resolve(__dirname, "src/workspace"),
			"@/capture": resolve(__dirname, "src/capture"),
			"@/ast": resolve(__dirname, "src/ast"),
			"@/community": resolve(__dirname, "src/community"),
			"@/retrieval": resolve(__dirname, "src/retrieval"),
			"@/mcp": resolve(__dirname, "src/mcp"),
			"@/security": resolve(__dirname, "src/security"),
			"@/sync": resolve(__dirname, "src/sync"),
			"@/decay": resolve(__dirname, "src/decay"),
			"@/cli": resolve(__dirname, "src/cli"),
			"@/shared": resolve(__dirname, "src/shared"),
			"@/agent": resolve(__dirname, "src/agent"),
			"@/ontology": resolve(__dirname, "src/ontology"),
			"@/knowledge": resolve(__dirname, "src/knowledge"),
			"@/visualization": resolve(__dirname, "src/visualization"),
			"@/freshness": resolve(__dirname, "src/freshness"),
			"@/native": resolve(__dirname, "src/native"),
			"@/hooks": resolve(__dirname, "src/hooks"),
			"@/llm": resolve(__dirname, "src/llm"),
			"@/sandbox": resolve(__dirname, "src/sandbox"),
			"@/models": resolve(__dirname, "src/models"),
			"@/feedback": resolve(__dirname, "src/feedback"),
			"@/nous": resolve(__dirname, "src/nous"),
		},
	},
});
