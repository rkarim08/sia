import { describe, expect, it } from "vitest";
import { extractPattern } from "@/hooks/augmentation/pattern-extractor";

describe("hooks/augmentation/pattern-extractor", () => {
	// ---------------------------------------------------------------
	// Grep: extracts pattern field directly
	// ---------------------------------------------------------------
	it("extracts pattern from Grep tool input", () => {
		const result = extractPattern("Grep", { pattern: "handleAuth", path: "/src" });
		expect(result).toBe("handleAuth");
	});

	// ---------------------------------------------------------------
	// Glob: extracts meaningful identifier from glob pattern
	// ---------------------------------------------------------------
	it("extracts meaningful identifier from Glob pattern", () => {
		const result = extractPattern("Glob", { pattern: "**/auth*.ts" });
		expect(result).toBe("auth");
	});

	// ---------------------------------------------------------------
	// Glob: returns null for generic patterns like **/*.ts
	// ---------------------------------------------------------------
	it("returns null for generic Glob patterns", () => {
		const result = extractPattern("Glob", { pattern: "**/*.ts" });
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// Bash: extracts search pattern from rg/grep commands
	// ---------------------------------------------------------------
	it("extracts search pattern from Bash rg command", () => {
		const result = extractPattern("Bash", { command: "rg --type ts handleAuth src/" });
		expect(result).toBe("handleAuth");
	});

	it("extracts search pattern from Bash grep command", () => {
		const result = extractPattern("Bash", { command: "grep -rn 'parseConfig' src/" });
		expect(result).toBe("parseConfig");
	});

	// ---------------------------------------------------------------
	// Bash: returns null for non-search commands
	// ---------------------------------------------------------------
	it("returns null for non-search Bash commands", () => {
		const result = extractPattern("Bash", { command: "npm install express" });
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// Unknown tool: returns null
	// ---------------------------------------------------------------
	it("returns null for unknown tool names", () => {
		const result = extractPattern("Read", { file_path: "/src/index.ts" });
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// Pattern under 3 chars: returns null
	// ---------------------------------------------------------------
	it("returns null for patterns shorter than 3 characters", () => {
		const result = extractPattern("Grep", { pattern: "ab" });
		expect(result).toBeNull();
	});

	it("returns null when Grep has no pattern field", () => {
		const result = extractPattern("Grep", {});
		expect(result).toBeNull();
	});
});
