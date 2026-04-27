import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { DndProvider } from 'react-dnd';
import { Minus, Square, X, SplitSquareHorizontal, Search, Globe, Clock, Calendar, Terminal, Info, Database, PencilLine, Brain } from 'lucide-react';
import './App.css';

import { useOsStore } from './store';
import { ActivityBar } from './components/ActivityBar';
import { SidePanel } from './components/SidePanel';
import { GraphPanel } from './components/GraphPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { CausalPanel } from './components/CausalPanel';
import { EntityKnowledgePanel } from './components/EntityKnowledgePanel';
import { TimelineView } from './components/TimelineView';
import { CalendarView } from './components/CalendarView';

const GlobePanel = lazy(() => import('./components/GlobePanel').then(m => ({ default: m.GlobePanel })));
import { ErrorBoundary } from './components/ErrorBoundary';
import { TilingLayout, LayoutMode, PaneConfig, SlotNode } from './components/TilingLayout';
import { DraggablePane } from './components/DraggablePane';
import { CommandPalette } from './components/CommandPalette';
import { EntityInspectorPanel } from './components/EntityInspector';
import { InputsPanel } from './components/InputsPanel';
import { OutputsPanel } from './components/OutputsPanel';
import { EditionPanel } from './components/EditionPanel';
import { RulesPanel } from './components/RulesPanel';
import { syncBenchmark } from './benchmark/SyncBenchmark';

const GlobeFallback = <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-hint)' }}>Loading globe…</div>;

// ── Panel registry ────────────────────────────────────────────────────────────
const ALL_PANES: PaneConfig[] = [
  { id: 'graph',     label: 'Knowledge Graph',     icon: 'graph',     content: <ErrorBoundary label="Knowledge Graph"><GraphPanel /></ErrorBoundary> },
  { id: 'causal',    label: 'Causal Panel',         icon: 'causal',    content: <ErrorBoundary label="Causal Panel"><CausalPanel /></ErrorBoundary> },
  { id: 'globe',     label: 'Globe',                icon: 'globe',     content: <ErrorBoundary label="Globe"><Suspense fallback={GlobeFallback}><GlobePanel /></Suspense></ErrorBoundary> },
  { id: 'timeline',  label: 'Timeline',             icon: 'timeline',  content: <ErrorBoundary label="Timeline"><TimelineView /></ErrorBoundary> },
  { id: 'calendar',  label: 'Calendar',             icon: 'calendar',  content: <ErrorBoundary label="Calendar"><CalendarView /></ErrorBoundary> },
  { id: 'terminal',  label: 'Terminal',             icon: 'terminal',  content: <ErrorBoundary label="Terminal"><TerminalPanel /></ErrorBoundary> },
  { id: 'inspector', label: 'Properties',           icon: 'inspector', content: <ErrorBoundary label="Properties"><EntityInspectorPanel /></ErrorBoundary> },
  { id: 'registry',  label: 'Entities & Relations', icon: 'registry',  content: <ErrorBoundary label="Entities & Relations"><EntityKnowledgePanel /></ErrorBoundary> },
  { id: 'edition',   label: 'Edition',              icon: 'edition',   content: <ErrorBoundary label="Edition"><EditionPanel /></ErrorBoundary> },
  { id: 'rules',     label: 'Rules',                icon: 'rules',     content: <ErrorBoundary label="Rules"><RulesPanel /></ErrorBoundary> },
];

// Globe/Timeline/Calendar appear separately in the right panel picker even though
// the activity bar groups them as "Causal Panel".
const RIGHT_PANEL_PICKER = [
  { id: 'inspector', icon: <Info       size={13} />, title: 'Properties' },
  { id: 'registry',  icon: <Database   size={13} />, title: 'Entities & Relations' },
  { id: 'edition',   icon: <PencilLine size={13} />, title: 'Edition' },
  { id: 'rules',     icon: <Brain      size={13} />, title: 'Rules' },
  { id: 'graph',     icon: <Search     size={13} />, title: 'Knowledge Graph' },
  { id: 'globe',     icon: <Globe      size={13} />, title: 'Globe' },
  { id: 'timeline',  icon: <Clock      size={13} />, title: 'Timeline' },
  { id: 'calendar',  icon: <Calendar   size={13} />, title: 'Calendar' },
  { id: 'terminal',  icon: <Terminal   size={13} />, title: 'Terminal' },
];

// When causal is in the canvas, globe/timeline/calendar are already visible there
const CAUSAL_SUB_IDS = new Set(['globe', 'timeline', 'calendar']);
function rightPickerExcluded(primaryCanvasId: string): Set<string> {
  return primaryCanvasId === 'causal'
    ? CAUSAL_SUB_IDS
    : new Set([primaryCanvasId]);
}

// ── Theme ─────────────────────────────────────────────────────────────────────
type Theme = 'catppuccin-mocha' | 'catppuccin-latte' | 'dracula' | 'tokyo-night' | 'solarized-dark' | 'solarized-light' | 'nord' | 'gruvbox-dark' | 'github-light';

// Activity IDs in order for Ctrl+Tab cycling
const ACTIVITY_ORDER = ['inputs', 'edition', 'graph', 'causal', 'terminal', 'settings'];

// ── Default tiling layout ─────────────────────────────────────────────────────
const DEFAULT_SLOTS: SlotNode[] = [
  { type: 'pane', id: 'graph' },
  { type: 'tabgroup', ids: ['inspector', 'registry'], active: 'inspector' },
];

const STORAGE_KEY = 'humanist:layout';

const REMOVED_PANE_IDS = new Set(['preview']);

function loadLayout(): { tiledSlots: SlotNode[]; floatingPaneIds: string[]; layoutMode: LayoutMode } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Purge removed panes from saved layout
    if (parsed.tiledSlots) {
      parsed.tiledSlots = parsed.tiledSlots
        .map((s: SlotNode) => s.type === 'tabgroup'
          ? { ...s, ids: s.ids.filter((id: string) => !REMOVED_PANE_IDS.has(id)) }
          : s)
        .filter((s: SlotNode) => s.type !== 'tabgroup' || (s as any).ids.length > 0)
        .map((s: SlotNode) => s.type === 'tabgroup' && (s as any).ids.length === 1
          ? { type: 'pane', id: (s as any).ids[0] }
          : s)
        .filter((s: SlotNode) => s.type !== 'pane' || !REMOVED_PANE_IDS.has((s as any).id));
    }
    if (parsed.floatingPaneIds) {
      parsed.floatingPaneIds = parsed.floatingPaneIds.filter((id: string) => !REMOVED_PANE_IDS.has(id));
    }
    return parsed;
  } catch { return null; }
}

// Keybinds and other constants live in `./config.ts`. KEYBINDS is re-exported
// here for backward compatibility with components that still `import { KEYBINDS } from '../App'`.
export { KEYBINDS } from './config';
import { KEYBINDS } from './config';

// ── Slot helpers (tiling mode) ────────────────────────────────────────────────
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

// Primary-canvas activities — tool/settings clicks must not affect the canvas
const PRIMARY_CANVAS_IDS = new Set(['inputs', 'outputs', 'edition', 'graph', 'causal', 'terminal']);

// ── Primary canvas (activity bar mode) ───────────────────────────────────────
function PrimaryCanvas({ activityId }: { activityId: string }) {
  switch (activityId) {
    case 'inputs':   return <ErrorBoundary label="Inputs"><InputsPanel /></ErrorBoundary>;
    case 'outputs':  return <ErrorBoundary label="Outputs"><OutputsPanel /></ErrorBoundary>;
    case 'edition':  return <ErrorBoundary label="Edition"><EditionPanel /></ErrorBoundary>;
    case 'graph':    return <ErrorBoundary label="Knowledge Graph"><GraphPanel /></ErrorBoundary>;
    case 'causal':   return <ErrorBoundary label="Causal Panel"><CausalPanel /></ErrorBoundary>;
    case 'terminal': return <ErrorBoundary label="Terminal"><TerminalPanel /></ErrorBoundary>;
    default:         return <ErrorBoundary label="Knowledge Graph"><GraphPanel /></ErrorBoundary>;
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const fetchSpatialTraits = useOsStore(s => s.fetchSpatialTraits);
  const startListening = useOsStore(s => s.startListening);
  const fetchAllLabelTraits = useOsStore(s => s.fetchAllLabelTraits);
  const fetchAllEntities = useOsStore(s => s.fetchAllEntities);
  const fetchRelationshipTypes = useOsStore(s => s.fetchRelationshipTypes);
  const fetchStorageHealth = useOsStore(s => s.fetchStorageHealth);
  const ensureTerminalWorkbench = useOsStore(s => s.ensureTerminalWorkbench);
  const activeActivity    = useOsStore(s => s.activeActivity);
  const rightPanelId      = useOsStore(s => s.rightPanelId);
  const tilingModeEnabled = useOsStore(s => s.tilingModeEnabled);
  const setActiveActivity = useOsStore(s => s.setActiveActivity);
  const toggleSidePanel = useOsStore(s => s.toggleSidePanel);
  const setRightPanelId = useOsStore(s => s.setRightPanelId);
  const setSidePanelOpen = useOsStore(s => s.setSidePanelOpen);
  const setTilingModeEnabled = useOsStore(s => s.setTilingModeEnabled);

  // Track last primary-canvas activity so tool/settings clicks don't switch canvas
  const [primaryCanvasId, setPrimaryCanvasId] = useState('graph');
  useEffect(() => {
    if (PRIMARY_CANVAS_IDS.has(activeActivity)) setPrimaryCanvasId(activeActivity);
  }, [activeActivity]);

  const [theme, setTheme]           = useState<Theme>('tokyo-night');
  const appWindow = useMemo(() => getCurrentWindow(), []);

  // ── Side panel resize ─────────────────────────────────────────────────────
  const [sidePanelWidth, setSidePanelWidth] = useState(280);
  const sidePanelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onSidePanelResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    sidePanelResizeRef.current = { startX: e.clientX, startWidth: sidePanelWidth };
    const onMove = (ev: PointerEvent) => {
      if (!sidePanelResizeRef.current) return;
      const delta = ev.clientX - sidePanelResizeRef.current.startX;
      setSidePanelWidth(Math.max(160, Math.min(600, sidePanelResizeRef.current.startWidth + delta)));
    };
    const onUp = () => {
      sidePanelResizeRef.current = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [sidePanelWidth]);

  // ── Right panel resize ────────────────────────────────────────────────────
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const rightPanelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onRightPanelResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    rightPanelResizeRef.current = { startX: e.clientX, startWidth: rightPanelWidth };
    const onMove = (ev: PointerEvent) => {
      if (!rightPanelResizeRef.current) return;
      // dragging left increases width; dragging right shrinks it
      const delta = rightPanelResizeRef.current.startX - ev.clientX;
      setRightPanelWidth(Math.max(160, Math.min(700, rightPanelResizeRef.current.startWidth + delta)));
    };
    const onUp = () => {
      rightPanelResizeRef.current = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [rightPanelWidth]);

  // ── Tiling layout state (used when tilingModeEnabled) ─────────────────────
  const saved = useMemo(() => loadLayout(), []);
  const [layoutMode, setLayoutMode]         = useState<LayoutMode>(saved?.layoutMode ?? 'master');
  const [tiledSlots, setTiledSlots]         = useState<SlotNode[]>(saved?.tiledSlots ?? DEFAULT_SLOTS);
  const [floatingPaneIds, setFloatingPaneIds] = useState<string[]>(saved?.floatingPaneIds ?? []);
  const [focusedSlotIdx, setFocusedSlotIdx] = useState<number>(0);
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const gap = 8;

  // Apply theme
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // Apply global UI scale. The codebase uses many explicit pixel sizes that
  // wouldn't react to a root font-size change, so we scale via CSS `zoom`
  // on the document element — Chromium / WebKit both honor it and scale
  // every pixel value (text, padding, borders) uniformly.
  const uiTextScale = useOsStore(s => s.uiTextScale);
  useEffect(() => {
    (document.documentElement.style as any).zoom = String(uiTextScale);
  }, [uiTextScale]);

  // Bootstrap
  useEffect(() => {
    fetchSpatialTraits();
    useOsStore.getState().fetchBlobTraits();
    useOsStore.getState().fetchKeyValueTraits();
    useOsStore.getState().fetchTableTraits();
    useOsStore.getState().fetchTemporalTraits();
    fetchAllLabelTraits();
    fetchAllEntities();
    fetchRelationshipTypes();
    fetchStorageHealth();
    void ensureTerminalWorkbench();
    let cleanup: (() => void) | undefined;
    startListening().then(fn => { cleanup = fn; });
    return () => { if (cleanup) cleanup(); };
  }, []);

  // Persist tiling layout to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tiledSlots, floatingPaneIds, layoutMode })); }
    catch { /* storage full */ }
  }, [tiledSlots, floatingPaneIds, layoutMode]);

  // Right panel canvas. The Edition pane is special-cased so its always-visible
  // doc picker only appears in the right side panel, not in the main canvas
  // or DWM tiled layouts.
  const rightPanelContent = useMemo(() => {
    if (!rightPanelId) return null;
    if (rightPanelId === 'edition') {
      return <ErrorBoundary label="Edition"><EditionPanel inRightPanel /></ErrorBoundary>;
    }
    const p = ALL_PANES.find(x => x.id === rightPanelId);
    return p ? p.content : null;
  }, [rightPanelId]);

  // Floating pane configs (tiling mode)
  const floatingPanes = useMemo(() => ALL_PANES.filter(p => floatingPaneIds.includes(p.id)), [floatingPaneIds]);

  // Focused pane id (tiling mode)
  const focusedId = useMemo(() => {
    const slot = tiledSlots[focusedSlotIdx];
    if (!slot) return null;
    return slot.type === 'pane' ? slot.id : slot.active;
  }, [tiledSlots, focusedSlotIdx]);

  // ── Tiling slot mutations ─────────────────────────────────────────────────
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
    setFloatingPaneIds(fp => fp.filter(id => id !== sourceId));
    setTiledSlots(prev => {
      let next = [...prev];
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

  // ── Keybinds ──────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (KEYBINDS.runBenchmark(e)) {
      e.preventDefault();
      void syncBenchmark.startSuite();
    }
    if (KEYBINDS.ingestData(e))  {
      e.preventDefault();
      setActiveActivity('inputs');
      setSidePanelOpen(true);
      useOsStore.getState().requestImportFilePick();
    }
    if (KEYBINDS.createEntity(e)) {
      e.preventDefault();
      setActiveActivity('inputs');
      setSidePanelOpen(true);
      useOsStore.getState().addCreateInputDraft();
    }

    // Activity bar mode navigation
    if (!tilingModeEnabled) {
      if (KEYBINDS.toggleGraph(e))    { e.preventDefault(); setActiveActivity('graph'); setSidePanelOpen(true); }
      if (KEYBINDS.toggleGlobe(e))    { e.preventDefault(); setActiveActivity('globe'); setSidePanelOpen(true); }
      if (KEYBINDS.toggleTimeline(e)) { e.preventDefault(); setActiveActivity('timeline'); setSidePanelOpen(true); }
      if (KEYBINDS.toggleCalendar(e)) { e.preventDefault(); setActiveActivity('calendar'); setSidePanelOpen(true); }
      if (KEYBINDS.toggleTerminal(e)) { e.preventDefault(); setActiveActivity('terminal'); setSidePanelOpen(true); }
      if (KEYBINDS.toggleSidePanel(e)) { e.preventDefault(); toggleSidePanel(); }
      if (KEYBINDS.toggleRightPanel(e)) { e.preventDefault(); setRightPanelId(rightPanelId ? null : 'inspector'); }
      if (KEYBINDS.cycleActivityFwd(e)) {
        e.preventDefault();
        const idx = ACTIVITY_ORDER.indexOf(activeActivity);
        const next = ACTIVITY_ORDER[(idx + 1) % ACTIVITY_ORDER.length];
        setActiveActivity(next);
        setSidePanelOpen(true);
      }
      if (KEYBINDS.cycleActivityBwd(e)) {
        e.preventDefault();
        const idx = ACTIVITY_ORDER.indexOf(activeActivity);
        const next = ACTIVITY_ORDER[(idx - 1 + ACTIVITY_ORDER.length) % ACTIVITY_ORDER.length];
        setActiveActivity(next);
        setSidePanelOpen(true);
      }
      return;
    }

    // Tiling mode navigation
    if (KEYBINDS.layoutMaster(e))  { e.preventDefault(); setLayoutMode('master'); }
    if (KEYBINDS.layoutBstack(e))  { e.preventDefault(); setLayoutMode('bstack'); }
    if (KEYBINDS.layoutMonocle(e)) { e.preventDefault(); setLayoutMode('monocle'); }
    if (KEYBINDS.layoutGrid(e))    { e.preventDefault(); setLayoutMode('grid'); }

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

    if (KEYBINDS.closePane(e) && focusedId) { e.preventDefault(); togglePane(focusedId); }
    if (KEYBINDS.toggleGraph(e))     { e.preventDefault(); togglePane('graph'); }
    if (KEYBINDS.toggleInspector(e)) { e.preventDefault(); togglePane('inspector'); }
    if (KEYBINDS.toggleTerminal(e))  { e.preventDefault(); setCommandPaletteVisible(v => !v); }
    if (KEYBINDS.toggleGlobe(e))     { e.preventDefault(); togglePane('globe'); }
    if (KEYBINDS.toggleTimeline(e))  { e.preventDefault(); togglePane('timeline'); }
  }, [tilingModeEnabled, activeActivity, focusedSlotIdx, focusedId, tiledSlots,
      togglePane, handleChangeActiveTab, rightPanelId,
      setActiveActivity, toggleSidePanel, setRightPanelId, setSidePanelOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-focus terminal on session switch (tiling mode)
  const activePtySession = useOsStore(s => s.activePtySession);
  useEffect(() => {
    if (!tilingModeEnabled) return;
    if (activePtySession !== null) {
      const inTiled    = tiledSlots.some(s => slotIds(s).includes('terminal'));
      const inFloating = floatingPaneIds.includes('terminal');
      if (!inTiled && !inFloating) {
        setTiledSlots(prev => { const next = [...prev, { type: 'pane' as const, id: 'terminal' }]; setFocusedSlotIdx(next.length - 1); return next; });
      }
      setTimeout(() => {
        const idx = tiledSlots.findIndex(s => slotIds(s).includes('terminal'));
        if (idx !== -1) setFocusedSlotIdx(idx);
      }, 50);
    }
  }, [activePtySession, tilingModeEnabled]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DndProvider backend={HTML5Backend}>
      <div className="app-root" id="app-root" onClick={() => setMenuOpen(null)}>

        {/* ── Titlebar ─────────────────────────────────────────── */}
        <div className="titlebar" style={{ WebkitAppRegion: 'drag' } as any}>
          <span className="titlebar-logo" style={{ WebkitAppRegion: 'drag' } as any}>⬡ Humanist</span>
          <div style={{ display: 'flex', WebkitAppRegion: 'no-drag' } as any}>
            <button className="window-btn" onClick={() => appWindow.minimize()} title="Minimise"><Minus size={12} /></button>
            <button className="window-btn" onClick={() => appWindow.toggleMaximize()} title="Maximise"><Square size={12} /></button>
            <button className="window-btn window-btn-close" onClick={() => appWindow.close()} title="Close"><X size={12} /></button>
          </div>
        </div>

        {tilingModeEnabled ? (
          /* ── Tiling mode (legacy DWM) ─────────────────────── */
          <>
            {/* Legacy menu bar */}
            <div className="menubar" style={{ display: 'flex', alignItems: 'center', height: 28, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', fontSize: 13, userSelect: 'none' }}>
              <div style={{ display: 'flex', gap: 4, padding: '0 8px' }}>
                <div style={{ position: 'relative' }}>
                  <div className="menu-item" onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === 'file' ? null : 'file'); }}
                    style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4, background: menuOpen === 'file' ? 'var(--bg-panel)' : 'transparent', color: 'var(--text-primary)' }}>
                    File
                  </div>
                  {menuOpen === 'file' && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10000, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                      <div className="menu-action" onClick={() => { setActiveActivity('inputs'); setSidePanelOpen(true); useOsStore.getState().requestImportFilePick(); setMenuOpen(null); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Ingest Data…</span><span style={{ color: 'var(--text-hint)' }}>Ctrl+I</span>
                      </div>
                      <div className="menu-action" onClick={() => { setActiveActivity('inputs'); setSidePanelOpen(true); useOsStore.getState().addCreateInputDraft(); setMenuOpen(null); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3, display: 'flex', justifyContent: 'space-between' }}>
                        <span>New Entity…</span><span style={{ color: 'var(--text-hint)' }}>Ctrl+N</span>
                      </div>
                      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                      <div className="menu-action" onClick={() => window.close()} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 3 }}>Exit</div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', padding: '0 8px' }}>
                <button
                  onClick={() => setTilingModeEnabled(false)}
                  style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-hint)', cursor: 'pointer' }}
                  title="Exit tiling mode"
                >
                  Exit Tiling Mode
                </button>
              </div>
            </div>

            {floatingPanes.map(p => (
              <DraggablePane key={`float-${p.id}`} config={p}
                isFocused={false} onClick={() => {}} onAttach={handleAttach}
                tiledSlots={tiledSlots} allPanes={ALL_PANES} onMergeInto={handleMergeInto} />
            ))}
            <div className="layout-container" style={{ padding: gap }}>
              <TilingLayout
                slots={tiledSlots} allPanes={ALL_PANES} mode={layoutMode}
                focusedSlotIdx={focusedSlotIdx} onFocusSlot={setFocusedSlotIdx}
                onDetach={handleDetach} onMergeInto={handleMergeInto}
                onCloseTab={handleCloseTab} onDetachTab={handleDetachTab}
                onChangeActiveTab={handleChangeActiveTab} onReorderTab={handleReorderTab}
                gap={gap}
              />
            </div>
            <CommandPalette visible={commandPaletteVisible} onClose={() => setCommandPaletteVisible(false)} />
          </>
        ) : (
          /* ── Activity bar mode (default) ────────────────────── */
          <div className="activity-layout">
            <ActivityBar />

            <SidePanel
              theme={theme}
              onThemeChange={setTheme}
              width={sidePanelWidth}
            />
            <div className="side-panel-resizer" onPointerDown={onSidePanelResizeStart} />

            {/* Primary canvas */}
            <div className="primary-canvas">
              {/* Canvas toolbar: right-panel toggle */}
              <div className="canvas-toolbar">
                <button
                  className={`canvas-toolbar-btn${rightPanelId ? ' active' : ''}`}
                  title="Toggle right panel (Ctrl+\)"
                  onClick={() => setRightPanelId(rightPanelId ? null : 'inspector')}
                >
                  <SplitSquareHorizontal size={14} />
                </button>
              </div>
              <div className={`canvas-body${primaryCanvasId === 'inputs' ? ' canvas-body--framed' : ''}`}>
                <PrimaryCanvas activityId={primaryCanvasId} />
              </div>
            </div>

            {/* Optional right panel */}
            {rightPanelId && (
              <div className="right-panel" style={{ width: rightPanelWidth }}>
                {/* Drag handle on the left edge */}
                <div className="side-panel-resizer" onPointerDown={onRightPanelResizeStart} />
                <div className="right-panel-inner">
                  <div className="side-panel-header">
                    <span className="side-panel-title">
                      {ALL_PANES.find(p => p.id === rightPanelId)?.label ?? rightPanelId}
                    </span>
                    <button className="side-panel-close" onClick={() => setRightPanelId(null)} title="Close">
                      <X size={12} />
                    </button>
                  </div>
                  {/* Panel picker — all panels except those visible in the canvas */}
                  <div className="side-panel-picker">
                    {RIGHT_PANEL_PICKER.filter(p => !rightPickerExcluded(primaryCanvasId).has(p.id)).map(p => (
                      <button
                        key={p.id}
                        className={`side-panel-picker-btn${rightPanelId === p.id ? ' active' : ''}`}
                        title={p.title}
                        onClick={() => setRightPanelId(p.id)}
                      >
                        {p.icon}
                      </button>
                    ))}
                  </div>
                  <div className="side-panel-body">
                    {rightPanelContent}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DndProvider>
  );
}
