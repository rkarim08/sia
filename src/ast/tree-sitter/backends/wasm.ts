import type { ParserBackend } from "./native";

export async function tryLoadWasmBackend(): Promise<ParserBackend | null> {
	try {
		const mod = await import("web-tree-sitter");
		const TreeSitter = (mod.default ?? mod) as any;
		let ParserClass: any;
		if (typeof TreeSitter.init === "function") {
			await TreeSitter.init();
			ParserClass = TreeSitter;
		} else if (typeof TreeSitter.Parser?.init === "function") {
			await TreeSitter.Parser.init();
			ParserClass = TreeSitter.Parser;
		} else {
			ParserClass = TreeSitter;
		}

		const LanguageClass = ParserClass.Language ?? TreeSitter.Language;

		return {
			type: "wasm",
			createParser() {
				return new ParserClass();
			},
			async loadLanguage(wasmPath: string, _entrypoint?: string) {
				return await LanguageClass.load(wasmPath);
			},
			setTimeoutMicros(parser: any, micros: number) {
				if (typeof parser.setTimeoutMicros === "function") {
					parser.setTimeoutMicros(micros);
				}
			},
			parse(parser: any, source: string, language: unknown, previousTree?: unknown) {
				parser.setLanguage(language);
				return parser.parse(source, previousTree as any) ?? null;
			},
			query(language: any, querySource: string) {
				return language.query(querySource);
			},
			getChangedRanges(oldTree: any, newTree: any) {
				if (typeof oldTree.getChangedRanges === "function") {
					return oldTree.getChangedRanges(newTree);
				}
				return [];
			},
		};
	} catch {
		return null;
	}
}
