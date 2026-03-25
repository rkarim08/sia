import { describe, expect, it } from "vitest";
import { formatContext, type AugmentEntity, type AugmentEdge } from "@/hooks/augmentation/formatter";

describe("hooks/augmentation/formatter", () => {
	// ---------------------------------------------------------------
	// Empty results return empty string
	// ---------------------------------------------------------------
	it("returns empty string for empty results", () => {
		const result = formatContext("handleAuth", []);
		expect(result).toBe("");
	});

	// ---------------------------------------------------------------
	// Single entity with no edges or decisions
	// ---------------------------------------------------------------
	it("formats a single entity with no edges", () => {
		const entities: AugmentEntity[] = [
			{
				id: "e1",
				name: "handleAuth",
				type: "CodeEntity",
				filePaths: ["src/auth.ts"],
				trustTier: 2,
				edges: [],
			},
		];

		const result = formatContext("handleAuth", entities);
		expect(result).toContain("[SIA: handleAuth]");
		expect(result).toContain("1 related entities found");
		expect(result).toContain("handleAuth (src/auth.ts)");
		expect(result).toContain("CodeEntity, trust:2");
	});

	// ---------------------------------------------------------------
	// Entity with edges
	// ---------------------------------------------------------------
	it("formats an entity with edges", () => {
		const entities: AugmentEntity[] = [
			{
				id: "e1",
				name: "handleAuth",
				type: "CodeEntity",
				filePaths: ["src/auth.ts"],
				trustTier: 2,
				edges: [
					{ targetName: "validateToken", edgeType: "calls" },
					{ targetName: "AuthConfig", edgeType: "imports" },
				],
			},
		];

		const result = formatContext("handleAuth", entities);
		expect(result).toContain("Related: validateToken (calls), AuthConfig (imports)");
	});

	// ---------------------------------------------------------------
	// Entity with decision annotation
	// ---------------------------------------------------------------
	it("formats an entity with a decision", () => {
		const entities: AugmentEntity[] = [
			{
				id: "e1",
				name: "AuthModule",
				type: "Decision",
				filePaths: ["src/auth.ts"],
				trustTier: 1,
				edges: [],
				decision: { description: "Use JWT for session management", date: "2025-01-15" },
			},
		];

		const result = formatContext("auth", entities);
		expect(result).toContain('Decision: "Use JWT for session management" (2025-01-15)');
	});

	// ---------------------------------------------------------------
	// Caps at 3 entities
	// ---------------------------------------------------------------
	it("caps output at 3 entities", () => {
		const entities: AugmentEntity[] = Array.from({ length: 5 }, (_, i) => ({
			id: `e${i}`,
			name: `Entity${i}`,
			type: "CodeEntity",
			filePaths: [`src/file${i}.ts`],
			trustTier: 2,
			edges: [],
		}));

		const result = formatContext("search", entities);
		// Should only show 3 entities
		expect(result).toContain("Entity0");
		expect(result).toContain("Entity1");
		expect(result).toContain("Entity2");
		expect(result).not.toContain("Entity3");
		expect(result).not.toContain("Entity4");
	});

	// ---------------------------------------------------------------
	// Caps edges at 3 per entity
	// ---------------------------------------------------------------
	it("caps edges at 3 per entity", () => {
		const entities: AugmentEntity[] = [
			{
				id: "e1",
				name: "BigModule",
				type: "CodeEntity",
				filePaths: ["src/big.ts"],
				trustTier: 2,
				edges: [
					{ targetName: "A", edgeType: "calls" },
					{ targetName: "B", edgeType: "imports" },
					{ targetName: "C", edgeType: "depends_on" },
					{ targetName: "D", edgeType: "relates_to" },
					{ targetName: "E", edgeType: "inherits_from" },
				],
			},
		];

		const result = formatContext("big", entities);
		expect(result).toContain("A (calls)");
		expect(result).toContain("B (imports)");
		expect(result).toContain("C (depends_on)");
		expect(result).not.toContain("D (relates_to)");
		expect(result).not.toContain("E (inherits_from)");
	});

	// ---------------------------------------------------------------
	// Multiple file paths: shows first one
	// ---------------------------------------------------------------
	it("shows first file path when entity has multiple", () => {
		const entities: AugmentEntity[] = [
			{
				id: "e1",
				name: "SharedUtil",
				type: "CodeEntity",
				filePaths: ["src/shared/utils.ts", "src/lib/helpers.ts"],
				trustTier: 2,
				edges: [],
			},
		];

		const result = formatContext("shared", entities);
		expect(result).toContain("SharedUtil (src/shared/utils.ts)");
	});

	// ---------------------------------------------------------------
	// Respects 2000 char budget
	// ---------------------------------------------------------------
	it("truncates output to stay within 2000 char budget", () => {
		const entities: AugmentEntity[] = Array.from({ length: 3 }, (_, i) => ({
			id: `e${i}`,
			name: `VeryLongEntityNameThatTakesUpSpace_${i}_${"x".repeat(200)}`,
			type: "CodeEntity",
			filePaths: [`src/very/long/path/to/file_${i}_${"y".repeat(200)}.ts`],
			trustTier: 2,
			edges: Array.from({ length: 3 }, (__, j) => ({
				targetName: `Target_${j}_${"z".repeat(100)}`,
				edgeType: "calls",
			})),
			decision: { description: "A".repeat(300), date: "2025-01-01" },
		}));

		const result = formatContext("search", entities);
		expect(result.length).toBeLessThanOrEqual(2000);
	});
});
