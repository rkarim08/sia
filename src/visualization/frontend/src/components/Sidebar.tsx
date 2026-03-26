import { useState, useCallback } from 'react';
import type { GraphCombo, GraphNode } from '../lib/api';
import { searchNodes } from '../lib/api';
import type { SearchResult } from '../lib/api';
import { NODE_COLORS, BG_SIDEBAR, FILTERABLE_TYPES } from '../lib/constants';
import type { SiaNodeType } from '../lib/constants';

interface Props {
  combos: GraphCombo[];
  nodes: GraphNode[];
  hiddenTypes: Set<string>;
  onToggleType: (type: string) => void;
  onSearchSelect: (nodeId: string) => void;
  onFileClick?: (node: GraphNode) => void;
  focusDepth: number | null;
  onFocusDepthChange: (depth: number | null) => void;
  activeFolder: string | null;
  onFolderClick: (comboId: string | null) => void;
  blastRadiusMode: boolean;
  onToggleBlastRadius: () => void;
  colorByFolder: boolean;
  onToggleColorByFolder: () => void;
  showHulls: boolean;
  onToggleHulls: () => void;
  nodeColors: Record<SiaNodeType, string>;
  onColorChange: (type: SiaNodeType, color: string) => void;
}

const DEPTH_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 1, label: '1-hop' },
  { value: 2, label: '2-hop' },
  { value: 3, label: '3-hop' },
  { value: 5, label: '5-hops' },
];

export default function Sidebar({
  combos,
  nodes,
  hiddenTypes,
  onToggleType,
  onSearchSelect,
  onFileClick,
  focusDepth,
  onFocusDepthChange,
  activeFolder,
  onFolderClick,
  blastRadiusMode,
  onToggleBlastRadius,
  colorByFolder,
  onToggleColorByFolder,
  showHulls,
  onToggleHulls,
  nodeColors,
  onColorChange,
}: Props) {
  const isLarge = typeof window !== 'undefined' && window.innerWidth >= 2000;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const sectionHeader: React.CSSProperties = {
    fontSize: isLarge ? 13 : 10,
    textTransform: 'uppercase',
    color: '#6b7a99',
    marginBottom: isLarge ? 12 : 8,
    letterSpacing: '0.08em',
    fontWeight: 600,
  };

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
      backdropFilter: 'blur(20px)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderRight: '1px solid rgba(255,255,255,0.04)',
      color: '#b0bcd0',
    }}>
      {/* Search */}
      <div style={{ padding: isLarge ? '14px 16px' : '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
              fontSize: isLarge ? 15 : 12,
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
                  background: nodeColors[r.type as SiaNodeType] || '#555',
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
      <div style={{ padding: isLarge ? '14px 16px' : '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={sectionHeader}>Node Types</div>
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
                  padding: isLarge ? '6px 8px' : '4px 6px',
                  cursor: 'pointer',
                  fontSize: isLarge ? 14 : 12,
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
                {/* Clickable color swatch — opens native color picker */}
                <label
                  style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }}
                  onClick={e => e.stopPropagation()}
                >
                  <span style={{
                    display: 'block',
                    width: isLarge ? 14 : 10,
                    height: isLarge ? 14 : 10,
                    borderRadius: '50%',
                    background: nodeColors[type],
                    opacity: active ? 1 : 0.35,
                    transition: 'opacity 0.15s',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }} />
                  <input
                    type="color"
                    value={nodeColors[type]}
                    onChange={e => onColorChange(type, e.target.value)}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer',
                      border: 'none',
                      padding: 0,
                    }}
                    title={`Change ${type} color`}
                  />
                </label>
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

      {/* Graph Controls */}
      <div style={{ padding: isLarge ? '14px 16px' : '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={sectionHeader}>Display</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ToggleBtn
            label="Blast Radius"
            active={blastRadiusMode}
            onClick={onToggleBlastRadius}
            hint="Color by distance from selected node"
          />
          <ToggleBtn
            label="Color by Folder"
            active={colorByFolder}
            onClick={onToggleColorByFolder}
            hint="Color nodes by top-level folder"
          />
          <ToggleBtn
            label="Hulls"
            active={showHulls}
            onClick={onToggleHulls}
            hint="Show convex hull overlays for clusters"
          />
        </div>
      </div>

      {/* Focus Depth */}
      <div style={{ padding: isLarge ? '14px 16px' : '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={sectionHeader}>Focus Depth</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {DEPTH_OPTIONS.map(({ value, label }) => {
            const active = focusDepth === value;
            return (
              <button
                key={label}
                onClick={() => onFocusDepthChange(value)}
                style={{
                  padding: isLarge ? '6px 14px' : '4px 10px',
                  fontSize: isLarge ? 14 : 11,
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
        padding: isLarge ? '14px 16px' : '10px 12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={sectionHeader as React.CSSProperties}>Explorer</div>
          {activeFolder && (
            <button
              onClick={() => onFolderClick(null)}
              style={{
                fontSize: 10,
                padding: '2px 8px',
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 4,
                color: '#60a5fa',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Show All
            </button>
          )}
        </div>
        {topLevelCombos.length === 0 && (
          <div style={{ fontSize: 12, color: '#4d5a73' }}>No folders loaded</div>
        )}
        {topLevelCombos.map(combo => (
          <FolderItem
            key={combo.id}
            combo={combo}
            combos={combos}
            nodes={nodes}
            depth={0}
            activeFolder={activeFolder}
            onFolderClick={onFolderClick}
            onSearchSelect={onSearchSelect}
            onFileClick={onFileClick}
            nodeColors={nodeColors}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{
        padding: isLarge ? '14px 16px' : '10px 12px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: isLarge ? 13 : 11,
        color: '#4d5a73',
      }}>
        <div style={{ ...sectionHeader, marginBottom: 4 }}>Legend</div>
        <div>Hover: highlight neighbors</div>
        <div>Click node: inspect details</div>
        <div>Right-click: context menu</div>
        <div>Shift+click: path finder</div>
        <div>Scroll: zoom | Drag: pan</div>
      </div>
    </div>
  );
}

function ToggleBtn({ label, active, onClick, hint }: {
  label: string;
  active: boolean;
  onClick: () => void;
  hint: string;
}) {
  const isLarge = typeof window !== 'undefined' && window.innerWidth >= 2000;
  return (
    <button
      onClick={onClick}
      title={hint}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: isLarge ? '7px 10px' : '5px 8px',
        fontSize: isLarge ? 14 : 11,
        fontWeight: 500,
        border: active ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 5,
        cursor: 'pointer',
        background: active ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.04)',
        color: active ? '#60a5fa' : '#8896b0',
        textAlign: 'left',
        width: '100%',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
      }}
    >
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: active ? '#60a5fa' : 'rgba(255,255,255,0.15)',
        boxShadow: active ? '0 0 6px #60a5fa60' : 'none',
        flexShrink: 0,
        transition: 'all 0.15s',
      }} />
      {label}
    </button>
  );
}

function FolderItem({ combo, combos, nodes, depth, activeFolder, onFolderClick, onSearchSelect, onFileClick, nodeColors }: {
  combo: GraphCombo;
  combos: GraphCombo[];
  nodes: GraphNode[];
  depth: number;
  activeFolder: string | null;
  onFolderClick: (comboId: string | null) => void;
  onSearchSelect: (nodeId: string) => void;
  onFileClick?: (node: GraphNode) => void;
  nodeColors: Record<SiaNodeType, string>;
}) {
  const isLarge = typeof window !== 'undefined' && window.innerWidth >= 2000;
  const [expanded, setExpanded] = useState(depth < 1);
  const children = combos.filter(c => c.parentId === combo.id);
  const fileChildren = nodes.filter(n => n.parentId === combo.id);
  const hasChildren = children.length > 0 || fileChildren.length > 0;
  const isActive = activeFolder === combo.id;

  return (
    <div>
      <div
        onClick={(e) => {
          if (e.detail === 2) {
            // Double-click: filter graph to this folder
            onFolderClick(isActive ? null : combo.id);
          } else {
            // Single-click: expand/collapse in explorer
            setExpanded(!expanded);
          }
        }}
        style={{
          padding: '3px 0',
          paddingLeft: depth * 14,
          cursor: 'pointer',
          fontSize: isLarge ? 14 : 12,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          borderRadius: 3,
          color: '#c8d0e0',
          background: isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
          borderLeft: isActive ? '2px solid #60a5fa' : '2px solid transparent',
        }}
        onMouseEnter={e => {
          if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        }}
        onMouseLeave={e => {
          if (!isActive) e.currentTarget.style.background = 'transparent';
        }}
        onContextMenu={e => {
          e.preventDefault();
          onFolderClick(isActive ? null : combo.id);
        }}
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
        {isActive && (
          <span style={{
            fontSize: 8,
            color: '#60a5fa',
            marginLeft: 'auto',
            flexShrink: 0,
            fontWeight: 600,
          }}>
            FILTERED
          </span>
        )}
      </div>
      {expanded && (
        <>
          {children.map(child => (
            <FolderItem
              key={child.id}
              combo={child}
              combos={combos}
              nodes={nodes}
              depth={depth + 1}
              activeFolder={activeFolder}
              onFolderClick={onFolderClick}
              onSearchSelect={onSearchSelect}
              onFileClick={onFileClick}
              nodeColors={nodeColors}
            />
          ))}
          {fileChildren.map(fileNode => (
            <div
              key={fileNode.id}
              onClick={() => {
                onSearchSelect(fileNode.id);
                onFileClick?.(fileNode);
              }}
              style={{
                padding: '3px 0',
                paddingLeft: (depth + 1) * 14,
                cursor: 'pointer',
                fontSize: isLarge ? 14 : 12,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 3,
                color: '#a0aec0',
                borderLeft: '2px solid transparent',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: nodeColors[fileNode.nodeType as SiaNodeType] || '#555',
                flexShrink: 0,
              }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileNode.label}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
