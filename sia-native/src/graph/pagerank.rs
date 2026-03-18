use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use std::collections::HashMap;

pub fn compute(
    graph: &DiGraph<(), f32>,
    node_map: &HashMap<String, NodeIndex>,
    seed_nodes: &[&str],
    damping: f64,
    iterations: u32,
) -> Vec<f64> {
    let n = graph.node_count();
    if n == 0 {
        return vec![];
    }

    let mut scores = vec![1.0 / n as f64; n];

    // Personalized teleport vector
    let teleport = if seed_nodes.is_empty() {
        vec![1.0 / n as f64; n]
    } else {
        let mut t = vec![0.0; n];
        for seed in seed_nodes {
            if let Some(&idx) = node_map.get(*seed) {
                t[idx.index()] = 1.0 / seed_nodes.len() as f64;
            }
        }
        t
    };

    // Power iteration
    for _ in 0..iterations {
        let mut new_scores = vec![0.0; n];
        for i in 0..n {
            new_scores[i] = (1.0 - damping) * teleport[i];
        }

        for node_idx in graph.node_indices() {
            let out_degree = graph.edges(node_idx).count();
            if out_degree == 0 {
                continue;
            }

            let contribution = damping * scores[node_idx.index()] / out_degree as f64;
            for edge in graph.edges(node_idx) {
                let target = edge.target().index();
                new_scores[target] += contribution;
            }
        }

        scores = new_scores;
    }

    scores
}
