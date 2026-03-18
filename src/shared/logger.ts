// Module: logger — structured JSON logging to sia.log

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SIA_HOME } from "@/shared/config";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	ts: number;
	level: LogLevel;
	module: string;
	op: string;
	message: string;
	error?: string;
	[key: string]: unknown;
}

export interface Logger {
	debug(module: string, op: string, message: string, extra?: Record<string, unknown>): void;
	info(module: string, op: string, message: string, extra?: Record<string, unknown>): void;
	warn(module: string, op: string, message: string, extra?: Record<string, unknown>): void;
	error(
		module: string,
		op: string,
		message: string,
		err?: unknown,
		extra?: Record<string, unknown>,
	): void;
}

export function createLogger(siaHome?: string): Logger {
	const home = siaHome ?? SIA_HOME;
	const logDir = join(home, "logs");
	const logFile = join(logDir, "sia.log");

	if (!existsSync(logDir)) {
		mkdirSync(logDir, { recursive: true });
	}

	function write(entry: LogEntry): void {
		appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
	}

	function log(
		level: LogLevel,
		module: string,
		op: string,
		message: string,
		extra?: Record<string, unknown>,
	): void {
		const entry: LogEntry = {
			ts: Date.now(),
			level,
			module,
			op,
			message,
			...extra,
		};
		write(entry);
	}

	return {
		debug(module: string, op: string, message: string, extra?: Record<string, unknown>): void {
			log("debug", module, op, message, extra);
		},

		info(module: string, op: string, message: string, extra?: Record<string, unknown>): void {
			log("info", module, op, message, extra);
		},

		warn(module: string, op: string, message: string, extra?: Record<string, unknown>): void {
			log("warn", module, op, message, extra);
		},

		error(
			module: string,
			op: string,
			message: string,
			err?: unknown,
			extra?: Record<string, unknown>,
		): void {
			const errorMessage =
				err instanceof Error ? err.message : err != null ? String(err) : undefined;
			const entry: LogEntry = {
				ts: Date.now(),
				level: "error",
				module,
				op,
				message,
				...(errorMessage != null ? { error: errorMessage } : {}),
				...extra,
			};
			write(entry);
		},
	};
}

export const defaultLogger: Logger = createLogger();
