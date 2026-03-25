import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EntryPointScore } from "@/ast/entry-point-scorer";
import { traceProcesses, type TracedProcess } from "@/ast/process-tracer";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-pt-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("process tracer", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// Linear flow: A calls B calls C -> process with 3 steps
	// ---------------------------------------------------------------

	it("traces a linear flow A -> B -> C as a single process with 3 steps", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pt-linear", tmpDir);

		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "handleRequest",
			content: "entry",
			summary: "Entry",
			tags: JSON.stringify(["isExported"]),
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "validateInput",
			content: "middle",
			summary: "Middle",
		});
		const c = await insertEntity(db, {
			type: "CodeEntity",
			name: "sendResponse",
			content: "terminal",
			summary: "Terminal",
		});

		await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls", confidence: 0.9 });
		await insertEdge(db, { from_id: b.id, to_id: c.id, type: "calls", confidence: 0.8 });

		const entryPoints: EntryPointScore[] = [
			{ entityId: a.id, score: 0.9, reasons: ["exported"] },
		];

		const processes = await traceProcesses(db, entryPoints);
		expect(processes.length).toBe(1);

		const proc = processes[0];
		expect(proc.entryNodeId).toBe(a.id);
		expect(proc.terminalNodeId).toBe(c.id);
		expect(proc.steps.length).toBe(3);
		expect(proc.steps[0].nodeId).toBe(a.id);
		expect(proc.steps[0].stepOrder).toBe(0);
		expect(proc.steps[1].nodeId).toBe(b.id);
		expect(proc.steps[1].stepOrder).toBe(1);
		expect(proc.steps[2].nodeId).toBe(c.id);
		expect(proc.steps[2].stepOrder).toBe(2);
		expect(proc.name).toBe("handleRequest -> sendResponse");
	});

	// ---------------------------------------------------------------
	// Branching: A calls B and C -> 2 processes
	// ---------------------------------------------------------------

	it("traces branching flow A -> B and A -> C as 2 processes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pt-branching", tmpDir);

		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "dispatchEvent",
			content: "dispatcher",
			summary: "Dispatcher",
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "handlerAlpha",
			content: "handler alpha",
			summary: "Alpha",
		});
		const c = await insertEntity(db, {
			type: "CodeEntity",
			name: "handlerBeta",
			content: "handler beta",
			summary: "Beta",
		});

		await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls", confidence: 0.9 });
		await insertEdge(db, { from_id: a.id, to_id: c.id, type: "calls", confidence: 0.9 });

		const entryPoints: EntryPointScore[] = [
			{ entityId: a.id, score: 0.8, reasons: ["dispatcher"] },
		];

		const processes = await traceProcesses(db, entryPoints);
		expect(processes.length).toBe(2);

		const terminals = processes.map((p) => p.terminalNodeId).sort();
		expect(terminals).toContain(b.id);
		expect(terminals).toContain(c.id);
	});

	// ---------------------------------------------------------------
	// Max depth: stops tracing at depth 10
	// ---------------------------------------------------------------

	it("stops tracing at maxDepth", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pt-maxdepth", tmpDir);

		// Create a chain of 15 nodes
		const nodes = [];
		for (let i = 0; i < 15; i++) {
			const node = await insertEntity(db, {
				type: "CodeEntity",
				name: `step${i}`,
				content: `step ${i}`,
				summary: `Step ${i}`,
			});
			nodes.push(node);
		}

		// Link them linearly
		for (let i = 0; i < 14; i++) {
			await insertEdge(db, {
				from_id: nodes[i].id,
				to_id: nodes[i + 1].id,
				type: "calls",
				confidence: 0.9,
			});
		}

		const entryPoints: EntryPointScore[] = [
			{ entityId: nodes[0].id, score: 0.9, reasons: ["entry"] },
		];

		// Default maxDepth is 10
		const processes = await traceProcesses(db, entryPoints);
		expect(processes.length).toBeGreaterThanOrEqual(1);

		// Should stop at depth 10 (11 steps: 0..10)
		const proc = processes[0];
		expect(proc.steps.length).toBeLessThanOrEqual(11);
	});

	// ---------------------------------------------------------------
	// No self-loops in traced processes
	// ---------------------------------------------------------------

	it("does not include self-loops in traced processes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pt-noloop", tmpDir);

		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "loopFunc",
			content: "loop",
			summary: "Loop function",
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "terminal",
			content: "terminal",
			summary: "Terminal",
		});

		// A calls itself and also calls B
		await insertEdge(db, { from_id: a.id, to_id: a.id, type: "calls", confidence: 0.9 });
		await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls", confidence: 0.9 });

		const entryPoints: EntryPointScore[] = [
			{ entityId: a.id, score: 0.8, reasons: ["entry"] },
		];

		const processes = await traceProcesses(db, entryPoints);
		// Should have a process A -> B but no self-loop
		for (const proc of processes) {
			const nodeIds = proc.steps.map((s) => s.nodeId);
			const unique = new Set(nodeIds);
			expect(unique.size).toBe(nodeIds.length); // no duplicates
		}
	});

	// ---------------------------------------------------------------
	// Deduplication: subset processes are removed
	// ---------------------------------------------------------------

	it("deduplicates subset processes", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pt-dedup", tmpDir);

		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "main",
			content: "main",
			summary: "Main",
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "step1",
			content: "step1",
			summary: "Step 1",
		});
		const c = await insertEntity(db, {
			type: "CodeEntity",
			name: "step2",
			content: "step2",
			summary: "Step 2",
		});

		// A -> B -> C, and B is also an entry point (score > 0.5)
		await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls", confidence: 0.9 });
		await insertEdge(db, { from_id: b.id, to_id: c.id, type: "calls", confidence: 0.9 });

		const entryPoints: EntryPointScore[] = [
			{ entityId: a.id, score: 0.9, reasons: ["main entry"] },
			{ entityId: b.id, score: 0.6, reasons: ["secondary entry"] },
		];

		const processes = await traceProcesses(db, entryPoints);

		// B -> C is a subset of A -> B -> C, so it should be deduped
		// Only A -> B -> C should remain
		expect(processes.length).toBe(1);
		expect(processes[0].entryNodeId).toBe(a.id);
		expect(processes[0].terminalNodeId).toBe(c.id);
	});

	// ---------------------------------------------------------------
	// Filters out entry points with score <= 0.5
	// ---------------------------------------------------------------

	it("filters out entry points with score <= 0.5", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pt-filter", tmpDir);

		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "weakEntry",
			content: "weak",
			summary: "Weak entry",
		});

		const entryPoints: EntryPointScore[] = [
			{ entityId: a.id, score: 0.3, reasons: ["weak"] },
		];

		const processes = await traceProcesses(db, entryPoints);
		expect(processes.length).toBe(0);
	});

	// ---------------------------------------------------------------
	// Persists processes to the database
	// ---------------------------------------------------------------

	it("persists processes to the database", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("pt-persist", tmpDir);

		const a = await insertEntity(db, {
			type: "CodeEntity",
			name: "handleInit",
			content: "init",
			summary: "Init handler",
		});
		const b = await insertEntity(db, {
			type: "CodeEntity",
			name: "doWork",
			content: "work",
			summary: "Worker",
		});

		await insertEdge(db, { from_id: a.id, to_id: b.id, type: "calls", confidence: 0.9 });

		const entryPoints: EntryPointScore[] = [
			{ entityId: a.id, score: 0.8, reasons: ["handler"] },
		];

		await traceProcesses(db, entryPoints);

		// Check processes table
		const procResult = await db.execute("SELECT * FROM processes");
		expect(procResult.rows.length).toBe(1);
		const proc = procResult.rows[0] as Record<string, unknown>;
		expect(proc.entry_node_id).toBe(a.id);
		expect(proc.terminal_node_id).toBe(b.id);
		expect(proc.step_count).toBe(2);

		// Check process_steps table
		const stepsResult = await db.execute(
			"SELECT * FROM process_steps WHERE process_id = ? ORDER BY step_order",
			[proc.id as string],
		);
		expect(stepsResult.rows.length).toBe(2);
		expect((stepsResult.rows[0] as Record<string, unknown>).node_id).toBe(a.id);
		expect((stepsResult.rows[1] as Record<string, unknown>).node_id).toBe(b.id);
	});
});
