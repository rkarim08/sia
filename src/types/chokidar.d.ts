declare module "chokidar" {
	export interface WatchOptions {
		ignoreInitial?: boolean;
		ignored?:
			| ((path: string, stats?: { isDirectory(): boolean }) => boolean)
			| RegExp
			| string
			| string[];
	}

	export interface FSWatcher {
		on(event: "add" | "change" | "unlink", listener: (path: string) => void): this;
		close(): Promise<void> | void;
	}

	export function watch(paths: string | string[], options?: WatchOptions): FSWatcher;

	const chokidar: {
		watch: typeof watch;
	};

	export default chokidar;
}
