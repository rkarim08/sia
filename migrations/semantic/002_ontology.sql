-- Migration: 002_ontology.sql
-- Ontology Constraint Layer
-- Adds the edge_constraints metadata table declaring all valid (source_type, edge_type, target_type) triples.
-- Application-layer middleware uses this table to validate edges before insertion.

CREATE TABLE IF NOT EXISTS edge_constraints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  edge_type   TEXT NOT NULL,
  target_type TEXT NOT NULL,
  description TEXT,
  cardinality TEXT DEFAULT 'many-to-many',
  required    INTEGER DEFAULT 0,
  UNIQUE(source_type, edge_type, target_type)
);

-- Seed the constraints table with all valid triples from the Sia v5 ontology.

-- Structural edges
INSERT OR IGNORE INTO edge_constraints (source_type, edge_type, target_type, description) VALUES
  ('FileNode',    'defines',       'CodeEntity',  'File defines a function/class/module'),
  ('CodeEntity',  'imports',       'CodeEntity',  'Symbol imports another symbol'),
  ('CodeEntity',  'calls',         'CodeEntity',  'Symbol calls another symbol'),
  ('CodeEntity',  'inherits_from', 'CodeEntity',  'Class inherits from parent'),
  ('PackageNode', 'contains',      'FileNode',    'Package contains file'),
  ('PackageNode', 'depends_on',    'PackageNode', 'Package depends on another package'),
  ('Community',   'contains',      'CodeEntity',  'Community contains symbol'),
  ('Community',   'contains',      'FileNode',    'Community contains file');

-- Semantic edges
INSERT OR IGNORE INTO edge_constraints (source_type, edge_type, target_type, description) VALUES
  ('Decision',    'pertains_to',  'CodeEntity',  'Decision concerns a code symbol'),
  ('Decision',    'pertains_to',  'FileNode',    'Decision concerns a file'),
  ('Decision',    'pertains_to',  'PackageNode', 'Decision concerns a package'),
  ('Convention',  'pertains_to',  'CodeEntity',  'Convention governs a code symbol'),
  ('Convention',  'pertains_to',  'FileNode',    'Convention governs a file'),
  ('Convention',  'pertains_to',  'PackageNode', 'Convention governs a package'),
  ('Bug',         'caused_by',    'CodeEntity',  'Bug caused by a code symbol'),
  ('Bug',         'caused_by',    'FileNode',    'Bug caused by code in a file'),
  ('Solution',    'solves',       'Bug',         'Solution resolves a bug'),
  ('Solution',    'pertains_to',  'CodeEntity',  'Solution modifies a code symbol'),
  ('Solution',    'pertains_to',  'FileNode',    'Solution modifies a file'),
  ('Concept',     'pertains_to',  'CodeEntity',  'Concept relates to a symbol'),
  ('Concept',     'pertains_to',  'FileNode',    'Concept relates to a file'),
  ('Concept',     'pertains_to',  'PackageNode', 'Concept relates to a package'),
  ('Concept',     'elaborates',   'Decision',    'Concept elaborates a decision'),
  ('Decision',    'elaborates',   'Convention',  'Decision elaborates a convention');

-- Supersession edges (same-type only — enforced at application layer)
INSERT OR IGNORE INTO edge_constraints (source_type, edge_type, target_type, description) VALUES
  ('Decision',    'supersedes',   'Decision',    'New decision supersedes old'),
  ('Convention',  'supersedes',   'Convention',  'New convention supersedes old'),
  ('Solution',    'supersedes',   'Solution',    'New solution supersedes old'),
  ('Concept',     'supersedes',   'Concept',     'New concept supersedes old');

-- Contradiction edges
INSERT OR IGNORE INTO edge_constraints (source_type, edge_type, target_type, description) VALUES
  ('Decision',    'contradicts',  'Decision',    'Two decisions contradict'),
  ('Convention',  'contradicts',  'Convention',  'Two conventions contradict');

-- Generic relationship edges (used by capture pipeline and consolidation)
INSERT OR IGNORE INTO edge_constraints (source_type, edge_type, target_type, description) VALUES
  ('Concept',     'relates_to',   'Concept',     'Concept relates to concept'),
  ('Concept',     'relates_to',   'CodeEntity',  'Concept relates to code'),
  ('Concept',     'relates_to',   'FileNode',    'Concept relates to file'),
  ('Decision',    'relates_to',   'Decision',    'Decision relates to decision'),
  ('Decision',    'relates_to',   'CodeEntity',  'Decision relates to code'),
  ('Convention',  'relates_to',   'Convention',  'Convention relates to convention'),
  ('Bug',         'relates_to',   'Bug',         'Bug relates to bug'),
  ('Bug',         'relates_to',   'CodeEntity',  'Bug relates to code'),
  ('Solution',    'relates_to',   'CodeEntity',  'Solution relates to code'),
  ('CodeEntity',  'relates_to',   'CodeEntity',  'Code symbol relates to another'),
  ('FileNode',    'relates_to',   'FileNode',    'File relates to file'),
  ('Dependency',  'relates_to',   'CodeEntity',  'Dependency relates to code');

-- Documentation edges (Phase 14 additions)
INSERT OR IGNORE INTO edge_constraints (source_type, edge_type, target_type, description) VALUES
  ('ContentChunk', 'child_of',     'FileNode',    'Chunk belongs to document'),
  ('FileNode',     'references',   'FileNode',    'Document links to another document'),
  ('ContentChunk', 'references',   'CodeEntity',  'Chunk mentions a code symbol'),
  ('ContentChunk', 'references',   'FileNode',    'Chunk mentions a file'),
  ('ContentChunk', 'references',   'Decision',    'Chunk references a decision'),
  ('ContentChunk', 'references',   'Convention',  'Chunk references a convention');

-- Community membership edges
INSERT OR IGNORE INTO edge_constraints (source_type, edge_type, target_type, description) VALUES
  ('CodeEntity',   'member_of',      'Community',     'Symbol belongs to community'),
  ('FileNode',     'member_of',      'Community',     'File belongs to community'),
  ('Community',    'summarized_by',  'ContentChunk',  'Community summarized by chunk');
