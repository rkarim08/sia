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

        const keyring = await getKeyring();
        if (keyring) {
                const EntryCtor =
                        (keyring as { Entry?: new (s: string, a: string) => any }).Entry ??
                        (keyring as { default?: { Entry?: new (s: string, a: string) => any } }).default?.Entry ??
                        (keyring as { Keyring?: new (s: string, a: string) => any }).Keyring ??
                        (keyring as { default?: new (s: string, a: string) => any }).default;
                if (EntryCtor) {
                        try {
                                const entry = new EntryCtor(SERVICE_NAME, serverUrl);
                                await entry.setPassword(token);
                                return;
                        } catch {
                                // Fall back to file store on keychain errors (e.g., unavailable keychain)
                        }
                }
                // If module loaded but no constructor, fall back to file store.
        }

        const map = readFallback();
        map[serverUrl] = token;
        writeFallback(map);
}

export async function getToken(serverUrl: string): Promise<string | null> {
        if (shouldUseFallback()) {
                const map = readFallback();
                return map[serverUrl] ?? null;
        }

        const keyring = await getKeyring();
        if (keyring) {
                const EntryCtor =
                        (keyring as { Entry?: new (s: string, a: string) => any }).Entry ??
                        (keyring as { default?: { Entry?: new (s: string, a: string) => any } }).default?.Entry ??
                        (keyring as { Keyring?: new (s: string, a: string) => any }).Keyring ??
                        (keyring as { default?: new (s: string, a: string) => any }).default;
                if (EntryCtor) {
                        try {
                                const entry = new EntryCtor(SERVICE_NAME, serverUrl);
                                const result = await entry.getPassword();
                                return result ?? null;
                        } catch {
                                // fall back to file store
                        }
                }
        }

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

        const keyring = await getKeyring();
        if (keyring) {
                const EntryCtor =
                        (keyring as { Entry?: new (s: string, a: string) => any }).Entry ??
                        (keyring as { default?: { Entry?: new (s: string, a: string) => any } }).default?.Entry ??
                        (keyring as { Keyring?: new (s: string, a: string) => any }).Keyring ??
                        (keyring as { default?: new (s: string, a: string) => any }).default;
                if (EntryCtor) {
                        try {
                                const entry = new EntryCtor(SERVICE_NAME, serverUrl);
                                await entry.deletePassword();
                                return;
                        } catch {
                                // fall back to file store
                        }
                }
        }

        const map = readFallback();
        if (map[serverUrl]) {
                delete map[serverUrl];
                writeFallback(map);
        }
}
