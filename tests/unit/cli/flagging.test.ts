import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { disableFlagging } from "@/cli/commands/disable-flagging";
import { enableFlagging } from "@/cli/commands/enable-flagging";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("enable/disable flagging", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		dirs.length = 0;
	});

	// ---------------------------------------------------------------
	// enableFlagging sets config and writes flagging template
	// ---------------------------------------------------------------

	it("enableFlagging sets config and writes flagging template", async () => {
		const siaHome = makeTmp();
		const cwdDir = makeTmp();
		dirs.push(siaHome, cwdDir);

		await enableFlagging({ siaHome, cwd: cwdDir });

		// Config should have enableFlagging: true
		const configPath = join(siaHome, "config.json");
		expect(existsSync(configPath)).toBe(true);
		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config.enableFlagging).toBe(true);

		// CLAUDE.md should contain flagging-enabled content
		const claudePath = join(cwdDir, ".claude", "CLAUDE.md");
		expect(existsSync(claudePath)).toBe(true);
		const claudeContent = readFileSync(claudePath, "utf-8");
		expect(claudeContent).toContain("Flagging is ENABLED");
	});

	// ---------------------------------------------------------------
	// enableFlagging is idempotent
	// ---------------------------------------------------------------

	it("enableFlagging is idempotent", async () => {
		const siaHome = makeTmp();
		const cwdDir = makeTmp();
		dirs.push(siaHome, cwdDir);

		await enableFlagging({ siaHome, cwd: cwdDir });
		await enableFlagging({ siaHome, cwd: cwdDir });

		const config = JSON.parse(readFileSync(join(siaHome, "config.json"), "utf-8"));
		expect(config.enableFlagging).toBe(true);
	});

	// ---------------------------------------------------------------
	// disableFlagging sets config and writes base template
	// ---------------------------------------------------------------

	it("disableFlagging sets config and writes base template", async () => {
		const siaHome = makeTmp();
		const cwdDir = makeTmp();
		dirs.push(siaHome, cwdDir);

		// First enable, then disable
		await enableFlagging({ siaHome, cwd: cwdDir });
		await disableFlagging({ siaHome, cwd: cwdDir });

		// Config should have enableFlagging: false
		const config = JSON.parse(readFileSync(join(siaHome, "config.json"), "utf-8"));
		expect(config.enableFlagging).toBe(false);

		// CLAUDE.md should NOT contain flagging-enabled content
		const claudePath = join(cwdDir, ".claude", "CLAUDE.md");
		expect(existsSync(claudePath)).toBe(true);
		const claudeContent = readFileSync(claudePath, "utf-8");
		expect(claudeContent).not.toContain("Flagging is ENABLED");
	});

	// ---------------------------------------------------------------
	// disableFlagging is idempotent
	// ---------------------------------------------------------------

	it("disableFlagging is idempotent", async () => {
		const siaHome = makeTmp();
		const cwdDir = makeTmp();
		dirs.push(siaHome, cwdDir);

		// Call disableFlagging on fresh config (enableFlagging defaults to false)
		// Should not throw
		await expect(disableFlagging({ siaHome, cwd: cwdDir })).resolves.toBeUndefined();
	});
});
