use petgraph::graph::DiGraph;
use std::collections::HashMap;

/// Connected components via union-find
pub fn compute(
    graph: &DiGraph<(), f32>,
    _node_map: &HashMap<String, petgraph::graph::NodeIndex>,
) -> Vec<f64> {
    let n = graph.node_count();
    let mut parent: Vec<usize> = (0..n).collect();
    let mut rank = vec![0usize; n];

    fn find(parent: &mut [usize], i: usize) -> usize {
        if parent[i] != i {
            parent[i] = find(parent, parent[i]);
        }
        parent[i]
    }

    fn union(parent: &mut [usize], rank: &mut [usize], a: usize, b: usize) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra == rb {
            return;
        }
        if rank[ra] < rank[rb] {
            parent[ra] = rb;
        } else if rank[ra] > rank[rb] {
            parent[rb] = ra;
        } else {
            parent[rb] = ra;
            rank[ra] += 1;
        }
    }

    for edge in graph.edge_indices() {
        if let Some((a, b)) = graph.edge_endpoints(edge) {
            union(&mut parent, &mut rank, a.index(), b.index());
        }
    }

    // Return component IDs as f64
    (0..n).map(|i| find(&mut parent, i) as f64).collect()
}
