import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { createFeedbackCollector } from "@/feedback/collector";

describe("FeedbackCollector", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-feedback-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) { await db.close(); db = undefined; }
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("records a feedback event", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("feedback-collect", tmpDir);
		const collector = createFeedbackCollector(db);

		await collector.record({
			queryText: "test query",
			entityId: "entity-1",
			signalStrength: 0.7,
			source: "agent",
			sessionId: "session-1",
			rankPosition: 0,
			candidatesShown: 5,
		});

		const count = await collector.getEventCount();
		expect(count).toBe(1);
	});

	it("getEventCount returns cumulative count", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("feedback-count", tmpDir);
		const collector = createFeedbackCollector(db);

		await collector.record({
			queryText: "q1",
			entityId: "e1",
			signalStrength: 1.0,
			source: "visualizer",
			sessionId: "s1",
			rankPosition: 0,
			candidatesShown: 3,
		});

		await collector.record({
			queryText: "q2",
			entityId: "e2",
			signalStrength: -0.1,
			source: "cli",
			sessionId: "s1",
			rankPosition: 1,
			candidatesShown: 3,
		});

		const count = await collector.getEventCount();
		expect(count).toBe(2);
	});

	it("getEvents returns recorded events", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("feedback-get", tmpDir);
		const collector = createFeedbackCollector(db);

		await collector.record({
			queryText: "auth module",
			entityId: "auth-1",
			signalStrength: 0.7,
			source: "agent",
			sessionId: "sess-1",
			rankPosition: 0,
			candidatesShown: 10,
		});

		const events = await collector.getEvents(100);
		expect(events.length).toBe(1);
		expect(events[0].queryText).toBe("auth module");
		expect(events[0].entityId).toBe("auth-1");
		expect(events[0].source).toBe("agent");
	});

	it("getEvents respects offset pagination", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("feedback-page", tmpDir);
		const collector = createFeedbackCollector(db);

		// Insert 3 events
		for (let i = 0; i < 3; i++) {
			await collector.record({
				queryText: `query-${i}`,
				entityId: `entity-${i}`,
				signalStrength: 0.5,
				source: "synthetic",
				sessionId: "s1",
				rankPosition: i,
				candidatesShown: 5,
			});
		}

		const page1 = await collector.getEvents(2, 0);
		const page2 = await collector.getEvents(2, 2);

		expect(page1.length).toBe(2);
		expect(page2.length).toBe(1);
	});

	it("respects synthetic source type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("feedback-synthetic", tmpDir);
		const collector = createFeedbackCollector(db);

		await collector.record({
			queryText: "distillation query",
			entityId: "e-synth",
			signalStrength: 0.5,
			source: "synthetic",
			sessionId: "s-synth",
			rankPosition: 0,
			candidatesShown: 8,
		});

		const events = await collector.getEvents(10);
		expect(events[0].source).toBe("synthetic");
		expect(events[0].signalStrength).toBe(0.5);
	});
});
