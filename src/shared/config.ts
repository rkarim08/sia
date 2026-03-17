// Module: config — SIA_HOME constant and SyncConfig type
import { homedir } from "node:os";
import { join } from "node:path";

/** Default root directory for all Sia data: ~/.sia */
export const SIA_HOME: string = join(homedir(), ".sia");

/** Configuration for optional sync/replication via @libsql/client. */
export interface SyncConfig {
	enabled: boolean;
	serverUrl: string | null;
	developerId: string | null;
	syncInterval: number;
}

/** Default SyncConfig — sync disabled, no remote. */
export const DEFAULT_SYNC_CONFIG: SyncConfig = {
	enabled: false,
	serverUrl: null,
	developerId: null,
	syncInterval: 30,
};
