import { useState, useEffect, useCallback, useRef } from 'react';
import GraphCanvas from './components/GraphCanvas';
import type { GraphCanvasHandle } from './components/GraphCanvas';
import CodeInspector from './components/CodeInspector';
import Sidebar from './components/Sidebar';
import SearchOverlay from './components/SearchOverlay';
import { fetchGraph } from './lib/api';
import type { GraphResponse, GraphNode } from './lib/api';
import { BG_PRIMARY, BG_SIDEBAR } from './lib/constants';

export default function App() {
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [focusDepth, setFocusDepth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const graphRef = useRef<GraphCanvasHandle>(null);

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

  // Cmd+K / Ctrl+K to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  const handleSearchSelect = useCallback((nodeId: string) => {
    graphRef.current?.focusNode(nodeId);
  }, []);

  const handleEntityClick = useCallback((entityId: string) => {
    graphRef.current?.focusNode(entityId);
  }, []);

  const showInspector = selectedNode !== null;
  const nodeCount = graphData?.nodes.length ?? 0;
  const edgeCount = graphData?.edges.length ?? 0;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: BG_PRIMARY,
    }}>
      {/* Header bar */}
      <div style={{
        height: 48,
        flexShrink: 0,
        background: BG_SIDEBAR,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        color: '#e4e4ed',
      }}>
        {/* Left: branding */}
        <div style={{
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#e4e4ed',
        }}>
          SIA
        </div>

        {/* Center: stats */}
        <div style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.45)',
          fontFamily: '"JetBrains Mono", monospace',
        }}>
          {nodeCount} nodes &middot; {edgeCount} edges
        </div>

        {/* Right: search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            color: '#6b7a99',
            fontSize: 12,
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
          }}
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Search</span>
          <kbd style={{
            fontSize: 10,
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#6b7a99',
          }}>
            &#8984;K
          </kbd>
        </button>
      </div>

      {/* Main content: 3-column layout */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: showInspector ? '240px 1fr auto' : '240px 1fr 0px',
        overflow: 'hidden',
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
              ref={graphRef}
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

      {/* Search overlay */}
      {searchOpen && (
        <SearchOverlay
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
