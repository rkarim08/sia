use serde::Deserialize;

#[derive(Deserialize, Debug)]
struct AstNode {
    name: String,
    kind: String,
    parent: String,
}

pub fn diff(
    old_bytes: &[u8],
    new_bytes: &[u8],
    node_id_map: &[String],
) -> Result<crate::AstDiffResult, Box<dyn std::error::Error>> {
    let old_nodes: Vec<AstNode> = serde_json::from_slice(old_bytes)?;
    let new_nodes: Vec<AstNode> = serde_json::from_slice(new_bytes)?;

    let mut inserts = Vec::new();
    let mut removes = Vec::new();
    let mut updates = Vec::new();
    let mut moves = Vec::new();

    // Build lookup by name for old tree
    let old_by_name: std::collections::HashMap<&str, &AstNode> =
        old_nodes.iter().map(|n| (n.name.as_str(), n)).collect();
    let new_by_name: std::collections::HashMap<&str, &AstNode> =
        new_nodes.iter().map(|n| (n.name.as_str(), n)).collect();

    // Detect removes and updates/moves
    for (i, old) in old_nodes.iter().enumerate() {
        let node_id = node_id_map.get(i).cloned().unwrap_or_default();
        match new_by_name.get(old.name.as_str()) {
            None => {
                removes.push(crate::AstDiffRemove { node_id });
            }
            Some(new) => {
                if old.kind != new.kind {
                    updates.push(crate::AstDiffUpdate {
                        node_id,
                        old_name: old.name.clone(),
                        new_name: new.name.clone(),
                    });
                } else if old.parent != new.parent {
                    moves.push(crate::AstDiffMove {
                        node_id,
                        old_parent: old.parent.clone(),
                        new_parent: new.parent.clone(),
                    });
                }
            }
        }
    }

    // Detect inserts (in new but not in old)
    for (i, new_node) in new_nodes.iter().enumerate() {
        if !old_by_name.contains_key(new_node.name.as_str()) {
            let node_id = if i + old_nodes.len() < node_id_map.len() {
                node_id_map[i + old_nodes.len()].clone()
            } else {
                format!("new-{}", i)
            };
            inserts.push(crate::AstDiffInsert {
                node_id,
                kind: new_node.kind.clone(),
                name: new_node.name.clone(),
            });
        }
    }

    Ok(crate::AstDiffResult {
        inserts,
        removes,
        updates,
        moves,
    })
}
