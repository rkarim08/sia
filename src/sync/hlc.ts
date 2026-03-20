// Module: hlc — Hybrid Logical Clock utilities for team sync
// HLC is a plain bigint: upper 48 bits = wall-clock ms, lower 16 bits = counter.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIA_HOME } from "@/shared/config";

/** HLC is a plain bigint — no mutable struct. */
export type HLC = bigint;

const COUNTER_BITS = 16n;
const COUNTER_MASK = (1n << COUNTER_BITS) - 1n;
const MAX_COUNTER = 0xffff;

/** Pack wall-clock ms and counter into a single bigint. */
export function pack(wallMs: number, counter: number): bigint {
	return (BigInt(wallMs) << COUNTER_BITS) | BigInt(counter);
}

/** Unpack a bigint HLC into wall-clock ms and counter. */
export function unpack(value: bigint): { wallMs: number; counter: number } {
	const counter = Number(value & COUNTER_MASK);
	const wallMs = Number(value >> COUNTER_BITS);
	return { wallMs, counter };
}

/**
 * Generate the next local HLC value. NO mutation — returns a new bigint.
 * Monotonic: if wall clock hasn't advanced, increments the counter.
 */
export function hlcNow(local: bigint): bigint {
	const now = Date.now();
	const { wallMs, counter } = unpack(local);
	if (now > wallMs) {
		return pack(now, 0);
	}
	if (counter >= MAX_COUNTER) {
		return pack(wallMs + 1, 0);
	}
	return pack(wallMs, counter + 1);
}

/**
 * Merge a remote HLC into the local clock (Lamport/HLC merge rules).
 * NO mutation — returns a new bigint that is causally after both inputs.
 */
export function hlcReceive(local: bigint, remote: bigint): bigint {
	const now = Date.now();
	const l = unpack(local);
	const r = unpack(remote);
	const maxWall = Math.max(l.wallMs, r.wallMs, now);

	if (maxWall === l.wallMs && maxWall === r.wallMs) {
		const newCounter = Math.max(l.counter, r.counter) + 1;
		if (newCounter > MAX_COUNTER) {
			return pack(maxWall + 1, 0);
		}
		return pack(maxWall, newCounter);
	}
	if (maxWall === l.wallMs) {
		if (l.counter >= MAX_COUNTER) {
			return pack(maxWall + 1, 0);
		}
		return pack(maxWall, l.counter + 1);
	}
	if (maxWall === r.wallMs) {
		if (r.counter >= MAX_COUNTER) {
			return pack(maxWall + 1, 0);
		}
		return pack(maxWall, r.counter + 1);
	}
	// now is strictly greater than both
	return pack(maxWall, 0);
}

/**
 * Persist HLC to disk at `{siaHome}/repos/{repoHash}/hlc.json`.
 * Creates directory if needed. Writes the bigint as a decimal string.
 */
export function persistHlc(repoHash: string, hlc: bigint, siaHome: string = SIA_HOME): void {
	const dir = join(siaHome, "repos", repoHash);
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, "hlc.json");
	writeFileSync(filePath, JSON.stringify({ hlc: hlc.toString() }), "utf-8");
}

/**
 * Load HLC from disk for the given repo.
 * Falls back to `pack(Date.now(), 0)` on any error (missing file, parse error, etc.).
 */
export function loadHlc(repoHash: string, siaHome: string = SIA_HOME): bigint {
	const filePath = join(siaHome, "repos", repoHash, "hlc.json");
	if (!existsSync(filePath)) {
		return pack(Date.now(), 0);
	}
	try {
		const raw = JSON.parse(readFileSync(filePath, "utf-8")) as { hlc?: string };
		if (raw.hlc !== undefined) {
			return BigInt(raw.hlc);
		}
		return pack(Date.now(), 0);
	} catch {
		return pack(Date.now(), 0);
	}
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
