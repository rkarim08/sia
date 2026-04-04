import { describe, expect, it, vi } from "vitest";
import { embedEntity, embedEntitiesBatch } from "@/capture/embed-entity";

describe("embedEntity", () => {
	it("embeds entity and updates graph_nodes", async () => {
		const mockEmbedder = {
			embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
			embedBatch: vi.fn(),
			close: vi.fn(),
		};
		const mockDb = { execute: vi.fn() };

		await embedEntity(mockDb as any, mockEmbedder as any, {
			id: "ent-1",
			name: "test",
			summary: "a test entity",
			content: "some content",
		});

		expect(mockEmbedder.embed).toHaveBeenCalledTimes(1);
		expect(mockDb.execute).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE graph_nodes SET embedding"),
			expect.arrayContaining(["ent-1"]),
		);
	});

	it("skips when embedder is null", async () => {
		const mockDb = { execute: vi.fn() };
		await embedEntity(mockDb as any, null, { id: "ent-1", name: "test", summary: "", content: "" });
		expect(mockDb.execute).not.toHaveBeenCalled();
	});
});

describe("embedEntitiesBatch", () => {
	it("embeds multiple entities and returns count", async () => {
		const mockEmbedder = {
			embed: vi.fn(),
			embedBatch: vi.fn().mockResolvedValue([
				new Float32Array(384).fill(0.1),
				new Float32Array(384).fill(0.2),
			]),
			close: vi.fn(),
		};
		const mockDb = { execute: vi.fn() };

		const count = await embedEntitiesBatch(mockDb as any, mockEmbedder as any, [
			{ id: "e1", name: "foo", summary: "s1", content: "c1" },
			{ id: "e2", name: "bar", summary: "s2", content: "c2" },
		]);

		expect(count).toBe(2);
		expect(mockDb.execute).toHaveBeenCalledTimes(2);
	});
});
