import { describe, expect, it } from "vitest";
import { err, ok, siaError, tryCatch } from "@/shared/errors";

describe("Result type and helpers", () => {
	it("ok creates success result", () => {
		const r = ok(42);
		expect(r.ok).toBe(true);
		expect((r as { ok: true; value: number }).value).toBe(42);
	});

	it("err creates failure result", () => {
		const r = err(siaError("DB_ERR", "graph", "insert", "failed"));
		expect(r.ok).toBe(false);
		expect((r as { ok: false; error: { code: string } }).error.code).toBe("DB_ERR");
	});

	it("siaError creates structured error", () => {
		const e = siaError("NET", "sync", "push", "timeout", new Error("conn"));
		expect(e.code).toBe("NET");
		expect(e.module).toBe("sync");
		expect(e.operation).toBe("push");
		expect(e.message).toBe("timeout");
		expect(e.cause).toBeInstanceOf(Error);
	});

	it("tryCatch wraps success", async () => {
		const r = await tryCatch(async () => 42, "test", "op");
		expect(r.ok).toBe(true);
		expect((r as { ok: true; value: number }).value).toBe(42);
	});

	it("tryCatch wraps thrown error", async () => {
		const r = await tryCatch(
			async () => {
				throw new Error("boom");
			},
			"test",
			"op",
		);
		expect(r.ok).toBe(false);
		expect((r as { ok: false; error: { message: string } }).error.message).toBe("boom");
	});

	it("tryCatch wraps non-Error throw", async () => {
		const r = await tryCatch(
			async () => {
				throw "string error";
			},
			"test",
			"op",
		);
		expect(r.ok).toBe(false);
		expect((r as { ok: false; error: { message: string } }).error.message).toBe("string error");
	});
});
