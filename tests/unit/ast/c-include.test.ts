// Tests for c-include extractor — C/C++ include resolution with compile_commands.json

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs before importing the module under test
vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => false),
	readFileSync: vi.fn(() => ""),
}));

import * as fs from "node:fs";
import { extractCIncludes } from "@/ast/extractors/c-include";

describe("extractCIncludes", () => {
	beforeEach(() => {
		// Reset all mocks to safe defaults before each test
		vi.mocked(fs.existsSync).mockReturnValue(false);
		vi.mocked(fs.readFileSync).mockReturnValue("");
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("empty / no includes", () => {
		it("returns [] for empty content", () => {
			const facts = extractCIncludes("", "/project/src/main.c", "/project");
			expect(facts).toEqual([]);
		});

		it("returns [] for content with no includes", () => {
			const content = `
int main(void) {
    return 0;
}
`;
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			expect(facts).toEqual([]);
		});
	});

	describe("system includes (<...>)", () => {
		it("extracts system include", () => {
			const content = "#include <stdio.h>\n";
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			expect(facts.length).toBe(1);
			const fact = facts[0];
			expect(fact.name).toBe("stdio.h");
			expect(fact.type).toBe("CodeEntity");
			expect(fact.trust_tier).toBe(2);
			expect(fact.confidence).toBe(0.8);
			expect(fact.extraction_method).toBe("c-include");
			expect(fact.tags).toContain("include");
			expect(fact.tags).toContain("system-include");
			expect(fact.tags).toContain("c");
		});

		it("extracts system include with path segments", () => {
			const content = "#include <sys/types.h>\n";
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			expect(facts.length).toBe(1);
			expect(facts[0].name).toBe("sys/types.h");
			expect(facts[0].tags).toContain("system-include");
		});

		it("uses cpp language tag for .cpp file", () => {
			const content = "#include <vector>\n";
			const facts = extractCIncludes(content, "/project/src/main.cpp", "/project");
			expect(facts.length).toBe(1);
			expect(facts[0].tags).toContain("cpp");
			expect(facts[0].tags).not.toContain("c");
		});

		it("system includes confidence is 0.80", () => {
			const content = "#include <stdlib.h>\n";
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			expect(facts.length).toBe(1);
			expect(facts[0].confidence).toBe(0.8);
		});
	});

	describe('local includes ("...")', () => {
		it("extracts local include (unresolved → confidence 0.70)", () => {
			// existsSync returns false by default (set in beforeEach)
			const content = '#include "myheader.h"\n';
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			expect(facts.length).toBe(1);
			const fact = facts[0];
			expect(fact.name).toBe("myheader.h");
			expect(fact.type).toBe("CodeEntity");
			expect(fact.trust_tier).toBe(2);
			expect(fact.extraction_method).toBe("c-include");
			expect(fact.tags).toContain("include");
			expect(fact.tags).not.toContain("system-include");
			expect(fact.confidence).toBe(0.7);
		});

		it("local include confidence is 0.85 when resolved via same-dir fallback", () => {
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				if (String(p).endsWith("compile_commands.json")) return false;
				if (String(p).endsWith("myheader.h")) return true;
				return false;
			});

			const content = '#include "myheader.h"\n';
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			const fact = facts.find((f) => f.name === "myheader.h");
			expect(fact).toBeDefined();
			expect(fact?.confidence).toBe(0.85);
		});

		it("local include confidence is 0.70 when unresolved", () => {
			// existsSync returns false by default
			const content = '#include "missing.h"\n';
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			const fact = facts.find((f) => f.name === "missing.h");
			expect(fact).toBeDefined();
			expect(fact?.confidence).toBe(0.7);
		});

		it("uses cpp language tag for .hpp file", () => {
			const content = '#include "config.hpp"\n';
			const facts = extractCIncludes(content, "/project/include/widget.hpp", "/project");
			expect(facts[0].tags).toContain("cpp");
		});
	});

	describe("multiple includes", () => {
		it("handles multiple includes in one file", () => {
			const content = `
#include <stdio.h>
#include <stdlib.h>
#include "utils.h"
#include "config.h"
`;
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			expect(facts.length).toBe(4);
			const names = facts.map((f) => f.name);
			expect(names).toContain("stdio.h");
			expect(names).toContain("stdlib.h");
			expect(names).toContain("utils.h");
			expect(names).toContain("config.h");
		});

		it("differentiates system vs local in tags", () => {
			const content = `
#include <stdio.h>
#include "myutil.h"
`;
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			const sysInclude = facts.find((f) => f.name === "stdio.h");
			const localInclude = facts.find((f) => f.name === "myutil.h");

			expect(sysInclude?.tags).toContain("system-include");
			expect(localInclude?.tags).not.toContain("system-include");
		});
	});

	describe("compile_commands.json", () => {
		it("logs warning when compile_commands.json is missing", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			// existsSync returns false by default → compile_commands.json missing

			const content = '#include "header.h"\n';
			extractCIncludes(content, "/project/src/main.c", "/project");

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("compile_commands.json"));
		});

		it("does NOT warn when compile_commands.json is found", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				if (String(p).endsWith("compile_commands.json")) return true;
				return false;
			});
			vi.mocked(fs.readFileSync).mockImplementation((p) => {
				if (String(p).endsWith("compile_commands.json")) {
					return JSON.stringify([
						{
							file: "/project/src/main.c",
							command: "gcc -I/project/include -c /project/src/main.c",
						},
					]);
				}
				return "";
			});

			const content = '#include "header.h"\n';
			extractCIncludes(content, "/project/src/main.c", "/project");

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it("uses -I flags from compile_commands to resolve local includes", () => {
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				if (String(p).endsWith("compile_commands.json")) return true;
				if (String(p) === "/project/include/header.h") return true;
				return false;
			});
			vi.mocked(fs.readFileSync).mockImplementation((p) => {
				if (String(p).endsWith("compile_commands.json")) {
					return JSON.stringify([
						{
							file: "/project/src/main.c",
							command: "gcc -I/project/include -c /project/src/main.c",
						},
					]);
				}
				return "";
			});

			const content = '#include "header.h"\n';
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			const fact = facts.find((f) => f.name === "header.h");
			expect(fact).toBeDefined();
			expect(fact?.confidence).toBe(0.85);
		});
	});

	describe("field values", () => {
		it("all facts have correct base fields", () => {
			const content = "#include <stdint.h>\n";
			const facts = extractCIncludes(content, "/project/src/main.c", "/project");
			const fact = facts[0];
			expect(fact.type).toBe("CodeEntity");
			expect(fact.trust_tier).toBe(2);
			expect(fact.extraction_method).toBe("c-include");
			expect(fact.tags).toContain("include");
			expect(fact.file_paths).toContain("/project/src/main.c");
			expect(fact.content).toBeTruthy();
			expect(fact.summary).toBeTruthy();
		});
	});
});
