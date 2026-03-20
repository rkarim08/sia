import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_SYNC_CONFIG, getConfig, writeConfig } from "@/shared/config";

describe("config", () => {
	let tempHome: string;

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "sia-config-test-"));
	});

	afterEach(() => {
		rmSync(tempHome, { recursive: true, force: true });
	});

	it("getConfig returns defaults when no file exists", () => {
		const config = getConfig(tempHome);
		expect(config).toEqual(DEFAULT_CONFIG);
	});

	it("writeConfig creates config file and getConfig reads it back", () => {
		writeConfig({ maxResponseTokens: 3000 }, tempHome);

		const configPath = join(tempHome, "config.json");
		const raw = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(raw.maxResponseTokens).toBe(3000);

		const config = getConfig(tempHome);
		expect(config.maxResponseTokens).toBe(3000);
	});

	it("missing keys in config file get defaults applied", () => {
		writeConfig({ airGapped: true }, tempHome);

		const config = getConfig(tempHome);
		expect(config.airGapped).toBe(true);
		// All other keys should still have defaults
		expect(config.maxResponseTokens).toBe(DEFAULT_CONFIG.maxResponseTokens);
		expect(config.captureModel).toBe(DEFAULT_CONFIG.captureModel);
		expect(config.decayHalfLife).toEqual(DEFAULT_CONFIG.decayHalfLife);
		expect(config.snapshotDir).toBe(DEFAULT_CONFIG.snapshotDir);
	});

	it("invalid decayHalfLife key 'Architecture' logs warning", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		writeConfig(
			{
				decayHalfLife: {
					default: 30,
					Decision: 90,
					Convention: 60,
					Bug: 45,
					Solution: 45,
					Architecture: 120,
				} as never,
			},
			tempHome,
		);

		getConfig(tempHome);

		expect(warnSpy).toHaveBeenCalledWith(
			"Architecture is not a valid entity type. Use Concept with tags: ['architecture'].",
		);

		warnSpy.mockRestore();
	});

	it("sync.enabled=false is the default", () => {
		const config = getConfig(tempHome);
		expect(config.sync.enabled).toBe(false);
		expect(config.sync).toEqual(DEFAULT_SYNC_CONFIG);
	});

	it("additionalLanguages defaults to empty array", () => {
		const config = getConfig(tempHome);
		expect(config.additionalLanguages).toEqual([]);
	});

	it("getConfig with no config file returns default sandbox/throttle values", () => {
		const config = getConfig(tempHome);
		expect(config.sandboxTimeout).toBe(30000);
		expect(config.contextModeThreshold).toBe(10000);
		expect(config.maxChunkSize).toBe(5000);
		expect(config.throttleNormalMax).toBe(3);
		expect(config.throttleReducedMax).toBe(8);
		expect(config.throttleBlockedMax).toBe(9);
	});
});
