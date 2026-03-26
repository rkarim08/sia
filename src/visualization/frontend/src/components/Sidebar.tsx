import { useState, useCallback } from 'react';
import type { GraphCombo } from '../lib/api';
import { searchNodes } from '../lib/api';
import type { SearchResult } from '../lib/api';
import { NODE_COLORS, BG_SIDEBAR } from '../lib/constants';

const NODE_TYPES = ['file', 'function', 'class', 'interface', 'decision', 'bug', 'convention', 'solution'] as const;

interface Props {
  combos: GraphCombo[];
  hiddenTypes: Set<string>;
  onToggleType: (type: string) => void;
  onSearchSelect: (nodeId: string) => void;
}

export default function Sidebar({ combos, hiddenTypes, onToggleType, onSearchSelect }: Props) {
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

  // Build folder tree from combos
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
    }}>
      {/* Search */}
      <div style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search nodes..."
          style={{
            width: '100%',
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4,
            color: '#e0e0e0',
            fontSize: 12,
            outline: 'none',
          }}
        />
        {searching && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Searching...</div>}
        {searchResults.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
            {searchResults.map(r => (
              <div
                key={r.id}
                onClick={() => onSearchSelect(r.id)}
                style={{
                  padding: '4px 6px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: NODE_COLORS[r.type as keyof typeof NODE_COLORS] || '#888',
                  flexShrink: 0,
                }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Explorer */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '12px',
      }}>
        <div style={{
          fontSize: 11,
          textTransform: 'uppercase',
          color: '#888',
          marginBottom: 8,
          letterSpacing: '0.5px',
        }}>
          Explorer
        </div>
        {topLevelCombos.length === 0 && (
          <div style={{ fontSize: 12, color: '#666' }}>No folders loaded</div>
        )}
        {topLevelCombos.map(combo => (
          <FolderItem key={combo.id} combo={combo} combos={combos} depth={0} />
        ))}
      </div>

      {/* Filters */}
      <div style={{
        padding: '12px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{
          fontSize: 11,
          textTransform: 'uppercase',
          color: '#888',
          marginBottom: 8,
          letterSpacing: '0.5px',
        }}>
          Filters
        </div>
        {NODE_TYPES.map(type => (
          <label
            key={type}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '2px 0',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <input
              type="checkbox"
              checked={!hiddenTypes.has(type)}
              onChange={() => onToggleType(type)}
              style={{ accentColor: NODE_COLORS[type] }}
            />
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: NODE_COLORS[type],
              flexShrink: 0,
            }} />
            {type}
          </label>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        padding: '12px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        fontSize: 11,
        color: '#666',
      }}>
        <div style={{
          textTransform: 'uppercase',
          marginBottom: 4,
          letterSpacing: '0.5px',
        }}>
          Legend
        </div>
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

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '3px 0',
          paddingLeft: depth * 12,
          cursor: 'pointer',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ color: '#888', width: 12, fontSize: 10, textAlign: 'center' }}>
          {children.length > 0 ? (expanded ? '\u25BC' : '\u25B6') : '\u2022'}
        </span>
        <span style={{ color: combo.color }}>{combo.label}</span>
        <span style={{ color: '#555', fontSize: 10, marginLeft: 'auto' }}>{combo.childCount}</span>
      </div>
      {expanded && children.map(child => (
        <FolderItem key={child.id} combo={child} combos={combos} depth={depth + 1} />
      ))}
    </div>
  );
}
