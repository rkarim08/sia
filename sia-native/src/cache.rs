use petgraph::graph::{DiGraph, NodeIndex};
use siphasher::sip::SipHasher13;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

/// Cached petgraph structure. Reused across multiple graphCompute calls
/// within the same process. Invalidated when the edge list hash changes.
pub struct GraphCache {
    graph: DiGraph<(), f32>,
    node_map: HashMap<String, NodeIndex>,
    reverse_map: Vec<String>,
    edge_hash: u64,
}

static CACHE: Mutex<Option<GraphCache>> = Mutex::new(None);

impl GraphCache {
    pub fn get_or_build(
        edges: &[i32],
        node_ids: &[String],
    ) -> Result<std::sync::MutexGuard<'static, Option<GraphCache>>, String> {
        let hash = Self::hash_edges(edges);
        let mut guard = CACHE.lock().map_err(|e| e.to_string())?;

        if let Some(ref cache) = *guard {
            if cache.edge_hash == hash {
                return Ok(guard);
            }
        }

        // Rebuild cache
        let mut graph = DiGraph::new();
        let mut node_map = HashMap::new();
        let mut reverse_map = Vec::new();

        for (i, id) in node_ids.iter().enumerate() {
            let idx = graph.add_node(());
            node_map.insert(id.clone(), idx);
            reverse_map.push(id.clone());
            let _ = i; // idx is sequential
        }

        // edges: flat [from, to, weight, ...]
        for chunk in edges.chunks(3) {
            if chunk.len() < 3 {
                break;
            }
            let from = chunk[0] as usize;
            let to = chunk[1] as usize;
            let weight = chunk[2] as f32;

            if from < node_ids.len() && to < node_ids.len() {
                if let (Some(&from_idx), Some(&to_idx)) = (
                    node_map.get(&node_ids[from]),
                    node_map.get(&node_ids[to]),
                ) {
                    graph.add_edge(from_idx, to_idx, weight);
                }
            }
        }

        *guard = Some(GraphCache {
            graph,
            node_map,
            reverse_map,
            edge_hash: hash,
        });

        Ok(guard)
    }

    fn hash_edges(edges: &[i32]) -> u64 {
        let mut hasher = SipHasher13::new();
        for &e in edges {
            e.hash(&mut hasher);
        }
        hasher.finish()
    }

    pub fn graph(&self) -> &DiGraph<(), f32> {
        &self.graph
    }
    pub fn node_map(&self) -> &HashMap<String, NodeIndex> {
        &self.node_map
    }
    pub fn reverse_map(&self) -> &[String] {
        &self.reverse_map
    }
}
