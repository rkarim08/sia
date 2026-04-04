-- Migration 010: Code embedding column for dual-embedding support (Task 4.1)
-- Stores ONNX-generated code-specific embeddings (jina-code / nomic-code)
-- alongside the existing NL embedding column. Nullable: only populated for
-- entities that have been processed by a T1+ model tier.

ALTER TABLE graph_nodes ADD COLUMN embedding_code BLOB;
ALTER TABLE current_nodes ADD COLUMN embedding_code BLOB;
