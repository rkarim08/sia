import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDoctorReport, runDoctor } from "@/cli/commands/doctor";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

describe("doctor command", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("runs without DB and returns report with agent detection", async () => {
		tmpDir = makeTmp();
		const report = await runDoctor(null, tmpDir);
		expect(report.agent).toBe("generic");
		expect(report.captureMode).toBe("api");
		expect(report.checks.length).toBeGreaterThan(0);
	});

	it("detects Claude Code when .claude/ exists", async () => {
		tmpDir = makeTmp();
		mkdirSync(join(tmpDir, ".claude"), { recursive: true });
		const report = await runDoctor(null, tmpDir);
		expect(report.agent).toBe("claude-code");
		expect(report.captureMode).toBe("hooks");
	});

	it("reports native module status", async () => {
		tmpDir = makeTmp();
		const report = await runDoctor(null, tmpDir);
		expect(["native", "wasm", "typescript"]).toContain(report.nativeModule);
	});

	it("reports community detection backend", async () => {
		tmpDir = makeTmp();
		const report = await runDoctor(null, tmpDir);
		expect(report.communityBackend).toContain("Louvain");
	});

	it("includes hook health configuration", async () => {
		tmpDir = makeTmp();
		const report = await runDoctor(null, tmpDir);
		expect(report.hookHealth.length).toBeGreaterThan(0);
		const events = report.hookHealth.map((h) => h.event);
		expect(events).toContain("PostToolUse");
		expect(events).toContain("Stop");
		expect(events).toContain("SessionStart");
	});

	it("includes provider health when --providers flag set", async () => {
		tmpDir = makeTmp();
		const report = await runDoctor(null, tmpDir, { providers: true });
		expect(report.providerHealth.length).toBe(4);
		const roles = report.providerHealth.map((p) => p.role);
		expect(roles).toContain("summarize");
		expect(roles).toContain("validate");
		expect(roles).toContain("extract");
		expect(roles).toContain("consolidate");
	});

	it("marks extract/consolidate as standby in hooks mode", async () => {
		tmpDir = makeTmp();
		mkdirSync(join(tmpDir, ".claude"), { recursive: true });
		const report = await runDoctor(null, tmpDir, { providers: true });
		const extract = report.providerHealth.find((p) => p.role === "extract");
		expect(extract?.status).toContain("standby");
	});

	it("checks graph integrity when DB provided", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-doctor", tmpDir);
		const report = await runDoctor(db, tmpDir);
		const graphCheck = report.checks.find((c) => c.name === "Graph integrity");
		expect(graphCheck).toBeDefined();
		expect(graphCheck?.status).toBe("ok");
	});

	it("formatDoctorReport produces readable output", async () => {
		tmpDir = makeTmp();
		const report = await runDoctor(null, tmpDir, { providers: true });
		const output = formatDoctorReport(report);
		expect(output).toContain("Sia Doctor Report");
		expect(output).toContain("Capture Mode");
		expect(output).toContain("Hook Configuration");
		expect(output).toContain("LLM Providers");
	});
});
