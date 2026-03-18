// Module: errors — Ontology-specific error types

export class OntologyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OntologyError";
	}
}
