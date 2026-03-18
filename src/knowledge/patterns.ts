// Module: patterns — File patterns for documentation auto-discovery

export interface DiscoveryPattern {
	glob: string;
	priority: 1 | 2 | 3 | 4 | 5;
	tag: string;
	trustTier: 1 | 2;
}

// Priority 1 — AI context files (highest signal density)
// Priority 2 — Architecture documentation
// Priority 3 — Project documentation
// Priority 4 — API documentation
// Priority 5 — Change history

export const DISCOVERY_PATTERNS: DiscoveryPattern[] = [
	// Priority 1 — AI context files
	{ glob: "AGENTS.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: "CLAUDE.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: ".claude/CLAUDE.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: "GEMINI.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: ".cursor/rules/*.mdc", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: ".windsurf/rules/*.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: ".clinerules/*.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: ".github/copilot-instructions.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: ".github/instructions/*.instructions.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: ".amazonq/rules/*.md", priority: 1, tag: "ai-context", trustTier: 1 },
	{ glob: ".continue/rules/*.md", priority: 1, tag: "ai-context", trustTier: 1 },

	// Priority 2 — Architecture documentation
	{ glob: "ARCHITECTURE.md", priority: 2, tag: "architecture", trustTier: 1 },
	{ glob: "DESIGN.md", priority: 2, tag: "architecture", trustTier: 1 },
	{ glob: "docs/adr/*.md", priority: 2, tag: "architecture", trustTier: 1 },
	{ glob: "docs/decisions/*.md", priority: 2, tag: "architecture", trustTier: 1 },
	{ glob: "docs/architecture/*.md", priority: 2, tag: "architecture", trustTier: 1 },

	// Priority 3 — Project documentation
	{ glob: "README.md", priority: 3, tag: "project-docs", trustTier: 1 },
	{ glob: "CONTRIBUTING.md", priority: 3, tag: "project-docs", trustTier: 1 },
	{ glob: "CONVENTIONS.md", priority: 3, tag: "project-docs", trustTier: 1 },
	{ glob: "STANDARDS.md", priority: 3, tag: "project-docs", trustTier: 1 },
	{ glob: "CONTEXT.md", priority: 3, tag: "project-docs", trustTier: 1 },
	{ glob: "docs/*.md", priority: 3, tag: "project-docs", trustTier: 1 },

	// Priority 4 — API documentation
	{ glob: "openapi.yaml", priority: 4, tag: "api-docs", trustTier: 2 },
	{ glob: "openapi.json", priority: 4, tag: "api-docs", trustTier: 2 },
	{ glob: "swagger.yaml", priority: 4, tag: "api-docs", trustTier: 2 },
	{ glob: "swagger.json", priority: 4, tag: "api-docs", trustTier: 2 },
	{ glob: "schema.graphql", priority: 4, tag: "api-docs", trustTier: 2 },
	{ glob: "API.md", priority: 4, tag: "api-docs", trustTier: 2 },
	{ glob: "docs/api/*.md", priority: 4, tag: "api-docs", trustTier: 2 },

	// Priority 5 — Change history
	{ glob: "CHANGELOG.md", priority: 5, tag: "changelog", trustTier: 2 },
	{ glob: "HISTORY.md", priority: 5, tag: "changelog", trustTier: 2 },
	{ glob: "MIGRATION.md", priority: 5, tag: "changelog", trustTier: 2 },
	{ glob: "UPGRADING.md", priority: 5, tag: "changelog", trustTier: 2 },
];

export const EXCLUDED_DIRS = new Set([
	"node_modules",
	"vendor",
	".git",
	"dist",
	"build",
	".next",
	".nuxt",
	"__pycache__",
	".venv",
	"target",
	"coverage",
	".cache",
]);
