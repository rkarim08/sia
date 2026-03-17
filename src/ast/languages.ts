import { basename, extname } from "node:path";
import type { AdditionalLanguage } from "@/shared/config";

export interface LanguageConfig {
	name: string;
	extensions: string[];
	tier: "A" | "B" | "C" | "D";
	grammar?: string;
	specialHandling?: "c-include" | "csharp-project" | "sql-schema" | "project-manifest";
}

export const LANGUAGE_REGISTRY: Map<string, LanguageConfig> = new Map();

function registerLanguage(config: LanguageConfig): void {
	for (const ext of config.extensions) {
		LANGUAGE_REGISTRY.set(ext.toLowerCase(), config);
	}
}

const BASE_LANGUAGES: LanguageConfig[] = [
	{
		name: "TypeScript",
		extensions: [".ts", ".tsx"],
		tier: "A",
	},
	{
		name: "JavaScript",
		extensions: [".js", ".jsx"],
		tier: "A",
	},
	{ name: "Python", extensions: [".py"], tier: "A" },
	{ name: "Go", extensions: [".go"], tier: "A" },
	{ name: "Rust", extensions: [".rs"], tier: "A" },
	{ name: "Java", extensions: [".java"], tier: "A" },
	{ name: "Kotlin", extensions: [".kt"], tier: "A" },
	{ name: "Swift", extensions: [".swift"], tier: "A" },
	{ name: "PHP", extensions: [".php"], tier: "A" },
	{ name: "Ruby", extensions: [".rb"], tier: "A" },
	{ name: "Scala", extensions: [".scala"], tier: "A" },
	{ name: "Elixir", extensions: [".ex", ".exs"], tier: "A" },
	{ name: "Dart", extensions: [".dart"], tier: "A" },

	{ name: "C", extensions: [".c", ".h"], tier: "B", specialHandling: "c-include" },
	{ name: "C++", extensions: [".cpp", ".hpp", ".cc"], tier: "B" },
	{ name: "C#", extensions: [".cs"], tier: "B", specialHandling: "csharp-project" },
	{ name: "Bash", extensions: [".sh", ".bash"], tier: "B" },
	{ name: "Lua", extensions: [".lua"], tier: "B" },
	{ name: "Zig", extensions: [".zig"], tier: "B" },
	{ name: "Perl", extensions: [".pl"], tier: "B" },
	{ name: "R", extensions: [".r", ".R"], tier: "B" },
	{ name: "OCaml", extensions: [".ml"], tier: "B" },
	{ name: "Haskell", extensions: [".hs"], tier: "B" },

	{ name: "SQL", extensions: [".sql"], tier: "C", specialHandling: "sql-schema" },
	{ name: "Prisma", extensions: [".prisma"], tier: "C", specialHandling: "sql-schema" },

	{
		name: "Cargo Manifest",
		extensions: ["cargo.toml"],
		tier: "D",
		specialHandling: "project-manifest",
	},
	{
		name: "Go Modules",
		extensions: ["go.mod"],
		tier: "D",
		specialHandling: "project-manifest",
	},
	{
		name: "Python Project",
		extensions: ["pyproject.toml"],
		tier: "D",
		specialHandling: "project-manifest",
	},
	{
		name: "C# Project",
		extensions: [".csproj"],
		tier: "D",
		specialHandling: "project-manifest",
	},
	{
		name: "Gradle Build",
		extensions: ["build.gradle"],
		tier: "D",
		specialHandling: "project-manifest",
	},
	{
		name: "Maven POM",
		extensions: ["pom.xml"],
		tier: "D",
		specialHandling: "project-manifest",
	},
];

for (const lang of BASE_LANGUAGES) {
	registerLanguage(lang);
}

function normalizeExtension(filePath: string): string {
	const base = basename(filePath).toLowerCase();
	if (LANGUAGE_REGISTRY.has(base)) {
		return base;
	}
	const ext = extname(base);
	return ext ? ext.toLowerCase() : base;
}

export function getLanguageForFile(filePath: string): LanguageConfig | undefined {
	const ext = normalizeExtension(filePath);
	return LANGUAGE_REGISTRY.get(ext);
}

function isTier(tier: string): tier is LanguageConfig["tier"] {
	return tier === "A" || tier === "B" || tier === "C" || tier === "D";
}

export interface AdditionalLanguageInput extends AdditionalLanguage {
	specialHandling?: LanguageConfig["specialHandling"];
}

export function mergeAdditionalLanguages(additional: AdditionalLanguage[]): void {
	for (const lang of additional) {
		const tier = isTier(lang.tier) ? lang.tier : "D";
		const config: LanguageConfig = {
			name: lang.name,
			extensions: lang.extensions.map((ext) => ext.toLowerCase()),
			tier,
			grammar: lang.grammar,
		};
		registerLanguage(config);
	}
}
