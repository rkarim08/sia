import { useState, useCallback } from 'react';
import type { GraphCombo } from '../lib/api';
import { searchNodes } from '../lib/api';
import type { SearchResult } from '../lib/api';
import { NODE_COLORS, BG_SIDEBAR, FILTERABLE_TYPES } from '../lib/constants';
import type { SiaNodeType } from '../lib/constants';

interface Props {
  combos: GraphCombo[];
  hiddenTypes: Set<string>;
  onToggleType: (type: string) => void;
  onSearchSelect: (nodeId: string) => void;
  focusDepth: number | null;
  onFocusDepthChange: (depth: number | null) => void;
}

const DEPTH_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 1, label: '1-hop' },
  { value: 2, label: '2-hop' },
  { value: 3, label: '3-hop' },
  { value: 5, label: '5-hops' },
];

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  color: '#6b7a99',
  marginBottom: 8,
  letterSpacing: '0.08em',
  fontWeight: 600,
};

export default function Sidebar({
  combos,
  hiddenTypes,
  onToggleType,
  onSearchSelect,
  focusDepth,
  onFocusDepthChange,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchNodes(searchQuery);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  }, [searchQuery]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  const topLevelCombos = combos.filter(c => !c.parentId);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: BG_SIDEBAR,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      color: '#c8d0e0',
    }}>
      {/* Search */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ position: 'relative' }}>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="#6b7a99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes..."
            style={{
              width: '100%',
              padding: '6px 10px 6px 28px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 5,
              color: '#e0e0e0',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        {searching && (
          <div style={{ fontSize: 11, color: '#6b7a99', marginTop: 6 }}>Searching...</div>
        )}
        {searchResults.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}>
            {searchResults.map(r => (
              <div
                key={r.id}
                onClick={() => onSearchSelect(r.id)}
                style={{
                  padding: '5px 6px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  color: '#c8d0e0',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: NODE_COLORS[r.type as SiaNodeType] || '#555',
                  flexShrink: 0,
                }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#4d5a73', flexShrink: 0 }}>
                  {r.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Node Types */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={sectionHeaderStyle}>Node Types</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {FILTERABLE_TYPES.map(type => {
            const active = !hiddenTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => onToggleType(type)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  cursor: 'pointer',
                  fontSize: 12,
                  background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  color: active ? '#c8d0e0' : '#4d5a73',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  if (active) e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                  else e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = active ? 'rgba(255,255,255,0.04)' : 'transparent';
                }}
              >
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: NODE_COLORS[type],
                  opacity: active ? 1 : 0.35,
                  flexShrink: 0,
                  transition: 'opacity 0.15s',
                }} />
                <span style={{ flex: 1 }}>{type}</span>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: active ? '#60a5fa' : 'rgba(255,255,255,0.1)',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Focus Depth */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={sectionHeaderStyle}>Focus Depth</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {DEPTH_OPTIONS.map(({ value, label }) => {
            const active = focusDepth === value;
            return (
              <button
                key={label}
                onClick={() => onFocusDepthChange(value)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 500,
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: active ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                  color: active ? '#fff' : '#8896b0',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={e => {
                  if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Explorer (File Tree) */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '10px 12px',
      }}>
        <div style={sectionHeaderStyle}>Explorer</div>
        {topLevelCombos.length === 0 && (
          <div style={{ fontSize: 12, color: '#4d5a73' }}>No folders loaded</div>
        )}
        {topLevelCombos.map(combo => (
          <FolderItem key={combo.id} combo={combo} combos={combos} depth={0} />
        ))}
      </div>

      {/* Legend */}
      <div style={{
        padding: '10px 12px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: 11,
        color: '#4d5a73',
      }}>
        <div style={{ ...sectionHeaderStyle, marginBottom: 4 }}>Legend</div>
        <div>Hover: highlight neighbors</div>
        <div>Click node: inspect details</div>
        <div>Scroll: zoom | Drag: pan</div>
      </div>
    </div>
  );
}

function FolderItem({ combo, combos, depth }: { combo: GraphCombo; combos: GraphCombo[]; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const children = combos.filter(c => c.parentId === combo.id);
  const hasChildren = children.length > 0;

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '3px 0',
          paddingLeft: depth * 14,
          cursor: 'pointer',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          borderRadius: 3,
          color: '#c8d0e0',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{
          color: '#6b7a99',
          width: 14,
          fontSize: 9,
          textAlign: 'center',
          flexShrink: 0,
          transition: 'transform 0.15s',
          display: 'inline-block',
          transform: hasChildren && expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>
          {hasChildren ? '\u25B6' : ''}
        </span>
        <span style={{ color: combo.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {combo.label}
        </span>
        {combo.childCount > 0 && (
          <span style={{ color: '#3d4a63', fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
            {combo.childCount}
          </span>
        )}
      </div>
      {expanded && children.map(child => (
        <FolderItem key={child.id} combo={child} combos={combos} depth={depth + 1} />
      ))}
    </div>
  );
}
