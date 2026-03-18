use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

#[derive(PartialEq)]
struct State {
    cost: f64,
    node: usize,
}

impl Eq for State {}
impl PartialOrd for State {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        other.cost.partial_cmp(&self.cost) // min-heap
    }
}
impl Ord for State {
    fn cmp(&self, other: &Self) -> Ordering {
        self.partial_cmp(other).unwrap_or(Ordering::Equal)
    }
}

pub fn compute(
    graph: &DiGraph<(), f32>,
    node_map: &HashMap<String, NodeIndex>,
    source: &str,
) -> Vec<f64> {
    let n = graph.node_count();
    let mut dist = vec![f64::INFINITY; n];

    let source_idx = match node_map.get(source) {
        Some(&idx) => idx,
        None => return dist,
    };

    dist[source_idx.index()] = 0.0;
    let mut heap = BinaryHeap::new();
    heap.push(State {
        cost: 0.0,
        node: source_idx.index(),
    });

    while let Some(State { cost, node }) = heap.pop() {
        if cost > dist[node] {
            continue;
        }

        let node_idx = NodeIndex::new(node);
        for edge in graph.edges(node_idx) {
            let weight = *edge.weight() as f64;
            let next = edge.target().index();
            let new_cost = cost + weight;

            if new_cost < dist[next] {
                dist[next] = new_cost;
                heap.push(State {
                    cost: new_cost,
                    node: next,
                });
            }
        }
    }

    dist
}
