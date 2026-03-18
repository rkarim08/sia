mod pagerank;
mod dijkstra;
mod centrality;
mod components;

use crate::{GraphAlgorithmConfig, GraphAlgorithmKind, GraphComputeResult};
use crate::cache::GraphCache;

pub fn compute(
    edges: &[i32],
    node_ids: &[String],
    algorithm: &GraphAlgorithmConfig,
) -> Result<GraphComputeResult, Box<dyn std::error::Error>> {
    let guard = GraphCache::get_or_build(edges, node_ids)?;
    let cache = guard.as_ref().ok_or("Failed to build graph cache")?;

    let scores = match algorithm.kind {
        GraphAlgorithmKind::Pagerank => {
            let damping = algorithm.damping.unwrap_or(0.85);
            let iterations = algorithm.iterations.unwrap_or(30);
            let seeds: Vec<&str> = algorithm
                .seed_nodes
                .as_ref()
                .map(|v| v.iter().map(|s| s.as_str()).collect())
                .unwrap_or_default();
            pagerank::compute(cache.graph(), cache.node_map(), &seeds, damping, iterations)
        }
        GraphAlgorithmKind::ShortestPath => {
            let source = algorithm.source.as_deref().unwrap_or("");
            dijkstra::compute(cache.graph(), cache.node_map(), source)
        }
        GraphAlgorithmKind::BetweennessCentrality => {
            centrality::compute(cache.graph(), cache.node_map())
        }
        GraphAlgorithmKind::ConnectedComponents => {
            components::compute(cache.graph(), cache.node_map())
        }
    };

    Ok(GraphComputeResult {
        scores,
        node_ids: cache.reverse_map().to_vec(),
    })
}
