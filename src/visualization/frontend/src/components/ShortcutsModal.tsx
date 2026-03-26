import { useEffect } from 'react';

interface Props { onClose: () => void; }

const SHORTCUTS = [
  { category: 'Navigation', items: [
    { keys: '← → ↑ ↓', desc: 'Navigate between connected nodes' },
    { keys: 'Tab / Shift+Tab', desc: 'Cycle through all nodes' },
    { keys: 'Enter', desc: 'Open inspector for selected node' },
    { keys: 'Escape', desc: 'Deselect / close panels' },
  ]},
  { category: 'Display', items: [
    { keys: 'F / T / R', desc: 'Force / Tree / Radial layout' },
    { keys: '1-5', desc: 'Set focus depth (hops)' },
  ]},
  { category: 'Actions', items: [
    { keys: '⌘K', desc: 'Search nodes' },
    { keys: 'Shift+Click', desc: 'Path finder between two nodes' },
    { keys: 'Right-click', desc: 'Context menu on node' },
    { keys: '?', desc: 'Toggle this shortcuts panel' },
  ]},
];

export default function ShortcutsModal({ onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '90vw',
          background: 'rgba(14,14,28,0.92)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          boxShadow: '0 32px 100px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
          padding: '24px 28px',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}>
          <h2 style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#e2e8f0',
            letterSpacing: '0.04em',
            margin: 0,
          }}>
            Keyboard Shortcuts
          </h2>
          <kbd style={{
            fontSize: 10,
            color: '#6b7a99',
            background: 'rgba(255,255,255,0.06)',
            padding: '2px 6px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            ESC
          </kbd>
        </div>

        {SHORTCUTS.map(section => (
          <div key={section.category} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 10,
              textTransform: 'uppercase',
              color: '#6b7a99',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 8,
            }}>
              {section.category}
            </div>
            {section.items.map(item => (
              <div
                key={item.keys}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '5px 0',
                  fontSize: 12,
                }}
              >
                <span style={{ color: '#94a3b8' }}>{item.desc}</span>
                <kbd style={{
                  fontSize: 11,
                  color: '#c8d0e0',
                  background: 'rgba(255,255,255,0.06)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.08)',
                  fontFamily: "'GeistMono', 'Geist Mono', monospace",
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  marginLeft: 12,
                }}>
                  {item.keys}
                </kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
