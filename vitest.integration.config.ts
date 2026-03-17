import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/integration/**/*.test.ts"],
		globals: true,
		testTimeout: 30_000,
	},
	resolve: {
		alias: {
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
		},
	},
});
