import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './App.css';

import { useOsStore } from './store';
import { GraphPanel } from './components/GraphPanel';
const GlobePanel = lazy(() => import('./components/GlobePanel').then(m => ({ default: m.GlobePanel })));
import { ViewportPanel } from './components/ViewportPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { IngestDialog } from './components/IngestDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TilingLayout, LayoutMode, PaneConfig } from './components/TilingLayout';

type Theme = 'catppuccin-mocha' | 'catppuccin-latte' | 'dracula' | 'tokyo-night' | 'solarized-dark' | 'solarized-light' | 'nord' | 'gruvbox-dark' | 'github-light';
const THEMES: { id: Theme; label: string }[] = [
  { id: 'catppuccin-mocha', label: '🪻 Catppuccin Mocha' },
  { id: 'catppuccin-latte', label: '☕ Catppuccin Latte' },
  { id: 'dracula', label: '🧛 Dracula' },
  { id: 'tokyo-night', label: '🗼 Tokyo Night' },
  { id: 'solarized-dark', label: '🌘 Solarized Dark' },
  { id: 'solarized-light', label: '☀️ Solarized Light' },
  { id: 'nord', label: '❄️ Nord' },
  { id: 'gruvbox-dark', label: '📦 Gruvbox Dark' },
  { id: 'github-light', label: '🐙 GitHub Light' },
];

const ALL_PANES: PaneConfig[] = [
  { id: 'graph', label: 'Knowledge Graph', icon: '🕸', content: <ErrorBoundary label="Knowledge Graph"><GraphPanel /></ErrorBoundary> },
  { id: 'viewport', label: 'Properties / Preview', icon: '📐', content: <ErrorBoundary label="Properties"><ViewportPanel /></ErrorBoundary> },
  { id: 'terminal', label: 'Terminal', icon: '⬛', content: <ErrorBoundary label="Terminal"><TerminalPanel /></ErrorBoundary> },
  { id: 'globe', label: 'Globe', icon: '🌍', content: <ErrorBoundary label="Globe"><Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-hint)' }}>Loading globe…</div>}><GlobePanel /></Suspense></ErrorBoundary> },
];

export const KEYBINDS = {
  layoutMaster: (e: KeyboardEvent) => e.altKey && e.key === '1',
  layoutBstack: (e: KeyboardEvent) => e.altKey && e.key === '2',
  layoutMonocle: (e: KeyboardEvent) => e.altKey && e.key === '3',
  layoutGrid: (e: KeyboardEvent) => e.altKey && e.key === '4',
  focusNext: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'j',
  focusPrev: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'k',
  swapMaster: (e: KeyboardEvent) => e.altKey && e.key === 'Enter',
  closePane: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'q',
  toggleGraph: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'g',
  toggleViewport: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'v',
  toggleTerminal: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 't',
  toggleGlobe: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'm',
  ingestData: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'i',
};

export default function App() {
  const { fetchEntities, fetchSpatialTraits, fetchEdges, startListening } = useOsStore();
  const [ingestVisible, setIngestVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Theme & Window
  const [theme, setTheme] = useState<Theme>('github-light');
  const appWindow = useMemo(() => getCurrentWindow(), []);

  // UI State: Layout & Panes
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('master');
  const gap = 8;
  const [visiblePaneIds, setVisiblePaneIds] = useState<string[]>(['graph', 'viewport', 'terminal', 'globe']);
  const [focusedId, setFocusedId] = useState<string | null>('graph');

  // Derived state
  const visiblePanes = useMemo(
    () => ALL_PANES.filter(p => visiblePaneIds.includes(p.id)),
    [visiblePaneIds]
  );

  // Apply theme to <html data-theme="...">
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Bootstrap
  useEffect(() => {
    fetchEntities();
    fetchSpatialTraits();
    fetchEdges();
    useOsStore.getState().fetchBlobTraits();
    let cleanup: (() => void) | undefined;
    startListening().then((fn) => { cleanup = fn; });
    return () => { if (cleanup) cleanup(); };
  }, []);

  // Global Keybinds (DWM-style bindings)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (KEYBINDS.ingestData(e)) { e.preventDefault(); setIngestVisible(v => !v); }

    // Layouts
    if (KEYBINDS.layoutMaster(e)) { e.preventDefault(); setLayoutMode('master'); }
    if (KEYBINDS.layoutBstack(e)) { e.preventDefault(); setLayoutMode('bstack'); }
    if (KEYBINDS.layoutMonocle(e)) { e.preventDefault(); setLayoutMode('monocle'); }
    if (KEYBINDS.layoutGrid(e)) { e.preventDefault(); setLayoutMode('grid'); }

    // Focus navigation
    if (KEYBINDS.focusNext(e) || KEYBINDS.focusPrev(e)) {
      e.preventDefault();
      if (visiblePaneIds.length === 0) return;
      const curIdx = focusedId ? visiblePaneIds.indexOf(focusedId) : 0;
      let nextIdx = KEYBINDS.focusNext(e) ? curIdx + 1 : curIdx - 1;
      if (nextIdx >= visiblePaneIds.length) nextIdx = 0;
      if (nextIdx < 0) nextIdx = visiblePaneIds.length - 1;
      setFocusedId(visiblePaneIds[nextIdx]);
    }

    // Swap master
    if (KEYBINDS.swapMaster(e)) {
      e.preventDefault();
      if (focusedId && visiblePaneIds.length > 1) {
        // Swap currently focused pane with index 0
        setVisiblePaneIds(prev => {
          const next = [...prev];
          const currIdx = next.indexOf(focusedId);
          if (currIdx > 0) {
            const temp = next[0];
            next[0] = next[currIdx];
            next[currIdx] = temp;
          }
          return next;
        });
      }
    }

    // Pane Toggles
    const toggle = (id: string) => {
      setVisiblePaneIds(prev => {
        if (prev.includes(id)) return prev.filter(x => x !== id);
        return [...prev, id];
      });
      setFocusedId(id);
    };

    if (KEYBINDS.closePane(e) && focusedId) { e.preventDefault(); toggle(focusedId); }
    if (KEYBINDS.toggleGraph(e)) { e.preventDefault(); toggle('graph'); }
    if (KEYBINDS.toggleViewport(e)) { e.preventDefault(); toggle('viewport'); }
    if (KEYBINDS.toggleTerminal(e)) { e.preventDefault(); toggle('terminal'); }
    if (KEYBINDS.toggleGlobe(e)) { e.preventDefault(); toggle('globe'); }
  }, [focusedId, visiblePaneIds]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const togglePane = (id: string) => {
    setVisiblePaneIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div className="app-root" id="app-root" onClick={() => setMenuOpen(null)}>
      <div className="menubar" style={{ display: 'flex', alignItems: 'center', height: 28, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', fontSize: 13, userSelect: 'none', WebkitAppRegion: 'drag' } as any}>
        <div style={{ fontWeight: 600, color: 'var(--accent)', margin: '0 12px', WebkitAppRegion: 'drag' } as any}>⬡ Spatial-OS</div>

        <div style={{ display: 'flex', gap: 4, padding: '0 8px', WebkitAppRegion: 'no-drag' } as any}>
          {/* File Menu */}
          <div style={{ position: 'relative' }}>
            <div
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === 'file' ? null : 'file'); }}
              style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, background: menuOpen === 'file' ? 'var(--bg-panel)' : 'transparent', color: 'var(--text-primary)' }}
            >
              File
            </div>
            {menuOpen === 'file' && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                <div className="menu-action" onClick={() => { setIngestVisible(true); setMenuOpen(null); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Ingest Data...</span>
                  <span style={{ color: 'var(--text-hint)' }}>Ctrl+I</span>
                </div>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <div className="menu-action" onClick={() => window.close()} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3 }}>Exit</div>
              </div>
            )}
          </div>

          {/* View Menu */}
          <div style={{ position: 'relative' }}>
            <div
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === 'view' ? null : 'view'); }}
              style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, background: menuOpen === 'view' ? 'var(--bg-panel)' : 'transparent', color: 'var(--text-primary)' }}
            >
              View
            </div>
            {menuOpen === 'view' && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>

                {/* Theme selection */}
                <div style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-hint)' }}>Theme</div>
                {THEMES.map(t => (
                  <div key={t.id} className="menu-action" onClick={() => { setTheme(t.id); setMenuOpen(null); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t.label}</span>
                    <span style={{ color: 'var(--text-hint)' }}>{theme === t.id && '✓'}</span>
                  </div>
                ))}

                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

                {/* Layout selection */}
                <div style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-hint)' }}>Layout</div>
                <div className="menu-action" onClick={() => setLayoutMode('master')} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Master-Stack</span><span style={{ color: 'var(--text-hint)' }}>{layoutMode === 'master' ? '✓' : 'Alt+1'}</span>
                </div>
                <div className="menu-action" onClick={() => setLayoutMode('bstack')} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Centered-Stack</span><span style={{ color: 'var(--text-hint)' }}>{layoutMode === 'bstack' ? '✓' : 'Alt+2'}</span>
                </div>
                <div className="menu-action" onClick={() => setLayoutMode('monocle')} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Monocle</span><span style={{ color: 'var(--text-hint)' }}>{layoutMode === 'monocle' ? '✓' : 'Alt+3'}</span>
                </div>
                <div className="menu-action" onClick={() => setLayoutMode('grid')} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Grid</span><span style={{ color: 'var(--text-hint)' }}>{layoutMode === 'grid' ? '✓' : 'Alt+4'}</span>
                </div>

                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

                {/* Visible Panes */}
                <div style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-hint)' }}>Panels</div>
                {ALL_PANES.map(p => (
                  <div key={p.id} className="menu-action" onClick={(e) => { e.stopPropagation(); togglePane(p.id); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{p.icon} {p.label}</span>
                    <span style={{ color: 'var(--accent)' }}>{visiblePaneIds.includes(p.id) && '✓'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Help Menu */}
          <div style={{ position: 'relative' }}>
            <div
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === 'help' ? null : 'help'); }}
              style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, background: menuOpen === 'help' ? 'var(--bg-panel)' : 'transparent', color: 'var(--text-primary)' }}
            >
              Help
            </div>
            {menuOpen === 'help' && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                <div className="menu-action" style={{ padding: '6px 12px', borderRadius: 3, color: 'var(--text-hint)' }}>About Spatial-OS (v0.1.0)</div>
              </div>
            )}
          </div>
        </div>

        {/* Window Controls */}
        <div style={{ display: 'flex', marginLeft: 'auto', WebkitAppRegion: 'no-drag' } as any}>
          <div
            className="window-control"
            onClick={() => appWindow.minimize()}
            style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}
          >
            &#x1F5D5;
          </div>
          <div
            className="window-control"
            onClick={() => appWindow.toggleMaximize()}
            style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}
          >
            &#x1F5D6;
          </div>
          <div
            className="window-control window-close"
            onClick={() => appWindow.close()}
            style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}
          >
            &#x2715;
          </div>
        </div>
      </div>

      <div className="layout-container" style={{ padding: gap }}>
        <TilingLayout
          panes={visiblePanes}
          mode={layoutMode}
          focusedId={focusedId}
          onFocus={setFocusedId}
          gap={gap}
        />
      </div>

      <IngestDialog
        visible={ingestVisible}
        onClose={() => setIngestVisible(false)}
      />
    </div>
  );
}
