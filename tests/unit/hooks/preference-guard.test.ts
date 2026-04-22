// Tests for the Preference-guard PreToolUse subscriber.
//
// Uses a real in-memory-mapped SQLite database (via openGraphDb with a tmp dir),
// seeded with Preference nodes. No MCP server or hook shim is exercised here —
// this is a pure handler-level test.

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { extractProhibitions, runPreferenceGuard } from "@/hooks/handlers/preference-guard";
import { _resetPreferenceCacheForTests } from "@/hooks/preference-cache";
import type { HookEvent } from "@/hooks/types";

function makeTmp() {
	const dir = join(tmpdir(), `sia-pref-guard-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

async function seedPreference(
	db: SiaDb,
	opts: { content: string; trust_tier: number; archived?: boolean; invalidated?: boolean },
): Promise<string> {
	const entity = await insertEntity(db, {
		type: "Preference",
		kind: "Preference",
		name: "test-preference",
		content: opts.content,
		summary: opts.content.slice(0, 80),
		trust_tier: opts.trust_tier,
	});
	const id = entity.id;
	if (opts.archived) {
		await db.execute("UPDATE graph_nodes SET archived_at = ? WHERE id = ?", [Date.now(), id]);
	}
	if (opts.invalidated) {
		await db.execute("UPDATE graph_nodes SET t_valid_until = ? WHERE id = ?", [Date.now(), id]);
	}
	return id;
}

function bashEvent(command: string): HookEvent {
	return {
		session_id: "test-session",
		transcript_path: "",
		cwd: "/tmp",
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command },
	};
}

function writeEvent(file_path: string, content: string): HookEvent {
	return {
		session_id: "test-session",
		transcript_path: "",
		cwd: "/tmp",
		hook_event_name: "PreToolUse",
		tool_name: "Write",
		tool_input: { file_path, content },
	};
}

describe("preference-guard", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	beforeEach(() => {
		_resetPreferenceCacheForTests();
	});

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
		_resetPreferenceCacheForTests();
	});

	it("returns null when no Preferences exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pref-guard-empty", tmpDir);

		const response = await runPreferenceGuard(db, bashEvent("git commit -m 'hi'"));
		expect(response).toBeNull();
	});

	it("denies a Bash call that matches a Tier-1 'never commit to main' preference", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pref-guard-deny", tmpDir);

		await seedPreference(db, {
			content: "Never commit to main. Use a feature branch.",
			trust_tier: 1,
		});

		const response = await runPreferenceGuard(db, bashEvent("git commit -m 'hotfix on main'"));
		expect(response).not.toBeNull();
		expect(response?.hookSpecificOutput.hookEventName).toBe("PreToolUse");
		expect(response?.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(response?.hookSpecificOutput.permissionDecisionReason).toContain("Never commit to main");
	});

	it("does NOT deny when the matching preference is Tier-2 (advisory only)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pref-guard-tier2", tmpDir);

		await seedPreference(db, {
			content: "Never commit to main.",
			trust_tier: 2,
		});

		const response = await runPreferenceGuard(db, bashEvent("git commit -m 'change on main'"));
		expect(response).toBeNull();
	});

	it("returns null when the tool text is empty", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pref-guard-empty-text", tmpDir);

		await seedPreference(db, {
			content: "Never commit to main.",
			trust_tier: 1,
		});

		// Bash with blank command → empty tool text → no enforcement.
		const response = await runPreferenceGuard(db, bashEvent(""));
		expect(response).toBeNull();
	});

	it("returns null when the tool is not in {Bash, Write, Edit}", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pref-guard-other-tool", tmpDir);

		await seedPreference(db, {
			content: "Never commit to main.",
			trust_tier: 1,
		});

		const event: HookEvent = {
			session_id: "test-session",
			transcript_path: "",
			cwd: "/tmp",
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			tool_input: { file_path: "/etc/main/config" },
		};
		const response = await runPreferenceGuard(db, event);
		expect(response).toBeNull();
	});

	it("does NOT deny when the Preference has been bi-temporally invalidated", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pref-guard-invalidated", tmpDir);

		await seedPreference(db, {
			content: "Never commit to main.",
			trust_tier: 1,
			invalidated: true,
		});

		const response = await runPreferenceGuard(db, bashEvent("git commit -m 'change on main'"));
		expect(response).toBeNull();
	});

	it("denies a Write call whose content snippet contains the prohibition object", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pref-guard-write", tmpDir);

		await seedPreference(db, {
			content: "Do not embed API keys.",
			trust_tier: 1,
		});

		const response = await runPreferenceGuard(
			db,
			writeEvent("/repo/src/config.ts", "const key = 'embed API keys here';"),
		);
		expect(response).not.toBeNull();
		expect(response?.hookSpecificOutput.permissionDecision).toBe("deny");
	});

	it("returns null when the Preference contains no recognised prohibition pattern", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pref-guard-no-pattern", tmpDir);

		// No never/do-not/don't pattern here — conservative mode should not act.
		await seedPreference(db, {
			content: "Prefer concise commit messages in imperative mood.",
			trust_tier: 1,
		});

		const response = await runPreferenceGuard(
			db,
			bashEvent("git commit -m 'a long rambling imperative message'"),
		);
		expect(response).toBeNull();
	});
});

describe("extractProhibitions", () => {
	it("extracts the object of a 'never' clause", () => {
		expect(extractProhibitions("Never commit to main.")).toEqual(["commit to main"]);
	});

	it("extracts the object of a 'do not' clause", () => {
		expect(extractProhibitions("Do not push to origin directly.")).toEqual([
			"push to origin directly",
		]);
	});

	it('extracts the object of a "don\'t" clause', () => {
		expect(extractProhibitions("Don't force-push shared branches.")).toEqual([
			"force-push shared branches",
		]);
	});

	it("returns empty for content without any prohibition pattern", () => {
		expect(extractProhibitions("Use tabs, 2-space indents.")).toEqual([]);
	});
});
