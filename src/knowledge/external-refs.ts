/**
 * External Reference Detection — detect external service URLs in documentation content.
 *
 * Scans text for URLs matching known external service patterns (Notion, Confluence,
 * Jira, GitHub, etc.) and classifies them by service type.
 *
 * Security: external links are NEVER auto-followed. This module only detects
 * and classifies URLs — it performs no network requests.
 */

export interface ExternalServicePattern {
	pattern: RegExp;
	service: string;
}

export interface DetectedExternalRef {
	url: string;
	service: string;
	lineNumber: number;
}

// ---------------------------------------------------------------------------
// Known external service patterns
// ---------------------------------------------------------------------------

export const EXTERNAL_SERVICE_PATTERNS: ExternalServicePattern[] = [
	{ pattern: /notion\.so\//, service: "notion" },
	{ pattern: /[\w-]+\.atlassian\.net\/wiki\//, service: "confluence" },
	{ pattern: /docs\.google\.com\//, service: "google-docs" },
	{ pattern: /[\w-]+\.atlassian\.net\/browse\//, service: "jira" },
	{ pattern: /linear\.app\//, service: "linear" },
	{ pattern: /figma\.com\//, service: "figma" },
	{ pattern: /miro\.com\//, service: "miro" },
	{ pattern: /github\.com\/[\w-]+\/[\w-]+\/wiki/, service: "github-wiki" },
	{ pattern: /github\.com\/[\w-]+\/[\w-]+\/issues\/\d+/, service: "github-issue" },
	{ pattern: /github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/, service: "github-pr" },
	{ pattern: /stackoverflow\.com\/questions\/\d+/, service: "stackoverflow" },
];

// ---------------------------------------------------------------------------
// URL extraction regex
// ---------------------------------------------------------------------------

const URL_REGEX = /https?:\/\/[^\s)>\]"']+/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a URL matches any known external service pattern.
 * Returns the service name if matched, null otherwise.
 */
export function classifyUrl(url: string): string | null {
	for (const entry of EXTERNAL_SERVICE_PATTERNS) {
		if (entry.pattern.test(url)) {
			return entry.service;
		}
	}
	return null;
}

/**
 * Detect external service URLs in text content.
 * Does NOT follow or fetch any URLs — only detects and classifies them.
 *
 * Scans each line for URLs matching known external service patterns.
 * Returns all detected references with their line numbers and service types.
 */
export function detectExternalRefs(content: string): DetectedExternalRef[] {
	if (!content || content.trim().length === 0) {
		return [];
	}

	const refs: DetectedExternalRef[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const urls = line.match(URL_REGEX);
		if (!urls) {
			continue;
		}

		for (const url of urls) {
			const service = classifyUrl(url);
			if (service !== null) {
				refs.push({
					url,
					service,
					lineNumber: i + 1,
				});
			}
		}
	}

	return refs;
}
