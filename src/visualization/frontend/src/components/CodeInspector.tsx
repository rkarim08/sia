import { useEffect, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { fetchFile, fetchEntities } from '../lib/api';
import type { GraphNode, GraphEdge } from '../lib/api';
import { NODE_COLORS, BG_SIDEBAR } from '../lib/constants';

interface Props {
  node: GraphNode;
  onEntityClick: (entityId: string) => void;
  onClose: () => void;
}

export default function CodeInspector({ node, onEntityClick, onClose }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [language, setLanguage] = useState('text');
  const [lineCount, setLineCount] = useState(0);
  const [entities, setEntities] = useState<GraphNode[]>([]);
  const [relatedEdges, setRelatedEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCode(null);
    setEntities([]);
    setRelatedEdges([]);

    const loadData = async () => {
      // If it's a file node, fetch source code and entities
      if (node.nodeType === 'file' && node.filePath) {
        try {
          const [fileData, entityData] = await Promise.all([
            fetchFile(node.filePath),
            fetchEntities(node.id),
          ]);
          if (cancelled) return;
          setCode(fileData.content);
          setLanguage(fileData.language);
          setLineCount(fileData.lineCount);
          setEntities(entityData.nodes);
          setRelatedEdges(entityData.edges);
        } catch (err) {
          if (cancelled) return;
          setError(String(err));
        }
      } else {
        // Non-file node: show metadata
        try {
          const entityData = await fetchEntities(node.id);
          if (cancelled) return;
          setEntities(entityData.nodes);
          setRelatedEdges(entityData.edges);
        } catch {
          // Entity lookup may fail for non-file nodes, that's OK
        }
      }
      if (!cancelled) setLoading(false);
    };

    loadData();
    return () => { cancelled = true; };
  }, [node.id, node.nodeType, node.filePath]);

  const importEdges = relatedEdges.filter(e => e.edgeType === 'imports');
  const callEdges = relatedEdges.filter(e => e.edgeType === 'calls');

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: BG_SIDEBAR,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: node.color || NODE_COLORS[node.nodeType] || '#888',
            flexShrink: 0,
          }} />
          <span style={{
            fontWeight: 600,
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {node.label}
          </span>
          <span style={{
            fontSize: 11,
            color: '#888',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}>
            {node.nodeType}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            fontSize: 18,
            cursor: 'pointer',
            padding: '2px 6px',
            flexShrink: 0,
          }}
        >
          x
        </button>
      </div>

      {/* Metadata */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: 12,
        color: '#aaa',
        flexShrink: 0,
      }}>
        {node.filePath && <div>Path: {node.filePath}</div>}
        <div>Trust tier: {node.trustTier} | Importance: {node.importance.toFixed(2)}</div>
        {lineCount > 0 && <div>Lines: {lineCount}</div>}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ padding: 16, color: '#888' }}>Loading...</div>
        )}
        {error && (
          <div style={{ padding: 16, color: '#ef5350' }}>{error}</div>
        )}

        {/* Source code */}
        {code !== null && (
          <div style={{ fontSize: 12 }}>
            <SyntaxHighlighter
              language={language}
              style={vscDarkPlus}
              showLineNumbers
              customStyle={{
                margin: 0,
                padding: '12px',
                background: 'transparent',
                fontSize: 12,
              }}
            >
              {code}
            </SyntaxHighlighter>
          </div>
        )}

        {/* Entities list */}
        {entities.length > 0 && (
          <div style={{ padding: '12px 16px' }}>
            <div style={{
              fontSize: 11,
              textTransform: 'uppercase',
              color: '#888',
              marginBottom: 8,
              letterSpacing: '0.5px',
            }}>
              Entities ({entities.length})
            </div>
            {entities.map(ent => (
              <div
                key={ent.id}
                onClick={() => onEntityClick(ent.id)}
                style={{
                  padding: '4px 8px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 2,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: NODE_COLORS[ent.nodeType] || '#888',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 12 }}>{ent.label}</span>
                <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>{ent.nodeType}</span>
              </div>
            ))}
          </div>
        )}

        {/* Import references */}
        {importEdges.length > 0 && (
          <div style={{ padding: '12px 16px' }}>
            <div style={{
              fontSize: 11,
              textTransform: 'uppercase',
              color: '#888',
              marginBottom: 8,
              letterSpacing: '0.5px',
            }}>
              Imports ({importEdges.length})
            </div>
            {importEdges.map(edge => (
              <div key={edge.id} style={{ fontSize: 12, padding: '2px 0', color: '#aaa' }}>
                {edge.target}
              </div>
            ))}
          </div>
        )}

        {/* Call references */}
        {callEdges.length > 0 && (
          <div style={{ padding: '12px 16px' }}>
            <div style={{
              fontSize: 11,
              textTransform: 'uppercase',
              color: '#888',
              marginBottom: 8,
              letterSpacing: '0.5px',
            }}>
              Calls ({callEdges.length})
            </div>
            {callEdges.map(edge => (
              <div key={edge.id} style={{ fontSize: 12, padding: '2px 0', color: '#aaa' }}>
                {edge.target}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
