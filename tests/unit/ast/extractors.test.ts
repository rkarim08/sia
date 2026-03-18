import { describe, expect, it } from "vitest";
import { extractPrismaSchema } from "@/ast/extractors/prisma-schema";
import { extractManifest } from "@/ast/extractors/project-manifest";
import { extractSqlSchema } from "@/ast/extractors/sql-schema";
import { dispatchExtraction } from "@/ast/extractors/tier-dispatch";

describe("extractSqlSchema", () => {
	it("CREATE TABLE produces entity with tags containing 'table'", () => {
		const sql = `CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);`;
		const facts = extractSqlSchema(sql, "schema.sql");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		const tableFact = facts.find((f) => f.name === "users");
		expect(tableFact).toBeDefined();
		expect(tableFact?.tags).toContain("table");
		expect(tableFact?.trust_tier).toBe(2);
		expect(tableFact?.confidence).toBe(0.9);
		expect(tableFact?.extraction_method).toBe("sql-schema");
	});

	it("CREATE INDEX produces entity with tags containing 'index'", () => {
		const sql = `CREATE INDEX idx_name ON users (name);`;
		const facts = extractSqlSchema(sql, "schema.sql");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		const indexFact = facts.find((f) => f.name === "idx_name");
		expect(indexFact).toBeDefined();
		expect(indexFact?.tags).toContain("index");
		expect(indexFact?.extraction_method).toBe("sql-schema");
	});

	it("handles CREATE TABLE IF NOT EXISTS", () => {
		const sql = `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY);`;
		const facts = extractSqlSchema(sql, "schema.sql");
		const tableFact = facts.find((f) => f.name === "orders");
		expect(tableFact).toBeDefined();
		expect(tableFact?.tags).toContain("table");
	});

	it("extracts multiple tables and indexes from one file", () => {
		const sql = `
CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE posts (id INTEGER PRIMARY KEY);
CREATE INDEX idx_posts_user ON posts (user_id);
`;
		const facts = extractSqlSchema(sql, "schema.sql");
		const names = facts.map((f) => f.name);
		expect(names).toContain("users");
		expect(names).toContain("posts");
		expect(names).toContain("idx_posts_user");
	});
});

describe("extractPrismaSchema", () => {
	it("model block produces entity with tags containing 'model'", () => {
		const prisma = `model User {
  id    Int    @id @default(autoincrement())
  name  String
  email String @unique
}`;
		const facts = extractPrismaSchema(prisma, "schema.prisma");
		expect(facts.length).toBe(1);
		expect(facts[0].name).toBe("User");
		expect(facts[0].tags).toContain("model");
		expect(facts[0].trust_tier).toBe(2);
		expect(facts[0].confidence).toBe(0.9);
		expect(facts[0].extraction_method).toBe("prisma-schema");
	});

	it("extracts multiple models", () => {
		const prisma = `model User {
  id Int @id
}

model Post {
  id Int @id
  title String
}`;
		const facts = extractPrismaSchema(prisma, "schema.prisma");
		expect(facts.length).toBe(2);
		const names = facts.map((f) => f.name);
		expect(names).toContain("User");
		expect(names).toContain("Post");
	});
});

describe("extractManifest", () => {
	it("Cargo.toml members produce Dependency facts", () => {
		const cargo = `[workspace]
members = [
  "crate-a",
  "crate-b",
]`;
		const facts = extractManifest(cargo, "Cargo.toml");
		expect(facts.length).toBe(2);
		expect(facts[0].type).toBe("Dependency");
		expect(facts[0].name).toBe("crate-a");
		expect(facts[1].name).toBe("crate-b");
		expect(facts[0].trust_tier).toBe(2);
		expect(facts[0].confidence).toBe(0.85);
		expect(facts[0].extraction_method).toBe("manifest");
	});

	it("go.mod replace produces Dependency facts", () => {
		const gomod = `module example.com/myapp

go 1.21

replace example.com/lib => ../local-lib
replace example.com/util => ./util
`;
		const facts = extractManifest(gomod, "go.mod");
		expect(facts.length).toBe(2);
		expect(facts[0].type).toBe("Dependency");
		expect(facts[0].name).toBe("../local-lib");
		expect(facts[1].name).toBe("./util");
		expect(facts[0].extraction_method).toBe("manifest");
	});

	it("pyproject.toml path dependencies produce Dependency facts", () => {
		const pyproject = `[tool.poetry.dependencies]
my-lib = { path = "../my-lib" }
another = { path = "./packages/another" }
`;
		const facts = extractManifest(pyproject, "pyproject.toml");
		expect(facts.length).toBe(2);
		expect(facts[0].type).toBe("Dependency");
		expect(facts[0].name).toBe("../my-lib");
		expect(facts[1].name).toBe("./packages/another");
		expect(facts[0].extraction_method).toBe("manifest");
	});

	it("returns empty for unknown manifest file", () => {
		const facts = extractManifest("some content", "unknown.txt");
		expect(facts).toEqual([]);
	});
});

describe("dispatchExtraction", () => {
	it("routes .sql file to SQL extractor via Tier C", () => {
		const sql = "CREATE TABLE test (id INTEGER);";
		const facts = dispatchExtraction(sql, "schema.sql", "C", "sql-schema");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		expect(facts[0].extraction_method).toBe("sql-schema");
	});

	it("routes .prisma file to Prisma extractor via Tier C", () => {
		const prisma = "model Foo { id Int @id }";
		const facts = dispatchExtraction(prisma, "schema.prisma", "C", "prisma-schema");
		expect(facts.length).toBe(1);
		expect(facts[0].extraction_method).toBe("prisma-schema");
	});

	it("routes .ts file to extractTrackA via Tier A", () => {
		const ts = "export function hello() { return 1; }";
		const facts = dispatchExtraction(ts, "app.ts", "A");
		expect(facts.length).toBe(1);
		expect(facts[0].name).toBe("hello");
	});

	it("routes Tier B to extractTierB", () => {
		const c = "void greet() {}";
		const facts = dispatchExtraction(c, "lib.c", "B");
		expect(facts.length).toBeGreaterThanOrEqual(1);
		expect(facts[0].name).toBe("greet");
	});

	it("routes Tier D to manifest extractor", () => {
		const cargo = `[workspace]\nmembers = ["pkg-a"]`;
		const facts = dispatchExtraction(cargo, "Cargo.toml", "D", "project-manifest");
		expect(facts.length).toBe(1);
		expect(facts[0].type).toBe("Dependency");
	});

	it("returns empty array for unknown tier", () => {
		const facts = dispatchExtraction("content", "file.txt", "C");
		expect(facts).toEqual([]);
	});

	it("returns empty array for Tier D without project-manifest handling", () => {
		const facts = dispatchExtraction("content", "file.txt", "D");
		expect(facts).toEqual([]);
	});
});
