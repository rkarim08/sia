import { useState, useEffect, useCallback, useRef } from 'react';
import GraphCanvas from './components/GraphCanvas';
import type { GraphCanvasHandle } from './components/GraphCanvas';
import CodeInspector from './components/CodeInspector';
import Sidebar from './components/Sidebar';
import SearchOverlay from './components/SearchOverlay';
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
      <header style={{
        height: 44,
        flexShrink: 0,
        background: 'rgba(10,10,22,0.6)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 20,
      }}>
        {/* Branding */}
        <div style={{
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: '0.18em',
          background: 'linear-gradient(135deg, #818cf8, #6366f1, #a78bfa)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textTransform: 'uppercase',
        }}>
          Sia
        </div>

        {/* Stats */}
        <div style={{
          fontSize: 11,
          color: 'rgba(255,255,255,0.28)',
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 400,
          letterSpacing: '0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {nodeCount} nodes &middot; {edgeCount} edges
        </div>

        {/* Search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.35)',
            fontSize: 12,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.35)';
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Search</span>
          <kbd style={{
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: '"DM Sans", sans-serif',
          }}>
            &#8984;K
          </kbd>
        </button>
      </header>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: showInspector ? '220px 1fr auto' : '220px 1fr 0px',
        overflow: 'hidden',
        transition: 'grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <Sidebar
          combos={graphData?.combos ?? []}
          hiddenTypes={hiddenTypes}
          onToggleType={handleToggleType}
          onSearchSelect={handleSearchSelect}
          focusDepth={focusDepth}
          onFocusDepthChange={setFocusDepth}
        />

        <div style={{ position: 'relative', overflow: 'hidden' }}>
          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.2)',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.05em',
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
              color: '#ef4444',
              fontSize: 13,
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

        {/* Inspector with slide animation */}
        <div style={{
          overflow: 'hidden',
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          {selectedNode && (
            <CodeInspector
              node={selectedNode}
              onEntityClick={handleEntityClick}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </div>
      </div>

      {searchOpen && (
        <SearchOverlay
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
