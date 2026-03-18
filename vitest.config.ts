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
		},
	},
});
