import { useState, useEffect, useCallback, useRef } from 'react';
import GraphCanvas from './components/GraphCanvas';
import type { GraphCanvasHandle } from './components/GraphCanvas';
import CodeInspector from './components/CodeInspector';
import Sidebar from './components/Sidebar';
import SearchOverlay from './components/SearchOverlay';
import ShortcutsModal from './components/ShortcutsModal';
import { fetchGraph } from './lib/api';
import type { GraphResponse, GraphNode } from './lib/api';
import { BG_PRIMARY, loadNodeColors, saveNodeColors, setNodeColors } from './lib/constants';
import type { SiaNodeType } from './lib/constants';
import type { LayoutMode } from './types';

export default function App() {
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [focusDepth, setFocusDepth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Responsive breakpoint
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isMobile = windowWidth < 640;
  const isLarge = windowWidth >= 2000;

  // New feature state
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [blastRadiusMode, setBlastRadiusMode] = useState(false);
  const [colorByFolder, setColorByFolder] = useState(false);
  const [pathSource, setPathSource] = useState<string | null>(null);
  const [pathTarget, setPathTarget] = useState<string | null>(null);
  const [showHulls, setShowHulls] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [maxTrustTier, setMaxTrustTier] = useState(4);
  const [nodeColors, setNodeColorsState] = useState(() => loadNodeColors());

  const handleColorChange = useCallback((type: SiaNodeType, color: string) => {
    setNodeColorsState(prev => {
      const next = { ...prev, [type]: color };
      saveNodeColors(next);
      setNodeColors(next); // update the mutable ref used by graph-adapter
      return next;
    });
  }, []);

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
      if (e.key === '?' && !(e.target instanceof HTMLInputElement)) {
        setShortcutsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    // Path finder: shift+click sets path target
    // We handle this by checking if shift is held via a global flag
    if (shiftHeldRef.current && selectedNode) {
      setPathSource(selectedNode.id);
      setPathTarget(node.id);
      return;
    }
    setSelectedNode(node);
    if (window.innerWidth < 640) setSidebarOpen(false);
  }, [selectedNode]);

  // Track shift key for path finder
  const shiftHeldRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
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

  const handleFolderClick = useCallback((comboId: string | null) => {
    setActiveFolder(comboId);
  }, []);

  const handleToggleBlastRadius = useCallback(() => {
    setBlastRadiusMode(prev => !prev);
  }, []);

  const handleToggleColorByFolder = useCallback(() => {
    setColorByFolder(prev => !prev);
  }, []);

  const handleToggleHulls = useCallback(() => {
    setShowHulls(prev => !prev);
  }, []);

  const handleClearPath = useCallback(() => {
    setPathSource(null);
    setPathTarget(null);
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
        height: isLarge ? 56 : 44,
        flexShrink: 0,
        background: 'rgba(10,10,22,0.6)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isLarge ? '0 32px' : '0 20px',
        zIndex: 20,
        animation: 'fadeInDown 0.4s ease-out',
      }}>
        {/* Hamburger (mobile only) */}
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(prev => !prev)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '4px 8px',
              marginRight: 8,
              lineHeight: 1,
            }}
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
        )}

        {/* Branding */}
        <div style={{
          fontSize: isLarge ? 20 : 15,
          fontWeight: 700,
          letterSpacing: '0.18em',
          background: 'linear-gradient(135deg, #818cf8, #6366f1, #a78bfa)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textTransform: 'uppercase',
        }}>
          Sia
        </div>

        {/* Stats + active folder indicator */}
        <div style={{
          display: isMobile ? 'none' : 'flex',
          alignItems: 'center',
          gap: isLarge ? 18 : 12,
          fontSize: isLarge ? 14 : 11,
          color: 'rgba(255,255,255,0.28)',
          fontFamily: '"GeistMono", "Geist Mono", monospace',
          fontWeight: 400,
          letterSpacing: '0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {activeFolder && (
            <span style={{
              color: '#60a5fa',
              fontSize: 10,
              padding: '2px 8px',
              background: 'rgba(59,130,246,0.1)',
              borderRadius: 4,
              border: '1px solid rgba(59,130,246,0.2)',
            }}>
              Filtered
            </span>
          )}
          {blastRadiusMode && (
            <span style={{
              color: '#f97316',
              fontSize: 10,
              padding: '2px 8px',
              background: 'rgba(249,115,22,0.1)',
              borderRadius: 4,
              border: '1px solid rgba(249,115,22,0.2)',
            }}>
              Blast Radius
            </span>
          )}
          <span>{nodeCount} nodes &middot; {edgeCount} edges</span>
        </div>

        {/* Search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: isLarge ? '7px 16px' : '5px 12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.35)',
            fontSize: isLarge ? 15 : 12,
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
          <span style={{ display: isMobile ? 'none' : undefined }}>Search</span>
          <kbd style={{
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: "'Outfit', sans-serif",
            display: isMobile ? 'none' : undefined,
          }}>
            &#8984;K
          </kbd>
        </button>
      </header>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: isMobile
          ? '1fr'
          : isLarge
            ? showInspector ? '300px 1fr auto' : '300px 1fr 0px'
            : showInspector ? '220px 1fr auto' : '220px 1fr 0px',
        overflow: 'hidden',
        transition: 'grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <div style={{
          ...(isMobile ? {
            position: 'fixed',
            top: 44,
            left: 0,
            bottom: 0,
            width: 260,
            zIndex: 30,
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: sidebarOpen ? '4px 0 24px rgba(0,0,0,0.5)' : 'none',
          } : {
            animation: 'fadeInUp 0.5s ease-out 0.1s both',
            overflow: 'hidden',
          }),
        }}>
          <Sidebar
            combos={graphData?.combos ?? []}
            nodes={graphData?.nodes ?? []}
            hiddenTypes={hiddenTypes}
            onToggleType={handleToggleType}
            onSearchSelect={handleSearchSelect}
            onFileClick={handleNodeClick}
            focusDepth={focusDepth}
            onFocusDepthChange={setFocusDepth}
            activeFolder={activeFolder}
            onFolderClick={handleFolderClick}
            blastRadiusMode={blastRadiusMode}
            onToggleBlastRadius={handleToggleBlastRadius}
            colorByFolder={colorByFolder}
            onToggleColorByFolder={handleToggleColorByFolder}
            showHulls={showHulls}
            onToggleHulls={handleToggleHulls}
            nodeColors={nodeColors}
            onColorChange={handleColorChange}
          />
        </div>

        {isMobile && sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              top: 44,
              background: 'rgba(0,0,0,0.4)',
              zIndex: 29,
            }}
          />
        )}

        <div style={{ position: 'relative', overflow: 'hidden', animation: 'fadeIn 0.8s ease-out 0.2s both' }}>
          {loading && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              zIndex: 10, gap: 12,
            }}>
              <span style={{
                fontSize: 24, fontWeight: 700, letterSpacing: '0.2em',
                background: 'linear-gradient(135deg, #818cf8, #6366f1, #a78bfa)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                animation: 'pulse 2s ease-in-out infinite',
              }}>SIA</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
                Building graph...
              </span>
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
              activeFolder={activeFolder}
              blastRadiusMode={blastRadiusMode}
              colorByFolder={colorByFolder}
              pathSource={pathSource}
              pathTarget={pathTarget}
              onClearPath={handleClearPath}
              showHulls={showHulls}
              layoutMode={layoutMode}
              onLayoutModeChange={setLayoutMode}
              maxTrustTier={maxTrustTier}
              onMaxTrustTierChange={setMaxTrustTier}
              focusDepth={focusDepth}
            />
          )}
        </div>

        {/* Inspector with slide animation */}
        <div style={{
          ...(isMobile ? {
            position: 'fixed',
            top: 44,
            right: 0,
            bottom: 0,
            width: '100%',
            zIndex: 25,
            animation: 'fadeInUp 0.3s ease-out',
          } : {
            overflow: 'hidden',
            transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            animation: 'fadeInUp 0.4s ease-out 0.15s both',
          }),
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
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
