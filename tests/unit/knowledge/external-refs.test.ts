import { describe, expect, it } from "vitest";
import {
	classifyUrl,
	detectExternalRefs,
	EXTERNAL_SERVICE_PATTERNS,
} from "@/knowledge/external-refs";

describe("external reference detection", () => {
	// ---------------------------------------------------------------
	// Single-service detection
	// ---------------------------------------------------------------

	describe("single-service detection", () => {
		it("detects Notion links", () => {
			const content = "See the design doc at https://notion.so/workspace/page-id-123";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("notion");
			expect(refs[0].url).toBe("https://notion.so/workspace/page-id-123");
		});

		it("detects Confluence links", () => {
			const content = "Refer to https://myteam.atlassian.net/wiki/spaces/DEV/pages/123 for details";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("confluence");
		});

		it("detects GitHub issue links", () => {
			const content = "Related to https://github.com/org/repo/issues/42";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("github-issue");
			expect(refs[0].url).toBe("https://github.com/org/repo/issues/42");
		});

		it("detects GitHub PR links", () => {
			const content = "Fixed in https://github.com/my-org/my-repo/pull/99";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("github-pr");
		});

		it("detects GitHub wiki links", () => {
			const content = "See https://github.com/acme/project/wiki for setup instructions";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("github-wiki");
		});

		it("detects Google Docs links", () => {
			const content = "Spec is at https://docs.google.com/document/d/1abc/edit";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("google-docs");
		});

		it("detects Jira links", () => {
			const content = "Tracked in https://myteam.atlassian.net/browse/PROJ-456";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("jira");
		});

		it("detects Linear links", () => {
			const content = "Issue at https://linear.app/team/issue/ENG-123";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("linear");
		});

		it("detects Figma links", () => {
			const content = "Mockups: https://figma.com/file/abc123/Design";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("figma");
		});

		it("detects Miro links", () => {
			const content = "Board at https://miro.com/app/board/abc123";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("miro");
		});

		it("detects Stack Overflow links", () => {
			const content = "Solution from https://stackoverflow.com/questions/12345/how-to-foo";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("stackoverflow");
		});
	});

	// ---------------------------------------------------------------
	// Multiple services
	// ---------------------------------------------------------------

	describe("multiple services", () => {
		it("detects multiple services in same content", () => {
			const content = [
				"Design: https://notion.so/workspace/design-doc",
				"Ticket: https://myteam.atlassian.net/browse/PROJ-789",
				"Mockup: https://figma.com/file/xyz/Wireframes",
			].join("\n");

			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(3);

			const services = refs.map((r) => r.service);
			expect(services).toContain("notion");
			expect(services).toContain("jira");
			expect(services).toContain("figma");
		});

		it("detects multiple URLs on the same line", () => {
			const content = "See https://notion.so/workspace/page and https://figma.com/file/abc/Design";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(2);
			expect(refs[0].lineNumber).toBe(1);
			expect(refs[1].lineNumber).toBe(1);
		});
	});

	// ---------------------------------------------------------------
	// Line numbers
	// ---------------------------------------------------------------

	describe("line numbers", () => {
		it("returns correct line numbers", () => {
			const content = [
				"https://notion.so/workspace/page-1",
				"Some text without URLs",
				"https://figma.com/file/abc/Design",
				"More plain text",
				"https://github.com/org/repo/issues/7",
			].join("\n");

			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(3);
			expect(refs[0].lineNumber).toBe(1);
			expect(refs[1].lineNumber).toBe(3);
			expect(refs[2].lineNumber).toBe(5);
		});
	});

	// ---------------------------------------------------------------
	// Filtering — non-service URLs excluded
	// ---------------------------------------------------------------

	describe("filtering", () => {
		it("ignores non-service URLs", () => {
			const content = [
				"Visit https://example.com/page for info",
				"Also see https://my-company.com/docs",
				"And https://random-site.org/article",
			].join("\n");

			const refs = detectExternalRefs(content);
			expect(refs).toHaveLength(0);
		});

		it("only returns matched service URLs among mixed content", () => {
			const content = [
				"Our docs: https://example.com/docs",
				"Design: https://figma.com/file/abc/mockup",
				"Blog: https://medium.com/article",
			].join("\n");

			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("figma");
		});
	});

	// ---------------------------------------------------------------
	// classifyUrl
	// ---------------------------------------------------------------

	describe("classifyUrl", () => {
		it("identifies known services", () => {
			expect(classifyUrl("https://notion.so/workspace/page")).toBe("notion");
			expect(classifyUrl("https://myteam.atlassian.net/wiki/spaces/DEV")).toBe("confluence");
			expect(classifyUrl("https://docs.google.com/document/d/1abc")).toBe("google-docs");
			expect(classifyUrl("https://myteam.atlassian.net/browse/PROJ-1")).toBe("jira");
			expect(classifyUrl("https://linear.app/team/issue/ENG-1")).toBe("linear");
			expect(classifyUrl("https://figma.com/file/abc")).toBe("figma");
			expect(classifyUrl("https://miro.com/app/board/abc")).toBe("miro");
			expect(classifyUrl("https://github.com/org/repo/wiki")).toBe("github-wiki");
			expect(classifyUrl("https://github.com/org/repo/issues/1")).toBe("github-issue");
			expect(classifyUrl("https://github.com/org/repo/pull/1")).toBe("github-pr");
			expect(classifyUrl("https://stackoverflow.com/questions/123/title")).toBe("stackoverflow");
		});

		it("returns null for unknown URLs", () => {
			expect(classifyUrl("https://example.com/page")).toBeNull();
			expect(classifyUrl("https://my-company.com/docs")).toBeNull();
			expect(classifyUrl("https://random-site.org/article")).toBeNull();
		});
	});

	// ---------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------

	describe("edge cases", () => {
		it("returns empty array for empty string", () => {
			expect(detectExternalRefs("")).toHaveLength(0);
		});

		it("returns empty array for whitespace-only string", () => {
			expect(detectExternalRefs("   \n\n  ")).toHaveLength(0);
		});

		it("returns empty array for content with no URLs", () => {
			const content = "This is plain text with no links at all.";
			expect(detectExternalRefs(content)).toHaveLength(0);
		});

		it("handles URLs inside markdown link syntax", () => {
			const content = "Check [the design](https://notion.so/workspace/page-abc)";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("notion");
		});

		it("handles URLs inside angle brackets", () => {
			const content = "Link: <https://figma.com/file/abc/mockup>";
			const refs = detectExternalRefs(content);

			expect(refs).toHaveLength(1);
			expect(refs[0].service).toBe("figma");
		});
	});

	// ---------------------------------------------------------------
	// Pattern coverage
	// ---------------------------------------------------------------

	describe("pattern coverage", () => {
		it("has patterns for all expected services", () => {
			const services = EXTERNAL_SERVICE_PATTERNS.map((p) => p.service);

			expect(services).toContain("notion");
			expect(services).toContain("confluence");
			expect(services).toContain("google-docs");
			expect(services).toContain("jira");
			expect(services).toContain("linear");
			expect(services).toContain("figma");
			expect(services).toContain("miro");
			expect(services).toContain("github-wiki");
			expect(services).toContain("github-issue");
			expect(services).toContain("github-pr");
			expect(services).toContain("stackoverflow");
		});
	});
});
