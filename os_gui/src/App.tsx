import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './App.css';

import { SearchableDropdown } from './components/SearchableDropdown';
import { useOsStore } from './store';
import { GraphPanel } from './components/GraphPanel';
const GlobePanel = lazy(() => import('./components/GlobePanel').then(m => ({ default: m.GlobePanel })));
import { ViewportPanel } from './components/ViewportPanel';
import { TimelinePanel } from './components/TimelinePanel';
import { TerminalPanel } from './components/TerminalPanel';
import { IngestDialog } from './components/IngestDialog';
import { CreateEntityDialog } from './components/CreateEntityDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TilingLayout, LayoutMode, PaneConfig } from './components/TilingLayout';
import { DraggablePane } from './components/DraggablePane';
import { CommandPalette } from './components/CommandPalette';


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
  { id: 'globe', label: 'Globe', icon: '🌍', content: <ErrorBoundary label="Globe"><Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-hint)' }}>Loading globe…</div>}><GlobePanel /></Suspense></ErrorBoundary> },
  { id: 'timeline', label: 'Timeline', icon: '🕒', content: <ErrorBoundary label="Timeline"><TimelinePanel /></ErrorBoundary> },
  { id: 'terminal', label: 'Terminal', icon: '⬛', content: <ErrorBoundary label="Terminal"><TerminalPanel /></ErrorBoundary> },
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
  toggleTimeline: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'l',
  ingestData: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'i',
  createEntity: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'n',

  multiSelectModifier: (e: any) => e.shiftKey || e.ctrlKey,
  marqueeModifier: (e: any) => e.shiftKey,
};

export default function App() {
  const { fetchEntities, fetchSpatialTraits, fetchEdges, startListening } = useOsStore();
  const [ingestVisible, setIngestVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Theme & Window
  const [theme, setTheme] = useState<Theme>('tokyo-night');
  const [themeSearch, setThemeSearch] = useState('Tokyo Night');
  const appWindow = useMemo(() => getCurrentWindow(), []);

  // UI State: Layout & Panes
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('master');
  const gap = 8;
  const [tiledPaneIds, setTiledPaneIds] = useState<string[]>(['graph', 'viewport', 'globe', 'timeline']);
  const [floatingPaneIds, setFloatingPaneIds] = useState<string[]>([]);
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>('graph');

  // Derived state
  const tiledPanes = useMemo(
    () => ALL_PANES.filter(p => tiledPaneIds.includes(p.id)),
    [tiledPaneIds]
  );

  const floatingPanes = useMemo(
    () => ALL_PANES.filter(p => floatingPaneIds.includes(p.id)),
    [floatingPaneIds]
  );

  const visiblePaneIds = useMemo(() => [...tiledPaneIds, ...floatingPaneIds], [tiledPaneIds, floatingPaneIds]);

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
    useOsStore.getState().fetchTemporalTraits();
    let cleanup: (() => void) | undefined;
    startListening().then((fn) => { cleanup = fn; });
    return () => { if (cleanup) cleanup(); };
  }, []);

  const togglePane = useCallback((id: string) => {
    if (tiledPaneIds.includes(id)) {
      setTiledPaneIds(prev => prev.filter(x => x !== id));
    } else if (floatingPaneIds.includes(id)) {
      setFloatingPaneIds(prev => prev.filter(x => x !== id));
    } else {
      setTiledPaneIds(prev => [...prev, id]);
      setFocusedId(id);
    }
  }, [tiledPaneIds, floatingPaneIds]);

  const handleDetach = useCallback((id: string) => {
    setTiledPaneIds(prev => prev.filter(x => x !== id));
    setFloatingPaneIds(prev => [...prev, id]);
    setFocusedId(id);
  }, []);

  const handleAttach = useCallback((id: string) => {
    setFloatingPaneIds(prev => prev.filter(x => x !== id));
    setTiledPaneIds(prev => [...prev, id]);
    setFocusedId(id);
  }, []);

  // Global Keybinds (DWM-style bindings)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (KEYBINDS.ingestData(e)) { e.preventDefault(); setIngestVisible(v => !v); }
    if (KEYBINDS.createEntity(e)) { e.preventDefault(); setCreateVisible(v => !v); }


    // Layouts
    if (KEYBINDS.layoutMaster(e)) { e.preventDefault(); setLayoutMode('master'); }
    if (KEYBINDS.layoutBstack(e)) { e.preventDefault(); setLayoutMode('bstack'); }
    if (KEYBINDS.layoutMonocle(e)) { e.preventDefault(); setLayoutMode('monocle'); }
    if (KEYBINDS.layoutGrid(e)) { e.preventDefault(); setLayoutMode('grid'); }

    // Focus navigation
    if (KEYBINDS.focusNext(e) || KEYBINDS.focusPrev(e)) {
      e.preventDefault();
      if (tiledPaneIds.length === 0) return;
      const curIdx = focusedId ? tiledPaneIds.indexOf(focusedId) : 0;
      let nextIdx = KEYBINDS.focusNext(e) ? curIdx + 1 : curIdx - 1;
      if (nextIdx >= tiledPaneIds.length) nextIdx = 0;
      if (nextIdx < 0) nextIdx = tiledPaneIds.length - 1;
      setFocusedId(tiledPaneIds[nextIdx]);
    }

    // Swap master
    if (KEYBINDS.swapMaster(e)) {
      e.preventDefault();
      if (focusedId && tiledPaneIds.length > 1 && tiledPaneIds.includes(focusedId)) {
        // Swap currently focused pane with index 0
        setTiledPaneIds(prev => {
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

    if (KEYBINDS.closePane(e) && focusedId) { e.preventDefault(); togglePane(focusedId); }
    if (KEYBINDS.toggleGraph(e)) { e.preventDefault(); togglePane('graph'); }
    if (KEYBINDS.toggleViewport(e)) { e.preventDefault(); togglePane('viewport'); }
    if (KEYBINDS.toggleTerminal(e)) { e.preventDefault(); setCommandPaletteVisible(v => !v); }
    if (KEYBINDS.toggleGlobe(e)) { e.preventDefault(); togglePane('globe'); }
    if (KEYBINDS.toggleTimeline(e)) { e.preventDefault(); togglePane('timeline'); }
  }, [focusedId, tiledPaneIds, togglePane]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-focus terminal on session switch
  const activePtySession = useOsStore(s => s.activePtySession);
  useEffect(() => {
    if (activePtySession !== 'main' && activePtySession !== null) {
      setTiledPaneIds(prev => {
        // If it's not in tiled, and not in floating, add to tiled
        if (!prev.includes('terminal') && !floatingPaneIds.includes('terminal')) {
          return [...prev, 'terminal'];
        }
        return prev;
      });
      setTimeout(() => setFocusedId('terminal'), 50);
    }
  }, [activePtySession, floatingPaneIds]);

  return (
    <div className="app-root" id="app-root" onClick={() => setMenuOpen(null)}>

      {/* Floating Plane */}
      {floatingPanes.map(p => (
        <DraggablePane
          key={`float-${p.id}`}
          config={p}
          isFocused={p.id === focusedId}
          onClick={() => setFocusedId(p.id)}
          onAttach={handleAttach}
        />
      ))}

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
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                <div className="menu-action" onClick={() => { setIngestVisible(true); setMenuOpen(null); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Ingest Data...</span>
                  <span style={{ color: 'var(--text-hint)' }}>Alt+I</span>
                </div>
                <div className="menu-action" onClick={() => { setCreateVisible(true); setMenuOpen(null); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>New Entity...</span>
                  <span style={{ color: 'var(--text-hint)' }}>Ctrl+N</span>
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
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>

                <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-hint)', flexShrink: 0 }}>Theme:</span>
                  <SearchableDropdown
                    value={themeSearch}
                    onChange={setThemeSearch}
                    onSelect={(opt) => {
                      setTheme(opt.id as Theme);
                      setThemeSearch(opt.label);
                    }}
                    options={THEMES.map(t => ({ id: t.id, label: t.label }))}
                    placeholder="Search themes..."
                    style={{ flex: 1 }}
                  />
                </div>

                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

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

                <div style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-hint)' }}>Panels</div>
                <div className="menu-action" onClick={(e) => { e.stopPropagation(); setCommandPaletteVisible(v => !v); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <span>⬛ Command Palette</span>
                  <span style={{ color: 'var(--accent)' }}>{commandPaletteVisible ? '✓' : 'Alt+T'}</span>
                </div>
                {ALL_PANES.map(p => (
                  <div key={p.id} className="menu-action" onClick={(e) => { e.stopPropagation(); togglePane(p.id); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{p.icon} {p.label} {floatingPaneIds.includes(p.id) ? '(Float)' : ''}</span>
                    <span style={{ color: 'var(--accent)' }}>{visiblePaneIds.includes(p.id) ? '✓' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <div
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === 'help' ? null : 'help'); }}
              style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, background: menuOpen === 'help' ? 'var(--bg-panel)' : 'transparent', color: 'var(--text-primary)' }}
            >
              Help
            </div>
            {menuOpen === 'help' && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                <div className="menu-action" style={{ padding: '6px 12px', borderRadius: 3, color: 'var(--text-hint)' }}>About Spatial-OS (v0.1.0)</div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', marginLeft: 'auto', WebkitAppRegion: 'no-drag' } as any}>
          <div className="window-control" onClick={() => appWindow.minimize()} style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>
            &#x1F5D5;
          </div>
          <div className="window-control" onClick={() => appWindow.toggleMaximize()} style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>
            &#x1F5D6;
          </div>
          <div className="window-control window-close" onClick={() => appWindow.close()} style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>
            &#x2715;
          </div>
        </div>
      </div>

      <div className="layout-container" style={{ padding: gap }}>
        <TilingLayout
          panes={tiledPanes}
          mode={layoutMode}
          focusedId={focusedId}
          onFocus={setFocusedId}
          onDetach={handleDetach}
          gap={gap}
        />
      </div>

      <CommandPalette visible={commandPaletteVisible} onClose={() => setCommandPaletteVisible(false)} />
      <IngestDialog visible={ingestVisible} onClose={() => setIngestVisible(false)} />
      {createVisible && <CreateEntityDialog onClose={() => setCreateVisible(false)} />}
    </div>
  );
}
