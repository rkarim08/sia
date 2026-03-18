use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use std::collections::{HashMap, VecDeque};

/// Brandes algorithm for betweenness centrality
pub fn compute(graph: &DiGraph<(), f32>, _node_map: &HashMap<String, NodeIndex>) -> Vec<f64> {
    let n = graph.node_count();
    let mut centrality = vec![0.0f64; n];

    for s in graph.node_indices() {
        let mut stack = Vec::new();
        let mut predecessors: Vec<Vec<usize>> = vec![vec![]; n];
        let mut sigma = vec![0.0f64; n];
        sigma[s.index()] = 1.0;
        let mut dist: Vec<i64> = vec![-1; n];
        dist[s.index()] = 0;

        let mut queue = VecDeque::new();
        queue.push_back(s.index());

        while let Some(v) = queue.pop_front() {
            stack.push(v);
            let v_idx = NodeIndex::new(v);
            for edge in graph.edges(v_idx) {
                let w = edge.target().index();
                if dist[w] < 0 {
                    dist[w] = dist[v] + 1;
                    queue.push_back(w);
                }
                if dist[w] == dist[v] + 1 {
                    sigma[w] += sigma[v];
                    predecessors[w].push(v);
                }
            }
        }

        let mut delta = vec![0.0f64; n];
        while let Some(w) = stack.pop() {
            for &v in &predecessors[w] {
                delta[v] += (sigma[v] / sigma[w]) * (1.0 + delta[w]);
            }
            if w != s.index() {
                centrality[w] += delta[w];
            }
        }
    }

    // Normalize
    let norm = if n > 2 {
        ((n - 1) * (n - 2)) as f64
    } else {
        1.0
    };
    for c in &mut centrality {
        *c /= norm;
    }

    centrality
}
