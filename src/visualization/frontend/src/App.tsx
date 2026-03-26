import { useState, useEffect, useCallback } from 'react';
import GraphCanvas from './components/GraphCanvas';
import CodeInspector from './components/CodeInspector';
import Sidebar from './components/Sidebar';
import { fetchGraph } from './lib/api';
import type { GraphResponse, GraphNode } from './lib/api';
import { BG_PRIMARY } from './lib/constants';

export default function App() {
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [focusDepth, setFocusDepth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGraph()
      .then(data => {
        if (!cancelled) {
          setGraphData(data);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleStageClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleToggleType = useCallback((type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleSearchSelect = useCallback((_nodeId: string) => {
    // TODO: zoom to node in graph
  }, []);

  const handleEntityClick = useCallback((_entityId: string) => {
    // TODO: navigate to entity in graph
  }, []);

  const showInspector = selectedNode !== null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: showInspector ? '240px 1fr 380px' : '240px 1fr 0px',
      gridTemplateRows: '100vh',
      height: '100vh',
      background: BG_PRIMARY,
      transition: 'grid-template-columns 0.2s ease',
    }}>
      {/* Left sidebar */}
      <Sidebar
        combos={graphData?.combos ?? []}
        hiddenTypes={hiddenTypes}
        onToggleType={handleToggleType}
        onSearchSelect={handleSearchSelect}
        focusDepth={focusDepth}
        onFocusDepthChange={setFocusDepth}
      />

      {/* Center: graph canvas */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {loading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            fontSize: 16,
            zIndex: 10,
          }}>
            Loading graph...
          </div>
        )}
        {error && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ef5350',
            fontSize: 14,
            zIndex: 10,
            padding: 32,
            textAlign: 'center',
          }}>
            {error}
          </div>
        )}
        {graphData && (
          <GraphCanvas
            data={graphData}
            onNodeClick={handleNodeClick}
            onStageClick={handleStageClick}
            selectedNodeId={selectedNode?.id ?? null}
            hiddenTypes={hiddenTypes}
          />
        )}
      </div>

      {/* Right: code inspector */}
      <div style={{ overflow: 'hidden' }}>
        {selectedNode && (
          <CodeInspector
            node={selectedNode}
            onEntityClick={handleEntityClick}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
