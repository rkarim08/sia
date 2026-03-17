// Module: team — team sync CLI helpers

import { randomUUID } from "node:crypto";
import type { SiaDb } from "@/graph/db-interface";
import { deleteToken, storeToken } from "@/sync/keychain";
import { pullChanges } from "@/sync/pull";
import { getConfig, writeConfig, type SiaConfig } from "@/shared/config";

export interface TeamStatus {
        enabled: boolean;
        serverUrl: string | null;
        developerId: string | null;
        syncInterval: number;
}

function ensureDeveloperId(config: SiaConfig): string {
        if (config.sync.developerId) return config.sync.developerId;
        const id = randomUUID();
        writeConfig({ sync: { developerId: id } });
        return id;
}

export async function teamJoin(
        serverUrl: string,
        token: string,
        opts: { syncInterval?: number; siaHome?: string; repoHash?: string; db?: SiaDb; bridgeDb?: SiaDb } = {},
): Promise<void> {
        await storeToken(serverUrl, token);

        const config = getConfig(opts.siaHome);
        const developerId = ensureDeveloperId(config);

        writeConfig(
                {
                        sync: {
                                enabled: true,
                                serverUrl,
                                developerId,
                                syncInterval: opts.syncInterval ?? config.sync.syncInterval,
                        },
                },
                opts.siaHome,
        );

        if (opts.db && opts.bridgeDb) {
                await pullChanges(opts.db, opts.bridgeDb, {
                        enabled: true,
                        serverUrl,
                        developerId,
                        syncInterval: opts.syncInterval ?? config.sync.syncInterval,
                });
        }
}

export async function teamLeave(opts: { siaHome?: string; db?: SiaDb } = {}): Promise<void> {
        const config = getConfig(opts.siaHome);
        if (config.sync.serverUrl) {
                await deleteToken(config.sync.serverUrl);
        }

        writeConfig(
                {
                        sync: {
                                enabled: false,
                                serverUrl: null,
                                developerId: config.sync.developerId,
                                syncInterval: config.sync.syncInterval,
                        },
                },
                opts.siaHome,
        );

        if (opts.db) {
                        await opts.db.execute("UPDATE entities SET visibility = 'private', workspace_scope = NULL");
        }
}

export function teamStatus(opts: { siaHome?: string } = {}): TeamStatus {
        const config = getConfig(opts.siaHome);
        return {
                enabled: config.sync.enabled,
                serverUrl: config.sync.serverUrl,
                developerId: config.sync.developerId,
                syncInterval: config.sync.syncInterval,
        };
}
