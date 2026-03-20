import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { detectInstallationType, handleSiaUpgrade } from "@/mcp/tools/sia-upgrade";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
	return mkdtempSync(join(tmpdir(), "sia-upgrade-test-"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sia_upgrade tool", () => {
	const tmpDirs: string[] = [];

	afterEach(() => {
		for (const d of tmpDirs) {
			rmSync(d, { recursive: true, force: true });
		}
		tmpDirs.length = 0;
	});

	// -----------------------------------------------------------------------
	// Test 1: detectInstallationType detection order
	// -----------------------------------------------------------------------

	it("detectInstallationType: npm preferred over git when both exist, git alone → git, empty → binary", () => {
		// npm when node_modules/sia exists
		const npmDir = makeTmp();
		tmpDirs.push(npmDir);
		mkdirSync(join(npmDir, "node_modules", "sia"), { recursive: true });
		expect(detectInstallationType(npmDir)).toBe("npm");

		// git when .git exists (and no node_modules/sia)
		const gitDir = makeTmp();
		tmpDirs.push(gitDir);
		mkdirSync(join(gitDir, ".git"), { recursive: true });
		expect(detectInstallationType(gitDir)).toBe("git");

		// npm preferred over git when both exist
		const bothDir = makeTmp();
		tmpDirs.push(bothDir);
		mkdirSync(join(bothDir, "node_modules", "sia"), { recursive: true });
		mkdirSync(join(bothDir, ".git"), { recursive: true });
		expect(detectInstallationType(bothDir)).toBe("npm");
	});

	// -----------------------------------------------------------------------
	// Test 2: handleSiaUpgrade with dry_run: true + .git dir
	// -----------------------------------------------------------------------

	it("handleSiaUpgrade with dry_run: true and a .git dir returns { strategy: 'git', dryRun: true }", async () => {
		const gitDir = makeTmp();
		tmpDirs.push(gitDir);
		mkdirSync(join(gitDir, ".git"), { recursive: true });

		// Use a minimal stub for SiaDb — it is not used in dry_run path
		const db = {} as SiaDb;

		const result = await handleSiaUpgrade(db, { dry_run: true }, { siaRoot: gitDir });

		expect(result.strategy).toBe("git");
		expect(result.dryRun).toBe(true);
		// Should not have attempted an actual update
		expect(result.error).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// Test 3: empty dir → binary fallback
	// -----------------------------------------------------------------------

	it("detectInstallationType with empty dir returns 'binary'", () => {
		const emptyDir = makeTmp();
		tmpDirs.push(emptyDir);
		expect(detectInstallationType(emptyDir)).toBe("binary");
	});

	// -----------------------------------------------------------------------
	// Test 4: unknown version guard — refuses upgrade when version is unknown
	// -----------------------------------------------------------------------

	it("refuses upgrade when current version is unknown", async () => {
		// Empty dir: no node_modules/sia, no .git — binary strategy returns "unknown"
		const tmpDir = makeTmp();
		tmpDirs.push(tmpDir);

		const db = {} as SiaDb;

		const result = await handleSiaUpgrade(db, { dry_run: false }, { siaRoot: tmpDir });
		expect(result.error).toBeDefined();
		expect(result.error).toContain("Cannot determine current version");
	});
});
