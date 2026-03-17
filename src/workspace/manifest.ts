// Module: manifest — .sia-manifest.yaml parser and contract writer
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type { SiaDb } from "@/graph/db-interface";

export interface ManifestContract {
	type: string;
	path?: string;
	package?: string;
}

export interface SiaManifest {
	provides: ManifestContract[];
	consumes: ManifestContract[];
	depends_on: ManifestContract[];
}

/**
 * Parse a .sia-manifest.yaml string into a SiaManifest.
 * Returns null on malformed YAML (logs warning, never throws).
 */
export function parseManifest(content: string): SiaManifest | null {
	let doc: Record<string, unknown>;
	try {
		doc = parseYaml(content) as Record<string, unknown>;
	} catch (err) {
		console.warn("sia-manifest.yaml: malformed YAML, skipping", err);
		return null;
	}

	if (!doc || typeof doc !== "object") {
		return { provides: [], consumes: [], depends_on: [] };
	}

	return {
		provides: parseContractList(doc.provides),
		consumes: parseContractList(doc.consumes),
		depends_on: parseContractList(doc.depends_on),
	};
}

function parseContractList(raw: unknown): ManifestContract[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter(
			(item): item is Record<string, unknown> =>
				item !== null && typeof item === "object" && typeof item.type === "string",
		)
		.map((item) => ({
			type: item.type as string,
			path: typeof item.path === "string" ? item.path : undefined,
			package: typeof item.package === "string" ? item.package : undefined,
		}));
}

/**
 * Write manifest contracts to api_contracts in meta.db.
 * All writes idempotent (upsert by provider+consumer+type).
 */
export async function writeManifestContracts(
	db: SiaDb,
	providerRepoId: string,
	consumerRepoId: string,
	manifest: SiaManifest,
): Promise<void> {
	const now = Date.now();

	for (const contract of manifest.provides) {
		await upsertContract(db, {
			providerRepoId,
			consumerRepoId,
			type: contract.type,
			specPath: contract.path ?? null,
			trustTier: 1,
			now,
		});
	}

	for (const contract of manifest.depends_on) {
		await upsertContract(db, {
			providerRepoId: consumerRepoId,
			consumerRepoId: providerRepoId,
			type: contract.type,
			specPath: contract.path ?? null,
			trustTier: 1,
			now,
		});
	}

	for (const contract of manifest.consumes) {
		await upsertContract(db, {
			providerRepoId: consumerRepoId,
			consumerRepoId: providerRepoId,
			type: contract.type,
			specPath: contract.path ?? contract.package ?? null,
			trustTier: 1,
			now,
		});
	}
}

async function upsertContract(
	db: SiaDb,
	opts: {
		providerRepoId: string;
		consumerRepoId: string;
		type: string;
		specPath: string | null;
		trustTier: number;
		now: number;
	},
): Promise<void> {
	const existing = await db.execute(
		`SELECT id FROM api_contracts
     WHERE provider_repo_id = ? AND consumer_repo_id = ? AND contract_type = ?`,
		[opts.providerRepoId, opts.consumerRepoId, opts.type],
	);

	if (existing.rows.length > 0) {
		await db.execute("UPDATE api_contracts SET detected_at = ?, spec_path = ? WHERE id = ?", [
			opts.now,
			opts.specPath,
			existing.rows[0]?.id as string,
		]);
		return;
	}

	await db.execute(
		`INSERT INTO api_contracts (id, provider_repo_id, consumer_repo_id, contract_type, spec_path, trust_tier, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			randomUUID(),
			opts.providerRepoId,
			opts.consumerRepoId,
			opts.type,
			opts.specPath,
			opts.trustTier,
			opts.now,
		],
	);
}
