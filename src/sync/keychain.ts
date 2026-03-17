// Module: keychain — OS keychain integration with file fallback

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SIA_HOME } from "@/shared/config";

const SERVICE_NAME = "sia-sync";
const FALLBACK_PATH = join(SIA_HOME, ".tokens");
const FALLBACK_ENV_FLAG = "SIA_KEYCHAIN_FALLBACK";

function shouldUseFallback(): boolean {
	return process.env[FALLBACK_ENV_FLAG] === "1";
}

type KeyringModule = typeof import("@napi-rs/keyring");

let keyringModulePromise: Promise<KeyringModule | null> | null = null;

async function getKeyring(): Promise<KeyringModule | null> {
	if (!keyringModulePromise) {
		keyringModulePromise = import("@napi-rs/keyring").catch(() => null);
	}
	return keyringModulePromise;
}

type KeychainEntry = {
	setPassword(pw: string): Promise<void>;
	getPassword(): Promise<string | null>;
	deletePassword(): Promise<void>;
};

async function getKeychainEntry(serverUrl: string): Promise<KeychainEntry | null> {
	const keyring = await getKeyring();
	if (!keyring) return null;

	const EntryCtor =
		(keyring as any).Entry ??
		(keyring as any).default?.Entry ??
		(keyring as any).Keyring ??
		(keyring as any).default;

	if (!EntryCtor) return null;
	try {
		return new EntryCtor(SERVICE_NAME, serverUrl) as KeychainEntry;
	} catch {
		return null;
	}
}

function readFallback(): Record<string, string> {
	if (!existsSync(FALLBACK_PATH)) return {};
	try {
		const parsed = JSON.parse(readFileSync(FALLBACK_PATH, "utf-8")) as Record<string, string>;
		return parsed;
	} catch {
		return {};
	}
}

function writeFallback(map: Record<string, string>): void {
	const dir = dirname(FALLBACK_PATH);
	mkdirSync(dir, { recursive: true });
	writeFileSync(FALLBACK_PATH, JSON.stringify(map, null, 2), { encoding: "utf-8", mode: 0o600 });
	try {
		chmodSync(FALLBACK_PATH, 0o600);
	} catch {
		// best effort — continue
	}
}

export async function storeToken(serverUrl: string, token: string): Promise<void> {
	if (shouldUseFallback()) {
		const map = readFallback();
		map[serverUrl] = token;
		writeFallback(map);
		return;
	}

	const entry = await getKeychainEntry(serverUrl);
	if (entry) {
		try {
			await entry.setPassword(token);
			return;
		} catch {
			// Fall back to file store on keychain errors
		}
	}

	console.warn("OS keychain unavailable — falling back to file storage");
	const map = readFallback();
	map[serverUrl] = token;
	writeFallback(map);
}

export async function getToken(serverUrl: string): Promise<string | null> {
	if (shouldUseFallback()) {
		const map = readFallback();
		return map[serverUrl] ?? null;
	}

	const entry = await getKeychainEntry(serverUrl);
	if (entry) {
		try {
			const result = await entry.getPassword();
			return result ?? null;
		} catch {
			// Fall back to file store
		}
	}

	console.warn("OS keychain unavailable — falling back to file storage");
	const map = readFallback();
	return map[serverUrl] ?? null;
}

export async function deleteToken(serverUrl: string): Promise<void> {
	if (shouldUseFallback()) {
		const map = readFallback();
		if (map[serverUrl]) {
			delete map[serverUrl];
			writeFallback(map);
		}
		return;
	}

	const entry = await getKeychainEntry(serverUrl);
	if (entry) {
		try {
			await entry.deletePassword();
			return;
		} catch {
			// Fall back to file store
		}
	}

	console.warn("OS keychain unavailable — falling back to file storage");
	const map = readFallback();
	if (map[serverUrl]) {
		delete map[serverUrl];
		writeFallback(map);
	}
}
