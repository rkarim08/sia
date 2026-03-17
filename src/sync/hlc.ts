// Module: hlc — Hybrid Logical Clock utilities for team sync

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type HLC = { wallMs: number; counter: number; nodeId: string };

const COUNTER_BITS = 16n;
const COUNTER_MASK = (1n << COUNTER_BITS) - 1n;

function packHlc(wallMs: number, counter: number): bigint {
	return (BigInt(wallMs) << COUNTER_BITS) | BigInt(counter);
}

function unpackHlc(value: bigint): { wallMs: number; counter: number } {
	const counter = Number(value & COUNTER_MASK);
	const wallMs = Number(value >> COUNTER_BITS);
	return { wallMs, counter };
}

/**
 * Generate the next local HLC value, updating the provided mutable state.
 * Monotonic within a process: counter increments when the wall clock
 * does not advance.
 */
export function hlcNow(local: HLC): bigint {
	const now = Date.now();
	if (now > local.wallMs) {
		local.wallMs = now;
		local.counter = 0;
	} else {
		local.counter += 1;
	}
	return packHlc(local.wallMs, local.counter);
}

/**
 * Merge a remote HLC into the local clock (Lamport/HLC merge rules).
 * Advances the local clock to maintain causal ordering.
 */
export function hlcReceive(local: HLC, remote: bigint): void {
	const now = Date.now();
	const { wallMs: remoteWall, counter: remoteCounter } = unpackHlc(remote);
	const maxWall = Math.max(local.wallMs, remoteWall, now);

	if (maxWall === local.wallMs && maxWall === remoteWall) {
		local.counter = Math.max(local.counter, remoteCounter) + 1;
	} else if (maxWall === local.wallMs) {
		local.counter += 1;
	} else if (maxWall === remoteWall) {
		local.counter = remoteCounter + 1;
	} else {
		local.counter = 0;
	}

	local.wallMs = maxWall;
}

/**
 * Safely convert database column values to BigInt.
 * Null or undefined -> 0n.
 */
export function hlcFromDb(value: unknown): bigint {
	if (value === null || value === undefined) return 0n;
	if (typeof value === "bigint") return value;
	if (typeof value === "number") return BigInt(value);
	if (typeof value === "string") return BigInt(value);
	throw new TypeError("Unsupported HLC column type");
}

/**
 * Persist HLC state to disk as decimal strings (portable across JS runtimes).
 */
export function persistHlc(hlc: HLC, filePath: string): void {
	const dir = dirname(filePath);
	mkdirSync(dir, { recursive: true });
	const payload = {
		wallMs: hlc.wallMs.toString(),
		counter: hlc.counter.toString(),
		nodeId: hlc.nodeId,
	};
	writeFileSync(filePath, JSON.stringify(payload), "utf-8");
}

/**
 * Load HLC state from disk or initialize a new clock for the given node.
 * Any parse error returns a fresh clock rather than throwing.
 */
export function loadHlc(filePath: string, nodeId: string): HLC {
	if (!existsSync(filePath)) {
		return { wallMs: Date.now(), counter: 0, nodeId };
	}

	try {
		const raw = JSON.parse(readFileSync(filePath, "utf-8")) as {
			wallMs?: string | number;
			counter?: string | number;
			nodeId?: string;
		};
		const wallMs = raw.wallMs !== undefined ? Number(raw.wallMs) : Date.now();
		const counter = raw.counter !== undefined ? Number(raw.counter) : 0;
		return { wallMs, counter, nodeId: raw.nodeId ?? nodeId };
	} catch {
		return { wallMs: Date.now(), counter: 0, nodeId };
	}
}
