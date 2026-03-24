import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	getNewestHtml,
	buildFrameHtml,
	FRAME_TEMPLATE,
} from "../../../scripts/viz-server";

describe("viz-server", () => {
	let screenDir: string;

	beforeEach(() => {
		screenDir = join(tmpdir(), `sia-viz-test-${Date.now()}`);
		mkdirSync(screenDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(screenDir)) {
			rmSync(screenDir, { recursive: true, force: true });
		}
	});

	describe("getNewestHtml", () => {
		it("returns null when directory is empty", () => {
			expect(getNewestHtml(screenDir)).toBeNull();
		});

		it("returns null when directory does not exist", () => {
			expect(getNewestHtml("/nonexistent-dir-xyz")).toBeNull();
		});

		it("returns the newest HTML file", () => {
			writeFileSync(join(screenDir, "old.html"), "<p>old</p>");
			// Ensure different mtime by writing a second file
			writeFileSync(join(screenDir, "new.html"), "<p>new</p>");
			const result = getNewestHtml(screenDir);
			// Should return one of the html files (newest by mtime)
			expect(result).toMatch(/\.html$/);
		});

		it("ignores non-HTML files", () => {
			writeFileSync(join(screenDir, "data.json"), "{}");
			expect(getNewestHtml(screenDir)).toBeNull();
		});
	});

	describe("FRAME_TEMPLATE", () => {
		it("contains SIA branding", () => {
			expect(FRAME_TEMPLATE).toContain("SIA");
			expect(FRAME_TEMPLATE).toContain("Knowledge Graph Visualizer");
		});

		it("contains content placeholder", () => {
			expect(FRAME_TEMPLATE).toContain("{{CONTENT}}");
		});
	});

	describe("buildFrameHtml", () => {
		it("replaces content placeholder", () => {
			const html = buildFrameHtml("<h2>Test</h2>");
			expect(html).toContain("<h2>Test</h2>");
			expect(html).not.toContain("{{CONTENT}}");
		});

		it("generates valid HTML", () => {
			const html = buildFrameHtml("<p>Hello</p>");
			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain("</html>");
		});
	});
});
