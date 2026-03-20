// Module: credential-pass — Build a sanitized environment for sandbox subprocesses

/**
 * Base environment variable names that are always inherited if present.
 */
const BASE_VARS = ["PATH", "HOME", "SHELL", "USER", "LANG", "TERM"];

/**
 * Exact variable names (non-pattern) that are always inherited if present.
 */
const EXACT_VARS = ["KUBECONFIG", "GH_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN", "NODE_AUTH_TOKEN"];

/**
 * Prefix patterns for inherited environment variables.
 * Variables matching any of these prefixes (and not matching SIA_) are included.
 */
const PREFIX_PATTERNS = ["AWS_", "GOOGLE_", "GCLOUD_", "DOCKER_"];

/**
 * Build a sanitized environment record for sandbox subprocesses.
 *
 * Inherits:
 * - Base vars: PATH, HOME, SHELL, USER, LANG, TERM
 * - Exact vars: KUBECONFIG, GH_TOKEN, GITHUB_TOKEN, NPM_TOKEN, NODE_AUTH_TOKEN
 * - Pattern vars: AWS_*, GOOGLE_*, GCLOUD_*, DOCKER_*
 *
 * Excludes:
 * - SIA_* vars (never forwarded)
 * - Any undefined values
 */
export function buildSandboxEnv(): Record<string, string> {
	const result: Record<string, string> = {};
	const env = process.env;

	// Inherit base vars
	for (const key of BASE_VARS) {
		const value = env[key];
		if (typeof value === "string") {
			result[key] = value;
		}
	}

	// Inherit exact vars
	for (const key of EXACT_VARS) {
		const value = env[key];
		if (typeof value === "string") {
			result[key] = value;
		}
	}

	// Inherit pattern-matched vars
	for (const [key, value] of Object.entries(env)) {
		if (typeof value !== "string") continue;
		// Never forward SIA_ vars
		if (key.startsWith("SIA_")) continue;
		// Check prefix patterns
		for (const prefix of PREFIX_PATTERNS) {
			if (key.startsWith(prefix)) {
				result[key] = value;
				break;
			}
		}
	}

	return result;
}
