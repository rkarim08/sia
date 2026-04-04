import { describe, expect, it, vi } from "vitest";
import { createSessionPool, type SessionPool } from "@/models/session-pool";

describe("ONNX session pool", () => {
	it("returns null for unregistered model", async () => {
		const pool = createSessionPool({ maxSessions: 4 });
		const session = await pool.getSession("nonexistent");
		expect(session).toBeNull();
	});

	it("registers and retrieves a model session factory", async () => {
		const pool = createSessionPool({ maxSessions: 4 });
		const mockSession = { run: vi.fn() };

		pool.register("test-model", async () => mockSession as any);
		const session = await pool.getSession("test-model");
		expect(session).toBe(mockSession);
	});

	it("caches session after first creation", async () => {
		const pool = createSessionPool({ maxSessions: 4 });
		let createCount = 0;
		const mockSession = { run: vi.fn() };

		pool.register("test-model", async () => {
			createCount++;
			return mockSession as any;
		});

		await pool.getSession("test-model");
		await pool.getSession("test-model");
		expect(createCount).toBe(1);
	});

	it("evicts LRU session when max reached", async () => {
		const pool = createSessionPool({ maxSessions: 2 });
		const sessions = {
			a: { run: vi.fn(), release: vi.fn() },
			b: { run: vi.fn(), release: vi.fn() },
			c: { run: vi.fn(), release: vi.fn() },
		};

		pool.register("a", async () => sessions.a as any);
		pool.register("b", async () => sessions.b as any);
		pool.register("c", async () => sessions.c as any);

		await pool.getSession("a");
		await pool.getSession("b");
		// Pool is now at max (2). Getting "c" should evict "a" (least recently used).
		await pool.getSession("c");

		// "a" was evicted and its release was called
		expect(sessions.a.release).toHaveBeenCalled();
	});

	it("does not evict pinned models", async () => {
		const pool = createSessionPool({ maxSessions: 2 });
		const sessions = {
			pinned: { run: vi.fn(), release: vi.fn() },
			normal: { run: vi.fn(), release: vi.fn() },
			newcomer: { run: vi.fn(), release: vi.fn() },
		};

		pool.register("pinned", async () => sessions.pinned as any, { pinned: true });
		pool.register("normal", async () => sessions.normal as any);
		pool.register("newcomer", async () => sessions.newcomer as any);

		await pool.getSession("pinned");
		await pool.getSession("normal");
		await pool.getSession("newcomer");

		// "normal" should be evicted, not "pinned"
		expect(sessions.normal.release).toHaveBeenCalled();
		expect(sessions.pinned.release).not.toHaveBeenCalled();
	});

	it("closeAll releases all sessions", async () => {
		const pool = createSessionPool({ maxSessions: 4 });
		const session = { run: vi.fn(), release: vi.fn() };

		pool.register("test", async () => session as any);
		await pool.getSession("test");
		await pool.closeAll();

		expect(session.release).toHaveBeenCalled();
	});
});
