#![deny(clippy::all)]

use napi_derive::napi;

mod ast_diff;
mod cache;
mod graph;

/// Reports whether this is the native (not Wasm) module.
#[napi]
pub fn is_native() -> bool {
    true
}

/// Reports whether this is the Wasm module.
#[napi]
pub fn is_wasm() -> bool {
    false
}

// -- AST Diff --

#[napi(object)]
pub struct AstDiffResult {
    pub inserts: Vec<AstDiffInsert>,
    pub removes: Vec<AstDiffRemove>,
    pub updates: Vec<AstDiffUpdate>,
    pub moves: Vec<AstDiffMove>,
}

#[napi(object)]
pub struct AstDiffInsert {
    pub node_id: String,
    pub kind: String,
    pub name: String,
}

#[napi(object)]
pub struct AstDiffRemove {
    pub node_id: String,
}

#[napi(object)]
pub struct AstDiffUpdate {
    pub node_id: String,
    pub old_name: String,
    pub new_name: String,
}

#[napi(object)]
pub struct AstDiffMove {
    pub node_id: String,
    pub old_parent: String,
    pub new_parent: String,
}

/// Compare two serialized AST node lists and produce an edit script.
/// Each tree is a JSON array of {name, kind, parent} objects serialized as bytes.
/// nodeIdMap maps array indices to graph node IDs.
#[napi]
pub fn ast_diff(
    old_tree_bytes: napi::bindgen_prelude::Buffer,
    new_tree_bytes: napi::bindgen_prelude::Buffer,
    node_id_map: Vec<String>,
) -> napi::Result<AstDiffResult> {
    ast_diff::diff(&old_tree_bytes, &new_tree_bytes, &node_id_map)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

// -- Graph Compute --

#[napi(object)]
pub struct GraphComputeResult {
    pub scores: Vec<f64>,
    pub node_ids: Vec<String>,
}

#[napi(string_enum)]
pub enum GraphAlgorithmKind {
    Pagerank,
    ShortestPath,
    BetweennessCentrality,
    ConnectedComponents,
}

#[napi(object)]
pub struct GraphAlgorithmConfig {
    pub kind: GraphAlgorithmKind,
    pub damping: Option<f64>,
    pub iterations: Option<u32>,
    pub seed_nodes: Option<Vec<String>>,
    pub source: Option<String>,
}

/// Run a graph algorithm on the provided edge list.
/// edges: flat Int32Array of [from, to, weight, from, to, weight, ...]
/// node_ids: parallel array mapping node indices to string IDs
#[napi]
pub fn graph_compute(
    edges: napi::bindgen_prelude::Int32Array,
    node_ids: Vec<String>,
    algorithm: GraphAlgorithmConfig,
) -> napi::Result<GraphComputeResult> {
    graph::compute(&edges, &node_ids, &algorithm)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}
