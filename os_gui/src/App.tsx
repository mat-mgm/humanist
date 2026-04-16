import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { DndProvider } from 'react-dnd';
import './App.css';

import { SearchableDropdown } from './components/SearchableDropdown';
import { useOsStore } from './store';
import { GraphPanel } from './components/GraphPanel';
const GlobePanel = lazy(() => import('./components/GlobePanel').then(m => ({ default: m.GlobePanel })));
import { EntityInspectorPanel } from './components/EntityInspector';
import { AssetPreview } from './components/AssetPreview';
import { EntityRegistry } from './components/EntityRegistry';
import { OntologyPanel } from './components/OntologyPanel';
import { TimelineView } from './components/TimelineView';
import { CalendarView } from './components/CalendarView';
import { TerminalPanel } from './components/TerminalPanel';
import { IngestDialog } from './components/IngestDialog';
import { CreateEntityDialog } from './components/CreateEntityDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TilingLayout, LayoutMode, PaneConfig, SlotNode } from './components/TilingLayout';
import { DraggablePane } from './components/DraggablePane';
import { CommandPalette } from './components/CommandPalette';

// ── Panel registry ────────────────────────────────────────────────────────────
const ALL_PANES: PaneConfig[] = [
  { id: 'graph',     label: 'Knowledge Graph',   icon: '🕸',  content: <ErrorBoundary label="Knowledge Graph"><GraphPanel /></ErrorBoundary> },
  { id: 'globe',     label: 'Globe',              icon: '🌍', content: <ErrorBoundary label="Globe"><Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-hint)' }}>Loading globe…</div>}><GlobePanel /></Suspense></ErrorBoundary> },
  { id: 'terminal',  label: 'Terminal',           icon: '⬛', content: <ErrorBoundary label="Terminal"><TerminalPanel /></ErrorBoundary> },
  { id: 'inspector', label: 'Properties',          icon: '📐', content: <ErrorBoundary label="Properties"><EntityInspectorPanel /></ErrorBoundary> },
  { id: 'preview',   label: 'Preview',            icon: '👁️', content: <ErrorBoundary label="Preview"><AssetPreview /></ErrorBoundary> },
  { id: 'registry',  label: 'Entities',           icon: '📋', content: <ErrorBoundary label="Entities"><EntityRegistry /></ErrorBoundary> },
  { id: 'ontology',  label: 'Relationships',      icon: '🔗', content: <ErrorBoundary label="Relationships"><OntologyPanel /></ErrorBoundary> },
  { id: 'timeline',  label: 'Timeline',           icon: '🕒', content: <ErrorBoundary label="Timeline"><TimelineView /></ErrorBoundary> },
  { id: 'calendar',  label: 'Calendar',           icon: '📅', content: <ErrorBoundary label="Calendar"><CalendarView /></ErrorBoundary> },
];

// ── Theme ─────────────────────────────────────────────────────────────────────
type Theme = 'catppuccin-mocha' | 'catppuccin-latte' | 'dracula' | 'tokyo-night' | 'solarized-dark' | 'solarized-light' | 'nord' | 'gruvbox-dark' | 'github-light';
const THEMES: { id: Theme; label: string }[] = [
  { id: 'catppuccin-mocha',  label: '🪻 Catppuccin Mocha' },
  { id: 'catppuccin-latte',  label: '☕ Catppuccin Latte' },
  { id: 'dracula',           label: '🧛 Dracula' },
  { id: 'tokyo-night',       label: '🗼 Tokyo Night' },
  { id: 'solarized-dark',    label: '🌘 Solarized Dark' },
  { id: 'solarized-light',   label: '☀️ Solarized Light' },
  { id: 'nord',              label: '❄️ Nord' },
  { id: 'gruvbox-dark',      label: '📦 Gruvbox Dark' },
  { id: 'github-light',      label: '🐙 GitHub Light' },
];

// ── Default layout ────────────────────────────────────────────────────────────
const DEFAULT_SLOTS: SlotNode[] = [
  { type: 'pane', id: 'graph' },
  { type: 'tabgroup', ids: ['inspector', 'registry', 'preview', 'ontology'], active: 'inspector' },
];

const STORAGE_KEY = 'spatial-os:layout';

function loadLayout(): { tiledSlots: SlotNode[]; floatingPaneIds: string[]; layoutMode: LayoutMode } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ── Keybinds ──────────────────────────────────────────────────────────────────
export const KEYBINDS = {
  layoutMaster: (e: KeyboardEvent) => e.altKey && e.key === '1',
  layoutBstack:  (e: KeyboardEvent) => e.altKey && e.key === '2',
  layoutMonocle: (e: KeyboardEvent) => e.altKey && e.key === '3',
  layoutGrid:    (e: KeyboardEvent) => e.altKey && e.key === '4',
  focusNext:     (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'j',
  focusPrev:     (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'k',
  swapMaster:    (e: KeyboardEvent) => e.altKey && e.key === 'Enter',
  closePane:     (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'q',
  toggleGraph:   (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'g',
  toggleInspector: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'v',
  toggleTerminal:  (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 't',
  toggleGlobe:   (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'm',
  toggleTimeline: (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'l',
  ingestData:    (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'i',
  createEntity:  (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'n',
  multiSelectModifier: (e: any) => e.shiftKey || e.ctrlKey,
  marqueeModifier:     (e: any) => e.shiftKey,
};

// ── Slot helpers ──────────────────────────────────────────────────────────────
function slotIds(s: SlotNode): string[] { return s.type === 'pane' ? [s.id] : s.ids; }

function removeIdFromSlots(slots: SlotNode[], id: string): SlotNode[] {
  const result: SlotNode[] = [];
  for (const s of slots) {
    if (s.type === 'pane') {
      if (s.id !== id) result.push(s);
    } else {
      const newIds = s.ids.filter(x => x !== id);
      if (newIds.length === 0) continue;
      if (newIds.length === 1) { result.push({ type: 'pane', id: newIds[0] }); continue; }
      result.push({ ...s, ids: newIds, active: s.active === id ? newIds[0] : s.active });
    }
  }
  return result;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { fetchSpatialTraits, startListening, activeLocale, setActiveLocale, fetchAllLabelTraits, fetchAllEntities } = useOsStore();
  const [ingestVisible, setIngestVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [menuOpen, setMenuOpen]           = useState<string | null>(null);

  const [theme, setTheme]           = useState<Theme>('tokyo-night');
  const [themeSearch, setThemeSearch] = useState('Tokyo Night');
  const appWindow = useMemo(() => getCurrentWindow(), []);

  // ── Layout state ─────────────────────────────────────────────────────────
  const saved = useMemo(() => loadLayout(), []);
  const [layoutMode, setLayoutMode]       = useState<LayoutMode>(saved?.layoutMode ?? 'master');
  const [tiledSlots, setTiledSlots]       = useState<SlotNode[]>(saved?.tiledSlots ?? DEFAULT_SLOTS);
  const [floatingPaneIds, setFloatingPaneIds] = useState<string[]>(saved?.floatingPaneIds ?? []);
  const [focusedSlotIdx, setFocusedSlotIdx]   = useState<number>(0);
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);

  const gap = 8;

  // Persist layout to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tiledSlots, floatingPaneIds, layoutMode })); }
    catch { /* storage full or unavailable */ }
  }, [tiledSlots, floatingPaneIds, layoutMode]);

  // Apply theme
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // Bootstrap
  useEffect(() => {
    fetchSpatialTraits();
    useOsStore.getState().fetchBlobTraits();
    useOsStore.getState().fetchTemporalTraits();
    fetchAllLabelTraits();
    fetchAllEntities();
    let cleanup: (() => void) | undefined;
    startListening().then(fn => { cleanup = fn; });
    return () => { if (cleanup) cleanup(); };
  }, []);

  // Derived: all pane IDs currently visible
  const visiblePaneIds = useMemo(() => {
    const tiled = tiledSlots.flatMap(slotIds);
    return [...tiled, ...floatingPaneIds];
  }, [tiledSlots, floatingPaneIds]);

  // Focused pane id (for display purposes)
  const focusedId = useMemo(() => {
    const slot = tiledSlots[focusedSlotIdx];
    if (!slot) return null;
    return slot.type === 'pane' ? slot.id : slot.active;
  }, [tiledSlots, focusedSlotIdx]);

  // Floating pane configs
  const floatingPanes = useMemo(() => ALL_PANES.filter(p => floatingPaneIds.includes(p.id)), [floatingPaneIds]);

  // ── Slot mutations ────────────────────────────────────────────────────────
  const togglePane = useCallback((id: string) => {
    const inTiled = tiledSlots.some(s => slotIds(s).includes(id));
    const inFloat = floatingPaneIds.includes(id);
    if (inTiled) {
      setTiledSlots(prev => removeIdFromSlots(prev, id));
    } else if (inFloat) {
      setFloatingPaneIds(prev => prev.filter(x => x !== id));
    } else {
      setTiledSlots(prev => { const next = [...prev, { type: 'pane' as const, id }]; setFocusedSlotIdx(next.length - 1); return next; });
    }
  }, [tiledSlots, floatingPaneIds]);

  const handleDetach = useCallback((id: string) => {
    setTiledSlots(prev => removeIdFromSlots(prev, id));
    setFloatingPaneIds(prev => [...prev, id]);
  }, []);

  const handleAttach = useCallback((id: string) => {
    setFloatingPaneIds(prev => prev.filter(x => x !== id));
    setTiledSlots(prev => { const next = [...prev, { type: 'pane' as const, id }]; setFocusedSlotIdx(next.length - 1); return next; });
  }, []);

  const handleMergeInto = useCallback((sourceId: string, targetSlotIdx: number) => {
    // Remove from floating first
    setFloatingPaneIds(fp => fp.filter(id => id !== sourceId));

    setTiledSlots(prev => {
      let next = [...prev];
      // Find & remove source from its current tiled slot
      const srcIdx = next.findIndex(s => slotIds(s).includes(sourceId));
      let tgtIdx = targetSlotIdx;
      if (srcIdx !== -1) {
        next = removeIdFromSlots(next, sourceId);
        if (srcIdx < targetSlotIdx) tgtIdx = targetSlotIdx - 1;
      }
      if (tgtIdx >= next.length) return next;
      const tgt = next[tgtIdx];
      if (tgt.type === 'pane') {
        next[tgtIdx] = { type: 'tabgroup', ids: [tgt.id, sourceId], active: sourceId };
      } else {
        if (!tgt.ids.includes(sourceId)) {
          next[tgtIdx] = { ...tgt, ids: [...tgt.ids, sourceId], active: sourceId };
        }
      }
      return next;
    });
  }, []);

  const handleCloseTab = useCallback((slotIdx: number, tabId: string) => {
    setTiledSlots(prev => {
      const next = [...prev];
      const slot = next[slotIdx];
      if (!slot || slot.type !== 'tabgroup') return prev;
      const newIds = slot.ids.filter(id => id !== tabId);
      if (newIds.length === 0) { next.splice(slotIdx, 1); }
      else if (newIds.length === 1) { next[slotIdx] = { type: 'pane', id: newIds[0] }; }
      else { next[slotIdx] = { ...slot, ids: newIds, active: slot.active === tabId ? newIds[0] : slot.active }; }
      return next;
    });
  }, []);

  const handleDetachTab = useCallback((slotIdx: number, tabId: string) => {
    handleCloseTab(slotIdx, tabId);
    setFloatingPaneIds(prev => [...prev, tabId]);
  }, [handleCloseTab]);

  const handleReorderTab = useCallback((slotIdx: number, draggedId: string, targetId: string) => {
    setTiledSlots(prev => {
      const next = [...prev];
      const slot = next[slotIdx];
      if (!slot || slot.type !== 'tabgroup') return prev;
      const ids = [...slot.ids];
      const from = ids.indexOf(draggedId);
      const to   = ids.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return prev;
      ids.splice(from, 1);
      ids.splice(to, 0, draggedId);
      next[slotIdx] = { ...slot, ids };
      return next;
    });
  }, []);

  const handleChangeActiveTab = useCallback((slotIdx: number, tabId: string) => {
    setTiledSlots(prev => {
      const next = [...prev];
      const slot = next[slotIdx];
      if (!slot || slot.type !== 'tabgroup') return prev;
      next[slotIdx] = { ...slot, active: tabId };
      return next;
    });
  }, []);

  // ── Keybinds ───────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (KEYBINDS.ingestData(e))  { e.preventDefault(); setIngestVisible(v => !v); }
    if (KEYBINDS.createEntity(e)) { e.preventDefault(); setCreateVisible(v => !v); }

    if (KEYBINDS.layoutMaster(e)) { e.preventDefault(); setLayoutMode('master'); }
    if (KEYBINDS.layoutBstack(e)) { e.preventDefault(); setLayoutMode('bstack'); }
    if (KEYBINDS.layoutMonocle(e)) { e.preventDefault(); setLayoutMode('monocle'); }
    if (KEYBINDS.layoutGrid(e))   { e.preventDefault(); setLayoutMode('grid'); }

    // Alt+j/k: cycle tabs within a focused tabgroup; at the boundary, move to the adjacent slot
    if (KEYBINDS.focusNext(e) || KEYBINDS.focusPrev(e)) {
      e.preventDefault();
      const isNext = KEYBINDS.focusNext(e);
      const slot = tiledSlots[focusedSlotIdx];
      if (slot?.type === 'tabgroup') {
        const cur = slot.ids.indexOf(slot.active);
        const atBoundary = isNext ? cur === slot.ids.length - 1 : cur === 0;
        if (!atBoundary) {
          handleChangeActiveTab(focusedSlotIdx, slot.ids[isNext ? cur + 1 : cur - 1]);
        } else if (tiledSlots.length > 1) {
          setFocusedSlotIdx(isNext
            ? (focusedSlotIdx + 1) % tiledSlots.length
            : (focusedSlotIdx - 1 + tiledSlots.length) % tiledSlots.length);
        }
      } else if (tiledSlots.length > 0) {
        setFocusedSlotIdx(isNext
          ? (focusedSlotIdx + 1) % tiledSlots.length
          : (focusedSlotIdx - 1 + tiledSlots.length) % tiledSlots.length);
      }
    }

    // Swap focused slot to master (index 0)
    if (KEYBINDS.swapMaster(e)) {
      e.preventDefault();
      if (focusedSlotIdx > 0 && tiledSlots.length > 1) {
        setTiledSlots(prev => {
          const next = [...prev];
          [next[0], next[focusedSlotIdx]] = [next[focusedSlotIdx], next[0]];
          return next;
        });
        setFocusedSlotIdx(0);
      }
    }

    if (KEYBINDS.closePane(e) && focusedId) {
      e.preventDefault();
      togglePane(focusedId);
    }

    if (KEYBINDS.toggleGraph(e))    { e.preventDefault(); togglePane('graph'); }
    if (KEYBINDS.toggleInspector(e)) { e.preventDefault(); togglePane('inspector'); }
    if (KEYBINDS.toggleTerminal(e))  { e.preventDefault(); setCommandPaletteVisible(v => !v); }
    if (KEYBINDS.toggleGlobe(e))    { e.preventDefault(); togglePane('globe'); }
    if (KEYBINDS.toggleTimeline(e)) { e.preventDefault(); togglePane('timeline'); }
  }, [focusedSlotIdx, focusedId, tiledSlots, togglePane, handleChangeActiveTab]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-focus terminal on session switch
  const activePtySession = useOsStore(s => s.activePtySession);
  useEffect(() => {
    if (activePtySession !== 'main' && activePtySession !== null) {
      const inTiled  = tiledSlots.some(s => slotIds(s).includes('terminal'));
      const inFloating = floatingPaneIds.includes('terminal');
      if (!inTiled && !inFloating) {
        setTiledSlots(prev => { const next = [...prev, { type: 'pane' as const, id: 'terminal' }]; setFocusedSlotIdx(next.length - 1); return next; });
      }
      setTimeout(() => {
        const idx = tiledSlots.findIndex(s => slotIds(s).includes('terminal'));
        if (idx !== -1) setFocusedSlotIdx(idx);
      }, 50);
    }
  }, [activePtySession]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="app-root" id="app-root" onClick={() => setMenuOpen(null)}>

        {/* Floating plane */}
        {floatingPanes.map(p => (
          <DraggablePane key={`float-${p.id}`} config={p}
            isFocused={false} onClick={() => {}} onAttach={handleAttach}
            tiledSlots={tiledSlots} allPanes={ALL_PANES} onMergeInto={handleMergeInto} />
        ))}

        {/* Menu bar */}
        <div className="menubar" style={{ display: 'flex', alignItems: 'center', height: 28, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', fontSize: 13, userSelect: 'none', WebkitAppRegion: 'drag' } as any}>
          <div style={{ fontWeight: 600, color: 'var(--accent)', margin: '0 12px', WebkitAppRegion: 'drag' } as any}>⬡ Spatial-OS</div>

          <div style={{ display: 'flex', gap: 4, padding: '0 8px', WebkitAppRegion: 'no-drag' } as any}>
            {/* File menu */}
            <div style={{ position: 'relative' }}>
              <div className="menu-item" onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === 'file' ? null : 'file'); }}
                style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, background: menuOpen === 'file' ? 'var(--bg-panel)' : 'transparent', color: 'var(--text-primary)' }}>
                File
              </div>
              {menuOpen === 'file' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                  <div className="menu-action" onClick={() => { setIngestVisible(true); setMenuOpen(null); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Ingest Data...</span><span style={{ color: 'var(--text-hint)' }}>Alt+I</span>
                  </div>
                  <div className="menu-action" onClick={() => { setCreateVisible(true); setMenuOpen(null); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                    <span>New Entity...</span><span style={{ color: 'var(--text-hint)' }}>Alt+N</span>
                  </div>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                  <div className="menu-action" onClick={() => window.close()} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3 }}>Exit</div>
                </div>
              )}
            </div>

            {/* View menu */}
            <div style={{ position: 'relative' }}>
              <div className="menu-item" onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === 'view' ? null : 'view'); }}
                style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, background: menuOpen === 'view' ? 'var(--bg-panel)' : 'transparent', color: 'var(--text-primary)' }}>
                View
              </div>
              {menuOpen === 'view' && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                  <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-hint)', flexShrink: 0 }}>Theme:</span>
                    <SearchableDropdown
                      value={themeSearch} onChange={setThemeSearch}
                      onSelect={opt => { setTheme(opt.id as Theme); setThemeSearch(opt.label); }}
                      options={THEMES.map(t => ({ id: t.id, label: t.label }))}
                      placeholder="Search themes…" style={{ flex: 1 }}
                    />
                  </div>
                  <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-hint)', flexShrink: 0 }}>Language:</span>
                    <select value={activeLocale} onChange={e => setActiveLocale(e.target.value)}
                      style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', fontSize: 11, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }}>
                      <option value="en">en — English</option>
                      <option value="de">de — Deutsch</option>
                      <option value="fr">fr — Français</option>
                      <option value="pt">pt — Português</option>
                      <option value="es">es — Español</option>
                      <option value="zh">zh — 中文</option>
                      <option value="ar">ar — العربية</option>
                    </select>
                  </div>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                  <div style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-hint)' }}>Layout</div>
                  {(['master','bstack','monocle','grid'] as LayoutMode[]).map((m, i) => (
                    <div key={m} className="menu-action" onClick={() => setLayoutMode(m)}
                      style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{{master:'Master-Stack',bstack:'Centered-Stack',monocle:'Monocle',grid:'Grid'}[m]}</span>
                      <span style={{ color: layoutMode === m ? 'var(--accent)' : 'var(--text-hint)' }}>{layoutMode === m ? '✓' : `Alt+${i+1}`}</span>
                    </div>
                  ))}
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                  <div style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-hint)' }}>Panels</div>
                  <div className="menu-action" onClick={e => { e.stopPropagation(); setCommandPaletteVisible(v => !v); }}
                    style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                    <span>⬛ Command Palette</span>
                    <span style={{ color: 'var(--accent)' }}>{commandPaletteVisible ? '✓' : 'Alt+T'}</span>
                  </div>
                  {ALL_PANES.map(p => (
                    <div key={p.id} className="menu-action" onClick={e => { e.stopPropagation(); togglePane(p.id); }}
                      style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{p.icon} {p.label} {floatingPaneIds.includes(p.id) ? '(Float)' : ''}</span>
                      <span style={{ color: 'var(--accent)' }}>{visiblePaneIds.includes(p.id) ? '✓' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ position: 'relative' }}>
              <div className="menu-item" onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === 'help' ? null : 'help'); }}
                style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, background: menuOpen === 'help' ? 'var(--bg-panel)' : 'transparent', color: 'var(--text-primary)' }}>
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
            <div className="window-control" onClick={() => appWindow.minimize()} style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>&#x1F5D5;</div>
            <div className="window-control" onClick={() => appWindow.toggleMaximize()} style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>&#x1F5D6;</div>
            <div className="window-control window-close" onClick={() => appWindow.close()} style={{ padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>&#x2715;</div>
          </div>
        </div>

        <div className="layout-container" style={{ padding: gap }}>
          <TilingLayout
            slots={tiledSlots}
            allPanes={ALL_PANES}
            mode={layoutMode}
            focusedSlotIdx={focusedSlotIdx}
            onFocusSlot={setFocusedSlotIdx}
            onDetach={handleDetach}
            onMergeInto={handleMergeInto}
            onCloseTab={handleCloseTab}
            onDetachTab={handleDetachTab}
            onChangeActiveTab={handleChangeActiveTab}
            onReorderTab={handleReorderTab}
            gap={gap}
          />
        </div>

        <CommandPalette visible={commandPaletteVisible} onClose={() => setCommandPaletteVisible(false)} />
        <IngestDialog visible={ingestVisible} onClose={() => setIngestVisible(false)} />
        {createVisible && <CreateEntityDialog onClose={() => setCreateVisible(false)} />}
      </div>
    </DndProvider>
  );
}
