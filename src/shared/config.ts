// Module: config — SIA_HOME constant, SiaConfig, and config loading
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Default root directory for all Sia data: ~/.sia */
export const SIA_HOME: string = join(homedir(), ".sia");

/** Configuration for optional sync/replication via @libsql/client. */
export interface SyncConfig {
	enabled: boolean;
	serverUrl: string | null;
	developerId: string | null;
	syncInterval: number;
}

/** Default SyncConfig — sync disabled, no remote. */
export const DEFAULT_SYNC_CONFIG: SyncConfig = {
	enabled: false,
	serverUrl: null,
	developerId: null,
	syncInterval: 30,
};

/** Decay half-life configuration keyed by entity type. */
export interface DecayHalfLife {
	default: number;
	Decision: number;
	Convention: number;
	Bug: number;
	Solution: number;
}

/** Additional language definition for the language registry. */
export interface AdditionalLanguage {
	name: string;
	extensions: string[];
	grammar: string;
	tier: string;
}

/** Full Sia configuration matching ARCHI section 11. */
export interface SiaConfig {
	repoDir: string;
	modelPath: string;
	astCacheDir: string;
	snapshotDir: string;
	logDir: string;
	excludePaths?: string[];

	captureModel: string;
	minExtractConfidence: number;
	stagingPromotionConfidence: number;

	decayHalfLife: DecayHalfLife;
	archiveThreshold: number;
	maxResponseTokens: number;
	workingMemoryTokenBudget: number;
	communityTriggerNodeCount: number;
	communityMinGraphSize: number;

	paranoidCapture: boolean;

	enableFlagging: boolean;
	flaggedConfidenceThreshold: number;
	flaggedImportanceBoost: number;

	airGapped: boolean;

	/** Maintenance scheduler: time threshold before startup catchup triggers (ms). Default 24h. */
	maintenanceInterval: number;
	/** Maintenance scheduler: idle gap before opportunistic maintenance starts (ms). Default 60s. */
	idleTimeoutMs: number;
	/** Maintenance scheduler: minimum gap between LLM deep validation calls (ms). Default 5s. */
	deepValidationRateMs: number;

	additionalLanguages: AdditionalLanguage[];

	claudeMdUpdatedAt: string | null;

	sync: SyncConfig;
}

/** Valid keys for the decayHalfLife object. */
const VALID_DECAY_KEYS: ReadonlySet<string> = new Set([
	"default",
	"Decision",
	"Convention",
	"Bug",
	"Solution",
]);

/** Default configuration matching ARCHI section 11 values. */
export const DEFAULT_CONFIG: SiaConfig = {
	repoDir: join(SIA_HOME, "repos"),
	modelPath: join(SIA_HOME, "models", "all-MiniLM-L6-v2.onnx"),
	astCacheDir: join(SIA_HOME, "ast-cache"),
	snapshotDir: join(SIA_HOME, "snapshots"),
	logDir: join(SIA_HOME, "logs"),
	excludePaths: [],

	captureModel: "claude-haiku-4-5-20251001",
	minExtractConfidence: 0.6,
	stagingPromotionConfidence: 0.75,

	decayHalfLife: {
		default: 30,
		Decision: 90,
		Convention: 60,
		Bug: 45,
		Solution: 45,
	},
	archiveThreshold: 0.05,
	maxResponseTokens: 1500,
	workingMemoryTokenBudget: 8000,
	communityTriggerNodeCount: 20,
	communityMinGraphSize: 100,

	paranoidCapture: false,

	enableFlagging: false,
	flaggedConfidenceThreshold: 0.4,
	flaggedImportanceBoost: 0.15,

	airGapped: false,

	maintenanceInterval: 86400000, // 24 hours
	idleTimeoutMs: 60000, // 60 seconds
	deepValidationRateMs: 5000, // 5 seconds

	additionalLanguages: [],

	claudeMdUpdatedAt: null,

	sync: { ...DEFAULT_SYNC_CONFIG },
};

/**
 * Deep-merge source into target, returning a new object.
 * Arrays from source replace target arrays (no concatenation).
 */
function deepMerge<T extends Record<string, unknown>>(
	target: T,
	source: Record<string, unknown>,
): T {
	const result = { ...target } as Record<string, unknown>;
	for (const key of Object.keys(source)) {
		const srcVal = source[key];
		const tgtVal = (target as Record<string, unknown>)[key];
		if (
			srcVal !== null &&
			typeof srcVal === "object" &&
			!Array.isArray(srcVal) &&
			tgtVal !== null &&
			typeof tgtVal === "object" &&
			!Array.isArray(tgtVal)
		) {
			result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
		} else {
			result[key] = srcVal;
		}
	}
	return result as T;
}

/**
 * Validate decayHalfLife keys. Warns on invalid keys such as 'Architecture'.
 */
function validateDecayHalfLife(decayHalfLife: Record<string, unknown>): void {
	for (const key of Object.keys(decayHalfLife)) {
		if (!VALID_DECAY_KEYS.has(key)) {
			if (key === "Architecture") {
				console.warn(
					"Architecture is not a valid entity type. Use Concept with tags: ['architecture'].",
				);
			} else {
				console.warn(
					`Invalid decayHalfLife key: '${key}'. Valid keys are: ${[...VALID_DECAY_KEYS].join(", ")}.`,
				);
			}
		}
	}
}

/**
 * Load Sia configuration from disk, merging with defaults.
 * If the config file does not exist, returns DEFAULT_CONFIG.
 */
export function getConfig(siaHome: string = SIA_HOME): SiaConfig {
	const configPath = join(siaHome, "config.json");

	if (!existsSync(configPath)) {
		return { ...DEFAULT_CONFIG, sync: { ...DEFAULT_SYNC_CONFIG } };
	}

	const raw = readFileSync(configPath, "utf-8");
	const parsed = JSON.parse(raw) as Record<string, unknown>;

	if (
		parsed.decayHalfLife &&
		typeof parsed.decayHalfLife === "object" &&
		!Array.isArray(parsed.decayHalfLife)
	) {
		validateDecayHalfLife(parsed.decayHalfLife as Record<string, unknown>);
	}

	return deepMerge({ ...DEFAULT_CONFIG, sync: { ...DEFAULT_SYNC_CONFIG } }, parsed);
}

/**
 * Write a partial config update to disk.
 * Reads existing config, deep-merges the partial, and writes the result.
 * Creates the directory and file if they do not exist.
 */
export function writeConfig(partial: Partial<SiaConfig>, siaHome: string = SIA_HOME): void {
	const configPath = join(siaHome, "config.json");
	const dir = dirname(configPath);

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	let existing: Record<string, unknown> = {};
	if (existsSync(configPath)) {
		const raw = readFileSync(configPath, "utf-8");
		existing = JSON.parse(raw) as Record<string, unknown>;
	}

	const merged = deepMerge(existing, partial as Record<string, unknown>);
	writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
}
