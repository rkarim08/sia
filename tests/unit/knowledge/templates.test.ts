import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type KnowledgeTemplate, loadTemplates, validateTemplate } from "@/knowledge/templates";

describe("knowledge templates", () => {
	let tmpDir: string;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-templates-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// loads templates from .sia/templates/
	// ---------------------------------------------------------------

	it("loads templates from .sia/templates/", () => {
		tmpDir = makeTmp();
		const siaDir = join(tmpDir, ".sia");
		mkdirSync(join(siaDir, "templates"), { recursive: true });

		writeFileSync(
			join(siaDir, "templates", "adr.yaml"),
			[
				"kind: Decision",
				"fields:",
				"  context:",
				"    description: What is the problem?",
				"    required: true",
				"  decision:",
				"    description: What was decided?",
				"    required: true",
				"  consequences:",
				"    description: What are the implications?",
				"    required: false",
				"tags_prefix: [adr]",
				"auto_relate: true",
			].join("\n"),
		);

		const templates = loadTemplates(siaDir);

		expect(templates.size).toBe(1);

		const adr = templates.get("adr") as KnowledgeTemplate;
		expect(adr).toBeDefined();
		expect(adr.name).toBe("adr");
		expect(adr.kind).toBe("Decision");
		expect(adr.autoRelate).toBe(true);
		expect(adr.tagsPrefix).toEqual(["adr"]);

		// Fields
		expect(Object.keys(adr.fields)).toHaveLength(3);
		expect(adr.fields.context).toEqual({
			description: "What is the problem?",
			required: true,
		});
		expect(adr.fields.decision).toEqual({
			description: "What was decided?",
			required: true,
		});
		expect(adr.fields.consequences).toEqual({
			description: "What are the implications?",
			required: false,
		});
	});

	// ---------------------------------------------------------------
	// returns empty map when templates directory does not exist
	// ---------------------------------------------------------------

	it("returns empty map when templates directory does not exist", () => {
		tmpDir = makeTmp();
		const siaDir = join(tmpDir, ".sia");
		// Do not create .sia/templates/

		const templates = loadTemplates(siaDir);

		expect(templates.size).toBe(0);
	});

	// ---------------------------------------------------------------
	// loads multiple templates
	// ---------------------------------------------------------------

	it("loads multiple templates", () => {
		tmpDir = makeTmp();
		const siaDir = join(tmpDir, ".sia");
		mkdirSync(join(siaDir, "templates"), { recursive: true });

		writeFileSync(
			join(siaDir, "templates", "adr.yaml"),
			[
				"kind: Decision",
				"fields:",
				"  context:",
				"    description: What is the problem?",
				"    required: true",
				"tags_prefix: [adr]",
				"auto_relate: true",
			].join("\n"),
		);

		writeFileSync(
			join(siaDir, "templates", "bug-report.yml"),
			[
				"kind: BugReport",
				"fields:",
				"  summary:",
				"    description: Brief summary of the bug",
				"    required: true",
				"  steps:",
				"    description: Steps to reproduce",
				"    required: true",
				"  expected:",
				"    description: Expected behavior",
				"    required: false",
				"tags_prefix: [bug]",
				"auto_relate: false",
			].join("\n"),
		);

		const templates = loadTemplates(siaDir);

		expect(templates.size).toBe(2);
		expect(templates.has("adr")).toBe(true);
		expect(templates.has("bug-report")).toBe(true);

		const bugReport = templates.get("bug-report") as KnowledgeTemplate;
		expect(bugReport.kind).toBe("BugReport");
		expect(bugReport.autoRelate).toBe(false);
		expect(bugReport.tagsPrefix).toEqual(["bug"]);
		expect(Object.keys(bugReport.fields)).toHaveLength(3);
	});

	// ---------------------------------------------------------------
	// validateTemplate returns errors for missing required fields
	// ---------------------------------------------------------------

	it("validateTemplate returns errors for missing required fields", () => {
		const template: KnowledgeTemplate = {
			name: "adr",
			kind: "Decision",
			fields: {
				context: { description: "What is the problem?", required: true },
				decision: { description: "What was decided?", required: true },
				consequences: {
					description: "What are the implications?",
					required: false,
				},
			},
			tagsPrefix: ["adr"],
			autoRelate: true,
		};

		const errors = validateTemplate(template, {
			context: "We need to choose a database",
		});

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("decision");
	});

	// ---------------------------------------------------------------
	// validateTemplate returns empty for valid properties
	// ---------------------------------------------------------------

	it("validateTemplate returns empty for valid properties", () => {
		const template: KnowledgeTemplate = {
			name: "adr",
			kind: "Decision",
			fields: {
				context: { description: "What is the problem?", required: true },
				decision: { description: "What was decided?", required: true },
			},
			tagsPrefix: ["adr"],
			autoRelate: true,
		};

		const errors = validateTemplate(template, {
			context: "We need to choose a database",
			decision: "Use SQLite",
		});

		expect(errors).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// handles templates with no required fields
	// ---------------------------------------------------------------

	it("handles templates with no required fields", () => {
		const template: KnowledgeTemplate = {
			name: "note",
			kind: "Note",
			fields: {
				body: { description: "Free-form note", required: false },
				tags: { description: "Optional tags", required: false },
			},
			tagsPrefix: [],
			autoRelate: false,
		};

		const errors = validateTemplate(template, {});

		expect(errors).toHaveLength(0);
	});
});
