// Module: errors — Result type for fallible operations

/** Structured error type for all Sia operations. */
export interface SiaError {
	code: string;
	module: string;
	operation: string;
	message: string;
	cause?: unknown;
}

/** Discriminated union: either success with data, or failure with error. */
export type Result<T, E = SiaError> = { ok: true; value: T } | { ok: false; error: E };

/** Create a successful result. */
export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

/** Create a failure result. */
export function err<E = SiaError>(error: E): Result<never, E> {
	return { ok: false, error };
}

/** Create a SiaError. */
export function siaError(
	code: string,
	module: string,
	operation: string,
	message: string,
	cause?: unknown,
): SiaError {
	return { code, module, operation, message, cause };
}

/** Wrap a promise in a Result, catching any thrown error. */
export async function tryCatch<T>(
	fn: () => Promise<T>,
	module: string,
	operation: string,
): Promise<Result<T>> {
	try {
		return ok(await fn());
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return err(siaError("UNHANDLED", module, operation, message, cause));
	}
}
