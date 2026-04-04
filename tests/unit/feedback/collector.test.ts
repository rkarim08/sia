import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { createFeedbackCollector } from "@/feedback/collector";
import { createFeedbackEvent, SIGNAL_STRENGTHS, type SignalType } from "@/feedback/types";

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
			signalType: "agent_cite",
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
			signalType: "visualizer_click",
			source: "visualizer",
			sessionId: "s1",
			rankPosition: 0,
			candidatesShown: 3,
		});

		await collector.record({
			queryText: "q2",
			entityId: "e2",
			signalType: "agent_ignore",
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
			signalType: "agent_cite",
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
				signalType: "agent_accepted",
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

	it("handles 20+ concurrent record() calls without error", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("feedback-concurrent", tmpDir);
		const collector = createFeedbackCollector(db);

		const promises = Array.from({ length: 25 }, (_, i) =>
			collector.record({
				queryText: `concurrent-query-${i}`,
				entityId: `entity-${i}`,
				signalType: "agent_accepted",
				source: "agent",
				sessionId: "s-concurrent",
				rankPosition: 0,
				candidatesShown: 10,
			}),
		);

		await expect(Promise.all(promises)).resolves.not.toThrow();

		const count = await collector.getEventCount();
		expect(count).toBe(25);
	});

	it("respects synthetic source type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("feedback-synthetic", tmpDir);
		const collector = createFeedbackCollector(db);

		await collector.record({
			queryText: "distillation query",
			entityId: "e-synth",
			signalType: "agent_accepted",
			source: "synthetic",
			sessionId: "s-synth",
			rankPosition: 0,
			candidatesShown: 8,
		});

		const events = await collector.getEvents(10);
		expect(events[0].source).toBe("synthetic");
		// agent_accepted maps to 0.3
		expect(events[0].signalStrength).toBe(0.3);
	});
});

describe("createFeedbackEvent", () => {
	const base = {
		id: "test-1",
		queryText: "test query",
		entityId: "entity-1",
		source: "agent" as const,
		timestamp: Date.now(),
		sessionId: "session-1",
		rankPosition: 0,
		candidatesShown: 5,
	};

	it("throws when candidatesShown <= 0", () => {
		expect(() => createFeedbackEvent({
			...base,
			signalType: "agent_cite",
			candidatesShown: 0,
		})).toThrow("candidatesShown must be > 0");
	});

	it("throws when rankPosition >= candidatesShown", () => {
		expect(() => createFeedbackEvent({
			...base,
			signalType: "agent_cite",
			rankPosition: 5,
			candidatesShown: 5,
		})).toThrow("out of range");
	});

	it("succeeds at boundary rankPosition = candidatesShown - 1", () => {
		const event = createFeedbackEvent({
			...base,
			signalType: "agent_cite",
			rankPosition: 4,
			candidatesShown: 5,
		});
		expect(event.rankPosition).toBe(4);
		expect(event.signalStrength).toBe(SIGNAL_STRENGTHS.agent_cite);
	});

	it("maps signalType to correct signalStrength", () => {
		const event = createFeedbackEvent({
			...base,
			signalType: "visualizer_click",
		});
		expect(event.signalStrength).toBe(1.0);

		const event2 = createFeedbackEvent({
			...base,
			signalType: "visualizer_skip",
		});
		expect(event2.signalStrength).toBe(-0.2);
	});
});
