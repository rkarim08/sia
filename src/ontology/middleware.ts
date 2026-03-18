// Module: middleware — Typed factory methods enforcing co-creation and cardinality constraints

import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import type { Entity } from "@/graph/entities";
import { insertEntity, invalidateEntity } from "@/graph/entities";
import { validateEdge } from "@/ontology/constraints";
import { OntologyError } from "@/ontology/errors";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a tags JSON string from an optional string array. */
function tagsJson(tags?: string[]): string {
	return JSON.stringify(tags ?? []);
}

// ---------------------------------------------------------------------------
// createBug
// ---------------------------------------------------------------------------

export interface CreateBugOpts {
	name: string;
	content: string;
	causedBy: string;
	tags?: string[];
	sessionId?: string;
}

/**
 * Create a Bug entity together with a required `caused_by` edge.
 *
 * Throws OntologyError if `causedBy` is not provided.
 */
export async function createBug(db: SiaDb, opts: CreateBugOpts): Promise<Entity> {
	if (!opts.causedBy) {
		throw new OntologyError("createBug requires a causedBy target entity id");
	}

	let created!: Entity;
	await db.transaction(async (tx) => {
		created = await insertEntity(tx, {
			type: "Bug",
			name: opts.name,
			content: opts.content,
			summary: opts.content.slice(0, 120),
			tags: tagsJson(opts.tags),
			source_episode: opts.sessionId ?? null,
		});

		const valid = await validateEdge(tx, "Bug", "caused_by", "CodeEntity");
		if (!valid) {
			// Fall back: still allow if the constraint exists for any target type
			const fallback = await validateEdge(tx, "Bug", "caused_by", "FileNode");
			if (!fallback) {
				throw new OntologyError("No edge_constraints entry for Bug→caused_by");
			}
		}

		await insertEdge(tx, {
			from_id: created.id,
			to_id: opts.causedBy,
			type: "caused_by",
			source_episode: opts.sessionId ?? null,
		});
	});

	return created;
}

// ---------------------------------------------------------------------------
// createConvention
// ---------------------------------------------------------------------------

export interface CreateConventionOpts {
	name: string;
	content: string;
	pertainsTo: string[];
	tags?: string[];
}

/**
 * Create a Convention entity together with one or more `pertains_to` edges.
 *
 * Throws OntologyError if `pertainsTo` is empty.
 */
export async function createConvention(db: SiaDb, opts: CreateConventionOpts): Promise<Entity> {
	if (!opts.pertainsTo || opts.pertainsTo.length === 0) {
		throw new OntologyError("createConvention requires at least one pertainsTo target");
	}

	let created!: Entity;
	await db.transaction(async (tx) => {
		created = await insertEntity(tx, {
			type: "Convention",
			name: opts.name,
			content: opts.content,
			summary: opts.content.slice(0, 120),
			tags: tagsJson(opts.tags),
		});

		for (const targetId of opts.pertainsTo) {
			await insertEdge(tx, {
				from_id: created.id,
				to_id: targetId,
				type: "pertains_to",
			});
		}
	});

	return created;
}

// ---------------------------------------------------------------------------
// createDecision
// ---------------------------------------------------------------------------

export interface CreateDecisionOpts {
	name: string;
	content: string;
	pertainsTo?: string[];
	supersedes?: string;
	tags?: string[];
}

/**
 * Create a Decision entity with optional `pertains_to` and `supersedes` edges.
 *
 * If `supersedes` is provided the old Decision is invalidated via
 * `invalidateEntity`.
 */
export async function createDecision(db: SiaDb, opts: CreateDecisionOpts): Promise<Entity> {
	let created!: Entity;
	await db.transaction(async (tx) => {
		created = await insertEntity(tx, {
			type: "Decision",
			name: opts.name,
			content: opts.content,
			summary: opts.content.slice(0, 120),
			tags: tagsJson(opts.tags),
		});

		if (opts.pertainsTo) {
			for (const targetId of opts.pertainsTo) {
				await insertEdge(tx, {
					from_id: created.id,
					to_id: targetId,
					type: "pertains_to",
				});
			}
		}

		if (opts.supersedes) {
			await insertEdge(tx, {
				from_id: created.id,
				to_id: opts.supersedes,
				type: "supersedes",
			});
			await invalidateEntity(tx, opts.supersedes);
		}
	});

	return created;
}

// ---------------------------------------------------------------------------
// createSolution
// ---------------------------------------------------------------------------

export interface CreateSolutionOpts {
	name: string;
	content: string;
	solves: string;
	pertainsTo?: string[];
	tags?: string[];
}

/**
 * Create a Solution entity together with a required `solves` edge and
 * optional `pertains_to` edges.
 *
 * Throws OntologyError if `solves` is not provided.
 */
export async function createSolution(db: SiaDb, opts: CreateSolutionOpts): Promise<Entity> {
	if (!opts.solves) {
		throw new OntologyError("createSolution requires a solves target entity id");
	}

	let created!: Entity;
	await db.transaction(async (tx) => {
		created = await insertEntity(tx, {
			type: "Solution",
			name: opts.name,
			content: opts.content,
			summary: opts.content.slice(0, 120),
			tags: tagsJson(opts.tags),
		});

		await insertEdge(tx, {
			from_id: created.id,
			to_id: opts.solves,
			type: "solves",
		});

		if (opts.pertainsTo) {
			for (const targetId of opts.pertainsTo) {
				await insertEdge(tx, {
					from_id: created.id,
					to_id: targetId,
					type: "pertains_to",
				});
			}
		}
	});

	return created;
}

// ---------------------------------------------------------------------------
// createConcept
// ---------------------------------------------------------------------------

export interface CreateConceptOpts {
	name: string;
	content: string;
	pertainsTo?: string[];
	elaborates?: string;
	tags?: string[];
}

/**
 * Create a Concept entity with optional `pertains_to` and `elaborates` edges.
 */
export async function createConcept(db: SiaDb, opts: CreateConceptOpts): Promise<Entity> {
	let created!: Entity;
	await db.transaction(async (tx) => {
		created = await insertEntity(tx, {
			type: "Concept",
			name: opts.name,
			content: opts.content,
			summary: opts.content.slice(0, 120),
			tags: tagsJson(opts.tags),
		});

		if (opts.pertainsTo) {
			for (const targetId of opts.pertainsTo) {
				await insertEdge(tx, {
					from_id: created.id,
					to_id: targetId,
					type: "pertains_to",
				});
			}
		}

		if (opts.elaborates) {
			await insertEdge(tx, {
				from_id: created.id,
				to_id: opts.elaborates,
				type: "elaborates",
			});
		}
	});

	return created;
}
