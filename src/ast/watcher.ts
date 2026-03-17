import { existsSync, watch as fsWatch, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { getLanguageForFile } from "@/ast/languages";
import { createIgnoreMatcher, detectPackagePath, toPosixPath } from "@/ast/path-utils";
import { extractTrackA } from "@/capture/track-a-ast";
import type { SiaDb } from "@/graph/db-interface";
import { getActiveEdges, invalidateEdge } from "@/graph/edges";
import { insertEntity, invalidateEntity, updateEntity } from "@/graph/entities";
import type { SiaConfig } from "@/shared/config";

export interface FileWatcher {
	start(): void;
	stop(): Promise<void>;
	ready: Promise<void>;
}

interface TrackedEntity {
	id: string;
	name: string;
	content: string;
}

async function getEntitiesForPath(db: SiaDb, relPath: string): Promise<TrackedEntity[]> {
	const pattern = `%"${relPath}"%`;
	const result = await db.execute(
		"SELECT id, name, content FROM entities WHERE t_valid_until IS NULL AND archived_at IS NULL AND file_paths LIKE ?",
		[pattern],
	);
	return result.rows as TrackedEntity[];
}

async function invalidateEdgesForEntity(db: SiaDb, entityId: string, ts: number): Promise<void> {
	const edges = await getActiveEdges(db, entityId);
	for (const edge of edges) {
		await invalidateEdge(db, edge.id, ts);
	}
}

async function handleDeletion(db: SiaDb, relPath: string): Promise<void> {
	const existing = await getEntitiesForPath(db, relPath);
	const ts = Date.now();
	for (const entity of existing) {
		await invalidateEntity(db, entity.id, ts);
		await invalidateEdgesForEntity(db, entity.id, ts);
	}
}

async function handleChange(db: SiaDb, relPath: string, content: string): Promise<void> {
	const facts = extractTrackA(content, relPath);
	const existing = await getEntitiesForPath(db, relPath);

	const existingByName = new Map(existing.map((e) => [e.name, e]));
	const newNames = new Set(facts.map((f) => f.name));

	for (const fact of facts) {
		const existingEntity = existingByName.get(fact.name);
		if (existingEntity) {
			// Update content if changed
			if (existingEntity.content !== fact.content) {
				await updateEntity(db, existingEntity.id, {
					content: fact.content,
					summary: fact.summary,
				});
			}
			continue;
		}

		await insertEntity(db, {
			type: fact.type,
			name: fact.name,
			content: fact.content,
			summary: fact.summary,
			tags: JSON.stringify(fact.tags ?? []),
			file_paths: JSON.stringify([relPath]),
			trust_tier: fact.trust_tier,
			confidence: fact.confidence,
			package_path: detectPackagePath(relPath),
			extraction_method: fact.extraction_method ?? null,
		});
	}

	// Invalidate removed entities + edges
	const ts = Date.now();
	for (const entity of existing) {
		if (newNames.has(entity.name)) continue;
		await invalidateEntity(db, entity.id, ts);
		await invalidateEdgesForEntity(db, entity.id, ts);
	}
}

type CloseableWatcher = {
	close(): void | Promise<void>;
};

async function createUnderlyingWatcher(
	root: string,
	ignoreMatcher: ReturnType<typeof createIgnoreMatcher>,
	onChange: (absPath: string) => void,
	onDelete: (absPath: string) => void,
	onReady: () => void,
): Promise<CloseableWatcher> {
	try {
		const mod = await import("chokidar");
		const chokidar = mod as unknown as {
			default?: { watch: typeof import("chokidar").watch };
			watch: typeof import("chokidar").watch;
		};
		const watchFn = chokidar.watch ?? chokidar.default?.watch;
		if (!watchFn) {
			throw new Error("chokidar watch not available");
		}
		const watcher = watchFn(root, {
			ignoreInitial: true,
			ignored: (path, stats) =>
				ignoreMatcher.shouldIgnore(path ?? "", Boolean(stats?.isDirectory())),
		});
		watcher.on("change", onChange);
		watcher.on("add", onChange);
		watcher.on("unlink", onDelete);
		watcher.on("ready", onReady);
		return watcher;
	} catch {
		// Fallback: fs.watch (recursive on macOS/Windows)
		const watcher = fsWatch(root, { recursive: true }, (eventType, filename) => {
			if (!filename) return;
			const absPath = join(root, filename.toString());
			if (ignoreMatcher.shouldIgnore(absPath, false)) return;
			if (eventType === "rename") {
				if (existsSync(absPath)) {
					onChange(absPath);
				} else {
					onDelete(absPath);
				}
				return;
			}
			onChange(absPath);
		});
		onReady();
		return watcher;
	}
}

export function createWatcher(repoRoot: string, db: SiaDb, config: SiaConfig): FileWatcher {
	const root = resolve(repoRoot);
	const ignoreMatcher = createIgnoreMatcher(root, config.excludePaths ?? []);

	let closer: CloseableWatcher | null = null;
	let readyPromise: Promise<void> = Promise.resolve();
	let readyResolve: () => void = () => {};
	// Track file mtimes for initial sync
	const fileMtimes = new Map<string, number>();

	function normalize(absPath: string): string | null {
		const rel = toPosixPath(relative(root, absPath));
		if (rel.startsWith("..")) return null;
		return rel;
	}

	async function syncOnce(): Promise<void> {
		const seen = new Set<string>();
		const walk = async (dir: string): Promise<void> => {
			let entries: ReturnType<typeof readdirSync>;
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const absPath = join(dir, entry.name);
				const isDir = entry.isDirectory();
				if (ignoreMatcher.shouldIgnore(absPath, isDir)) continue;
				if (isDir) {
					await walk(absPath);
					continue;
				}
				const relPath = normalize(absPath);
				if (!relPath) continue;
				seen.add(relPath);
				const stat = statSync(absPath);
				const prev = fileMtimes.get(relPath);
				if (prev === undefined || prev !== stat.mtimeMs) {
					fileMtimes.set(relPath, stat.mtimeMs);
					const content = readFileSync(absPath, "utf-8");
					await handleChange(db, relPath, content);
				}
			}
		};

		await walk(root);

		for (const path of [...fileMtimes.keys()]) {
			if (!seen.has(path)) {
				fileMtimes.delete(path);
				await handleDeletion(db, path);
			}
		}
	}

	const start = (): void => {
		readyPromise = new Promise<void>((resolveReady) => {
			readyResolve = resolveReady;
		});

		void (async () => {
			closer = await createUnderlyingWatcher(
				root,
				ignoreMatcher,
				(absPath) => {
					const relPath = normalize(absPath);
					if (!relPath) return;
					if (ignoreMatcher.shouldIgnore(absPath, false)) return;
					const language = getLanguageForFile(absPath);
					if (!language) return;
					try {
						const content = readFileSync(absPath, "utf-8");
						void handleChange(db, relPath, content);
					} catch {
						void handleDeletion(db, relPath);
					}
				},
				(absPath) => {
					const relPath = normalize(absPath);
					if (!relPath) return;
					void handleDeletion(db, relPath);
				},
				() => {
					// Initial sync after chokidar is ready
					void syncOnce().then(() => readyResolve());
				},
			);
		})();
	};

	const stop = async (): Promise<void> => {
		await syncOnce();
		if (closer) {
			await closer.close();
			closer = null;
		}
	};

	return {
		start,
		stop,
		get ready(): Promise<void> {
			return readyPromise;
		},
	};
}
