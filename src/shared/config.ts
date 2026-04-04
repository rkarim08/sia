// Module: config — SIA_HOME constant, SiaConfig, and config loading
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { ModelTier } from "@/models/types";

/** Recognized task types for the retrieval pipeline. */
export type TaskType = "orientation" | "feature" | "bug-fix" | "regression" | "review";

/**
 * Resolve the SIA home directory.
 * In Claude Code plugin mode, uses CLAUDE_PLUGIN_DATA for persistent storage.
 * In standalone mode, falls back to ~/.sia.
 *
 * Note: SIA_HOME is evaluated once at module load time. If using
 * CLAUDE_PLUGIN_DATA, ensure it is set before this module is first imported.
 */
export function resolveSiaHome(): string {
	const pluginData = process.env.CLAUDE_PLUGIN_DATA;
	if (pluginData !== undefined && pluginData !== "") {
		if (!isAbsolute(pluginData)) {
			throw new Error(`CLAUDE_PLUGIN_DATA must be an absolute path, got: "${pluginData}"`);
		}
		return pluginData;
	}
	return join(homedir(), ".sia");
}

export const SIA_HOME: string = resolveSiaHome();

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

/** Configuration for the tree-sitter parser integration. */
export interface TreeSitterConfig {
	enabled: boolean;
	preferNative: boolean;
	parseTimeoutMs: number;
	maxCachedTrees: number;
	wasmDir: string;
	queryDir: string;
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

	treeSitter?: TreeSitterConfig;

	claudeMdUpdatedAt: string | null;

	sync: SyncConfig;

	// Sandbox execution
	sandboxTimeoutMs: number;
	sandboxOutputMaxBytes: number;
	contextModeThreshold: number;
	contextModeTopK: number;
	// Throttle
	throttleNormalMax: number;
	throttleReducedMax: number;
	// Upgrade
	upgradeReleaseUrl: string | null;
	// Transformer stack
	/** Installed model tier: T0, T1, T2, or T3. */
	modelTier: ModelTier;
	/** Maximum concurrent ONNX sessions. */
	maxOnnxSessions: number;
	/** Whether to collect implicit feedback for ranking. */
	feedbackCollection: boolean;
	/** Cross-encoder scoring timeout (ms). Must exceed typical inference time (~200ms on CPU). */
	crossEncoderTimeoutMs: number;
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

	treeSitter: {
		enabled: true,
		preferNative: true,
		parseTimeoutMs: 5000,
		maxCachedTrees: 500,
		wasmDir: join(__dirname, "../../grammars/wasm"),
		queryDir: join(__dirname, "../../grammars/queries"),
	},

	claudeMdUpdatedAt: null,

	sync: { ...DEFAULT_SYNC_CONFIG },

	sandboxTimeoutMs: 30_000,
	sandboxOutputMaxBytes: 1_048_576,
	contextModeThreshold: 10_240,
	contextModeTopK: 5,
	throttleNormalMax: 3,
	throttleReducedMax: 8,
	upgradeReleaseUrl: null,
	modelTier: "T0",
	maxOnnxSessions: 4,
	feedbackCollection: true,
	crossEncoderTimeoutMs: 500,
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
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw) as Record<string, unknown>;
	} catch (err) {
		throw new Error(
			`Failed to parse Sia config at ${configPath}: ${err instanceof Error ? err.message : String(err)}. Delete or fix the file to use defaults.`,
		);
	}

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
		try {
			existing = JSON.parse(raw) as Record<string, unknown>;
		} catch (err) {
			throw new Error(
				`Failed to parse existing Sia config at ${configPath}: ${err instanceof Error ? err.message : String(err)}. Delete or fix the file before writing new config.`,
			);
		}
	}

	const merged = deepMerge(existing, partial as Record<string, unknown>);
	writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
}
