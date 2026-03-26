import { useCallback, useEffect, useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { fetchFile, fetchEntities } from '../lib/api';
import type { GraphNode, GraphEdge } from '../lib/api';
import { NODE_COLORS, BG_PANEL } from '../lib/constants';
import type { SiaNodeType } from '../lib/constants';

interface Props {
  node: GraphNode;
  onEntityClick: (entityId: string) => void;
  onClose: () => void;
}

const STORAGE_KEY = 'sia.inspectorWidth';
const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 420;

/** Map file extension to Prism language identifier. */
function getSyntaxLanguage(filePath: string | undefined): string {
  if (!filePath) return 'text';
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript';
    case 'ts': case 'tsx': case 'mts': case 'cts': return 'typescript';
    case 'py': case 'pyw': return 'python';
    case 'rb': case 'rake': case 'gemspec': return 'ruby';
    case 'java': return 'java';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'c': case 'h': return 'c';
    case 'cpp': case 'cc': case 'cxx': case 'hpp': case 'hxx': return 'cpp';
    case 'cs': return 'csharp';
    case 'php': return 'php';
    case 'kt': case 'kts': return 'kotlin';
    case 'swift': return 'swift';
    case 'json': return 'json';
    case 'yaml': case 'yml': return 'yaml';
    case 'md': case 'mdx': return 'markdown';
    case 'html': case 'htm': return 'markup';
    case 'css': case 'scss': case 'sass': return 'css';
    case 'sh': case 'bash': case 'zsh': return 'bash';
    case 'sql': return 'sql';
    case 'xml': return 'xml';
    default: return 'text';
  }
}

/** Custom syntax highlighter theme based on vscDarkPlus. */
const codeTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...(vscDarkPlus as Record<string, React.CSSProperties>)['pre[class*="language-"]'],
    background: 'transparent',
    margin: 0,
    padding: '12px 0',
    fontSize: '12px',
    lineHeight: '1.55',
  },
  'code[class*="language-"]': {
    ...(vscDarkPlus as Record<string, React.CSSProperties>)['code[class*="language-"]'],
    background: 'transparent',
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  },
};

export default function CodeInspector({ node, onEntityClick, onClose }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [language, setLanguage] = useState('text');
  const [lineCount, setLineCount] = useState(0);
  const [entities, setEntities] = useState<GraphNode[]>([]);
  const [relatedEdges, setRelatedEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);

  // --- Resizable panel width ---
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? parseInt(saved, 10) : NaN;
      if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
      return Math.max(MIN_WIDTH, Math.min(parsed, MAX_WIDTH));
    } catch {
      return DEFAULT_WIDTH;
    }
  });

  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(panelWidth));
    } catch { /* ignore */ }
  }, [panelWidth]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startWidth: panelWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      // Dragging left edge: moving left increases width, moving right decreases it
      const delta = state.startX - ev.clientX;
      const next = Math.max(MIN_WIDTH, Math.min(state.startWidth + delta, MAX_WIDTH));
      setPanelWidth(next);
    };

    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  // --- Data fetching ---
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCode(null);
    setEntities([]);
    setRelatedEdges([]);

    const loadData = async () => {
      if (node.nodeType === 'file' && node.filePath) {
        try {
          const [fileData, entityData] = await Promise.all([
            fetchFile(node.filePath),
            fetchEntities(node.id),
          ]);
          if (cancelled) return;
          setCode(fileData.content);
          setLanguage(fileData.language || getSyntaxLanguage(node.filePath));
          setLineCount(fileData.lineCount);
          setEntities(entityData.nodes);
          setRelatedEdges(entityData.edges);
        } catch (err) {
          if (cancelled) return;
          setError(String(err));
        }
      } else {
        try {
          const entityData = await fetchEntities(node.id);
          if (cancelled) return;
          setEntities(entityData.nodes);
          setRelatedEdges(entityData.edges);
        } catch {
          // Entity lookup may fail for non-file nodes
        }
      }
      if (!cancelled) setLoading(false);
    };

    loadData();
    return () => { cancelled = true; };
  }, [node.id, node.nodeType, node.filePath]);

  const importEdges = relatedEdges.filter(e => e.edgeType === 'imports');
  const callEdges = relatedEdges.filter(e => e.edgeType === 'calls');
  const nodeColor = node.color || NODE_COLORS[node.nodeType] || '#888';

  return (
    <div style={{
      width: panelWidth,
      height: '100%',
      background: BG_PANEL,
      backdropFilter: 'blur(20px)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      borderLeft: '1px solid rgba(255,255,255,0.04)',
    }}>
      {/* Resize handle — left edge */}
      <div
        onMouseDown={startResize}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 5,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
          background: 'transparent',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.35)')}
        onMouseLeave={e => {
          if (!resizeRef.current) e.currentTarget.style.background = 'transparent';
        }}
      />

      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(22,33,62,0.9), rgba(26,26,46,0.9))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* Node type badge */}
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 4,
            background: nodeColor,
            color: '#0a0a10',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            flexShrink: 0,
          }}>
            {node.nodeType}
          </span>
          <span style={{
            fontWeight: 600,
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#e2e8f0',
          }}>
            {node.label}
          </span>
        </div>
        <button
          onClick={onClose}
          title="Close inspector"
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            fontSize: 16,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 4,
            flexShrink: 0,
            lineHeight: 1,
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = '#e2e8f0';
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = '#64748b';
            e.currentTarget.style.background = 'none';
          }}
        >
          ✕
        </button>
      </div>

      {/* File path & metadata bar */}
      <div style={{
        padding: '6px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        fontSize: 11,
        color: '#94a3b8',
        flexShrink: 0,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        {node.filePath && (
          <div style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#cbd5e1',
          }}>
            {node.filePath}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, color: '#64748b', fontSize: 10 }}>
          <span>Trust {node.trustTier}</span>
          <span>Importance {node.importance.toFixed(2)}</span>
          {lineCount > 0 && <span>{lineCount} lines</span>}
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ padding: 24, color: '#64748b', fontSize: 13, textAlign: 'center' }}>
            Loading...
          </div>
        )}
        {error && (
          <div style={{ padding: 16, color: '#ef5350', fontSize: 12 }}>{error}</div>
        )}

        {/* Source code viewer */}
        {code !== null && (
          <div style={{
            fontSize: 12,
            borderBottom: (entities.length > 0 || importEdges.length > 0 || callEdges.length > 0)
              ? '1px solid rgba(255,255,255,0.06)'
              : 'none',
          }}>
            <SyntaxHighlighter
              language={language}
              style={codeTheme as Record<string, React.CSSProperties>}
              showLineNumbers
              lineNumberStyle={{
                minWidth: '3em',
                paddingRight: '1em',
                color: '#3b4261',
                textAlign: 'right',
                userSelect: 'none',
              }}
              wrapLines
              customStyle={{
                margin: 0,
                padding: '8px 0',
                background: 'rgba(10,10,16,0.5)',
                fontSize: 12,
              }}
            >
              {code}
            </SyntaxHighlighter>
          </div>
        )}

        {/* Entities list */}
        {entities.length > 0 && (
          <div style={{ padding: '10px 14px' }}>
            <SectionHeader label="Entities" count={entities.length} />
            {entities.map(ent => {
              const entColor = NODE_COLORS[ent.nodeType as SiaNodeType] || '#888';
              const isHovered = hoveredEntity === ent.id;
              return (
                <div
                  key={ent.id}
                  onClick={() => onEntityClick(ent.id)}
                  onMouseEnter={() => setHoveredEntity(ent.id)}
                  onMouseLeave={() => setHoveredEntity(null)}
                  style={{
                    padding: '5px 8px',
                    cursor: 'pointer',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 1,
                    background: isHovered ? 'rgba(255,255,255,0.05)' : 'transparent',
                    transition: 'background 0.12s',
                  }}
                >
                  <span style={{
                    display: 'inline-block',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: entColor,
                    flexShrink: 0,
                    boxShadow: `0 0 4px ${entColor}40`,
                  }} />
                  <span style={{
                    fontSize: 12,
                    color: '#e2e8f0',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {ent.label}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: '#475569',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}>
                    {ent.nodeType}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Import references */}
        {importEdges.length > 0 && (
          <div style={{ padding: '10px 14px' }}>
            <SectionHeader label="Imports" count={importEdges.length} />
            {importEdges.map(edge => (
              <EdgeRow key={edge.id} edge={edge} entities={entities} onEntityClick={onEntityClick} />
            ))}
          </div>
        )}

        {/* Call references */}
        {callEdges.length > 0 && (
          <div style={{ padding: '10px 14px' }}>
            <SectionHeader label="Calls" count={callEdges.length} />
            {callEdges.map(edge => (
              <EdgeRow key={edge.id} edge={edge} entities={entities} onEntityClick={onEntityClick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Section header with label and count badge. */
function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    }}>
      <span style={{
        fontSize: 10,
        textTransform: 'uppercase',
        color: '#64748b',
        letterSpacing: '0.8px',
        fontWeight: 600,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 9,
        color: '#94a3b8',
        background: 'rgba(255,255,255,0.06)',
        padding: '1px 6px',
        borderRadius: 8,
        fontWeight: 600,
      }}>
        {count}
      </span>
    </div>
  );
}

/** Resolve a readable name from an edge target ID. */
function resolveTargetLabel(target: string, entities: GraphNode[]): string {
  if (target.startsWith('file:')) {
    return target.slice(5); // strip "file:" prefix
  }
  if (target.startsWith('entity:')) {
    const rawId = target.slice(7); // strip "entity:" prefix
    const match = entities.find(e => e.entityId === rawId || e.id === target);
    if (match) return match.label;
  }
  // Also try matching by full id against entities
  const exactMatch = entities.find(e => e.id === target);
  if (exactMatch) return exactMatch.label;
  return target;
}

/** Single edge row for imports/calls sections. */
function EdgeRow({ edge, entities, onEntityClick }: {
  edge: GraphEdge;
  entities: GraphNode[];
  onEntityClick: (entityId: string) => void;
}) {
  const displayLabel = edge.label || resolveTargetLabel(edge.target, entities);
  return (
    <div
      onClick={() => onEntityClick(edge.target)}
      style={{
        padding: '3px 8px',
        color: '#94a3b8',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 11,
        cursor: 'pointer',
        borderRadius: 4,
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {displayLabel}
    </div>
  );
}
