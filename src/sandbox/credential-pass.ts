// Module: credential-pass — Build allowlisted env for sandbox subprocesses

/** Exact env var names that always pass through. */
const EXACT_ALLOWLIST = [
	"PATH",
	"HOME",
	"USER",
	"SHELL",
	"LANG",
	"TERM",
	"KUBECONFIG",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"NODE_PATH",
	"BUN_INSTALL",
] as const;

/** Glob prefixes — any env var starting with these passes through. */
const PREFIX_ALLOWLIST = ["AWS_", "GOOGLE_", "GCLOUD_", "CLOUDSDK_", "DOCKER_", "GITHUB_"] as const;

/** Exported for test assertions. */
export const ENV_ALLOWLIST = { exact: EXACT_ALLOWLIST, prefixes: PREFIX_ALLOWLIST };

function isAllowlisted(key: string): boolean {
	if ((EXACT_ALLOWLIST as readonly string[]).includes(key)) return true;
	return PREFIX_ALLOWLIST.some((prefix) => key.startsWith(prefix));
}

/**
 * Build a filtered env object for sandbox subprocess execution.
 * Only allowlisted env vars from process.env pass through.
 * `overrides` are merged last — user-provided values win.
 * Never logs or persists any env values.
 */
export function buildSandboxEnv(overrides?: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {};

	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && isAllowlisted(key)) {
			env[key] = value;
		}
	}

	if (overrides) {
		for (const [key, value] of Object.entries(overrides)) {
			if (isAllowlisted(key)) {
				env[key] = value;
			}
		}
	}

	return env;
}
