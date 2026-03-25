import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGE_REGISTRY } from "@/ast/languages";

const QUERY_BASE = join(process.cwd(), "grammars/queries");

describe("all language query files", () => {
	for (const [name, config] of Object.entries(LANGUAGE_REGISTRY)) {
		const queryDir = config.queryDir ?? name;
		const dir = join(QUERY_BASE, queryDir);

		describe(name, () => {
			it("has symbols.scm", () => {
				if (config.tier === "C" || config.tier === "D") return;
				expect(existsSync(join(dir, "symbols.scm"))).toBe(true);
			});
			it("has imports.scm", () => {
				if (config.tier === "C" || config.tier === "D") return;
				expect(existsSync(join(dir, "imports.scm"))).toBe(true);
			});
			if (config.extractors.calls) {
				it("has calls.scm (Tier A)", () => {
					expect(existsSync(join(dir, "calls.scm"))).toBe(true);
				});
			}
		});
	}
});
