import { describe, expect, it } from "vitest";
import { parseVisualizeLiveArgs } from "@/cli/commands/visualize-live";

describe("visualize-live CLI", () => {
	describe("parseVisualizeLiveArgs", () => {
		it("returns defaults for empty args", () => {
			const opts = parseVisualizeLiveArgs([]);
			expect(opts.view).toBeUndefined();
			expect(opts.port).toBeUndefined();
		});

		it("parses --view flag", () => {
			const opts = parseVisualizeLiveArgs(["--view", "timeline"]);
			expect(opts.view).toBe("timeline");
		});

		it("parses --port flag", () => {
			const opts = parseVisualizeLiveArgs(["--port", "8080"]);
			expect(opts.port).toBe(8080);
		});

		it("parses --scope flag", () => {
			const opts = parseVisualizeLiveArgs(["--scope", "src/auth"]);
			expect(opts.scope).toBe("src/auth");
		});

		it("parses --max-nodes flag", () => {
			const opts = parseVisualizeLiveArgs(["--max-nodes", "100"]);
			expect(opts.maxNodes).toBe(100);
		});

		it("parses multiple flags together", () => {
			const opts = parseVisualizeLiveArgs([
				"--view",
				"deps",
				"--port",
				"9000",
				"--scope",
				"src/graph",
				"--max-nodes",
				"50",
			]);
			expect(opts.view).toBe("deps");
			expect(opts.port).toBe(9000);
			expect(opts.scope).toBe("src/graph");
			expect(opts.maxNodes).toBe(50);
		});
	});
});
