import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  EdgeRecord,
  Entity,
  EntitySnapshot,
  LabelTrait,
  RelationshipType,
  SpatialTrait,
  BlobTrait,
  KeyValueTrait,
  TemporalTrait,
  TableTrait,
  TableColumn,
  DraftSpatialTrait,
  DraftTemporalTrait,
  TraitSnapshot,
  InputDraft,
  PickedInputFile,
  ImportSourceDraft,
  StorageHealth,
  GcSweepStats,
  EntityKind,
  TerminalSession,
  TerminalSessionKind,
  TerminalSessionStatus,
} from './models';
import { logFrontend } from './lib/log';
import {
  loadPersistedSettings,
  persistSettings,
  DEFAULT_GRAPH_MODE,
  DEFAULT_TEXT_SCALE,
  TEXT_SCALE_MIN,
  TEXT_SCALE_MAX,
} from './config';

const TOGGLED_NODES_STORAGE_KEY = 'humanist:toggled-image-nodes';
function loadToggledImageNodes(): Set<string> {
  try {
    const raw = localStorage.getItem(TOGGLED_NODES_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>();
  } catch { return new Set<string>(); }
}
function persistToggledImageNodes(set: Set<string>): void {
  try { localStorage.setItem(TOGGLED_NODES_STORAGE_KEY, JSON.stringify([...set])); }
  catch { /* best-effort */ }
}

// ── Event payload types ───────────────────────────────────────────────────────

interface EntityUpdateEvent {
  topic: string;
  ulid: string;
  revision?: number;
  label?: string;
}

interface GraphUpdateEvent {
  from: string;
  to: string;
  label: string;
}

interface InputJobProgressEvent {
  job_id: string;
  stage: InputDraft['stage'];
  message: string;
}

interface InputJobFinishedEvent {
  job_id: string;
  entity_id?: string | null;
  stage: InputDraft['stage'];
  message: string;
  error?: string | null;
}

export type GraphEdge = EdgeRecord;

const INITIAL_TERMINAL_SESSION_ID = 'shell-1';
export const TERMINAL_CLEAR_MARKER = '\u001fSPATIAL_CLEAR\u001f';
const TERMINAL_HISTORY_STORAGE_PREFIX = 'humanist:terminal-history:';

function loadPersistedTerminalHistory(kind: TerminalSessionKind): string[] {
  if (kind === 'shell' || typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(`${TERMINAL_HISTORY_STORAGE_PREFIX}${kind}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function persistTerminalHistory(kind: TerminalSessionKind, history: string[]) {
  if (kind === 'shell' || typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(`${TERMINAL_HISTORY_STORAGE_PREFIX}${kind}`, JSON.stringify(history));
  } catch {
    // best effort only
  }
}

function terminalPrompt(kind: TerminalSessionKind): string {
  switch (kind) {
    case 'sql':
      return 'sql> ';
    case 'prolog':
      return '?- ';
    case 'shell':
    default:
      return '';
  }
}

function terminalTitle(kind: TerminalSessionKind, index: number): string {
  switch (kind) {
    case 'sql':
      return `SQL ${index}`;
    case 'prolog':
      return `Prolog ${index}`;
    case 'shell':
    default:
      return `Shell ${index}`;
  }
}

function createTerminalSessionRecord(
  kind: TerminalSessionKind,
  index: number,
  id?: string,
  history: string[] = loadPersistedTerminalHistory(kind),
): TerminalSession {
  return {
    id: id ?? `${kind}-${globalThis.crypto.randomUUID()}`,
    kind,
    title: terminalTitle(kind, index),
    prompt: terminalPrompt(kind),
    transcript: '',
    currentInput: '',
    cursor: 0,
    history,
    historyIndex: null,
    status: 'ready',
    visible: true,
  };
}

export function terminalSessionCommand(kind: TerminalSessionKind): string | undefined {
  switch (kind) {
    case 'sql':
      return `
stty -echo
trap 'stty echo' EXIT
cargo build -q -p os_cli || exit $?
while :; do
  IFS= read -r line
  status=$?
  if [ $status -ne 0 ]; then
    printf '\\n'
    continue
  fi
  [ "$line" = ".exit" ] && exit 0
  [ "$line" = ".clear" ] && printf '\x1fSPATIAL_CLEAR\x1f' && continue
  [ -z "$line" ] && continue
  target/debug/os_cli -q db sql "$line" || true
done
`.trim();
    case 'prolog':
      return `
stty -echo
trap 'stty echo' EXIT
cargo build -q -p os_cli || exit $?
exec target/debug/os_cli -q prolog repl
`.trim();
    case 'shell':
    default:
      return undefined;
  }
}

/**
 * Pure helper: resolves the best display label for an entity.
 * Resolution order:
 *   1. LabelTrait matching activeLocale
 *   2. LabelTrait matching entity.lang_canonical
 *   3. entity.label fallback
 */
export function resolvedLabel(
  entity: Entity,
  allLabelTraits: LabelTrait[],
  activeLocale: string,
): string {
  const own = allLabelTraits.filter(t => t.owner === entity.id);
  const byActive = own.find(t => t.lang === activeLocale);
  if (byActive) return byActive.text;
  const byCanonical = own.find(t => t.lang === entity.lang_canonical);
  if (byCanonical) return byCanonical.text;
  return entity.label;
}

export function entityValues(
  entityId: string,
  allKeyValueTraits: KeyValueTrait[],
  namespace = 'entity',
): Record<string, any> {
  return allKeyValueTraits.find(t => t.owner === entityId && t.namespace === namespace)?.values ?? {};
}

// ── Store definition ─────────────────────────────────────────────────────────

interface OsStore {
  // Data
  entities: Entity[];
  spatialTraits: SpatialTrait[];
  blobTraits: BlobTrait[];
  keyValueTraits: KeyValueTrait[];
  tableTraits: TableTrait[];
  temporalTraits: TemporalTrait[];
  edges: GraphEdge[];
  selectedEntityId: string | null;
  selectedIds: string[];
  contextEntities: Entity[];
  selectedEntityEdges: GraphEdge[];

  // Phase 44: entity history
  entityHistory: EntitySnapshot[];
  traitHistory: TraitSnapshot[];

  // Phase 45: relationship types
  relationshipTypes: RelationshipType[];

  // Phase 43: multilingual labels
  activeLocale: string;
  labelTraits: LabelTrait[];       // traits for the currently selected entity (inspector)
  allLabelTraits: LabelTrait[];    // full table — used for app-wide label resolution

  // Phase 44: exploration mode
  graphMode: 'context' | 'full';
  hopCount: number;

  // Backend readiness — false until the Rust side emits "backend-ready"
  backendReady: boolean;
  // Full entity list for the explore dropdown (refreshed on every entity event)
  allEntities: Entity[];
  // All tagged_as edges — kept in sync regardless of graph view
  allTagEdges: GraphEdge[];

  // UI flags
  isLoading: boolean;
  lastEvent: EntityUpdateEvent | null;
  nodePositions: Record<string, { x: number, y: number }>;
  showRegions: boolean;
  filterKinds: string[];
  filterEdgeLabels: string[];       // Edge labels to HIDE (empty = show all)   
  highlightedPath: string[];        // Node IDs on active BFS path
  highlightedEdgeKeys: Set<string>; // "from|to" keys of edges on active path
  overlayEdges: { from: string; to: string; ruleId: string; ruleLabel: string }[];
  showDerivedEdges: boolean;        // false hides edges with metadata.derived === true
  activePtySession: string | null;
  terminalSessions: TerminalSession[];
  activeTerminalSessionId: string | null;
  inputDrafts: InputDraft[];
  selectedInputDraftIds: string[];
  inputPickerRequestToken: number;
  storageHealth: StorageHealth | null;
  storageHealthLoading: boolean;
  gcRunning: boolean;
  lastGcResult: GcSweepStats | null;

  // Phase 43: multilingual label actions
  setActiveLocale: (lang: string) => void;
  fetchLabelTraits: (entityId: string) => Promise<void>;
  fetchAllLabelTraits: () => Promise<void>;
  saveLabelTrait: (trait: LabelTrait) => Promise<void>;
  deleteLabelTrait: (id: string) => Promise<void>;

  // Phase 44: history actions
  fetchEntityHistory: (entityId: string) => Promise<void>;
  fetchTraitHistory: (entityId: string) => Promise<void>;
  getEntityAsOf: (entityId: string, timestamp: string) => Promise<EntitySnapshot | null>;

  // Phase 45: relationship type actions
  fetchRelationshipTypes: () => Promise<void>;
  saveRelationshipType: (rel: Omit<RelationshipType, 'id'> & { id?: string }) => Promise<void>;
  deleteRelationshipType: (label: string) => Promise<void>;
  getEffectiveSpatialTrait: (entityId: string) => Promise<SpatialTrait | null>;

  fetchAllEntities: () => Promise<void>;

  // Phase 44: exploration actions
  expandContext: (entityId: string) => Promise<void>;
  /** Load exactly these entity IDs + edges between them — no BFS expansion. Used by SQL queries. */
  loadExactIds: (ids: string[]) => Promise<void>;
  clearGraph: () => void;
  loadFullGraph: () => Promise<void>;
  setHopCount: (n: number) => void;
  searchEntitiesAction: (query: string, lang?: string) => Promise<Entity[]>;

  // Actions — read
  setActivePtySession: (sessionId: string | null) => void;
  ensureTerminalWorkbench: () => Promise<void>;
  createTerminalSession: (kind: TerminalSessionKind) => Promise<string>;
  activateTerminalSession: (sessionId: string) => void;
  closeTerminalSession: (sessionId: string) => Promise<void>;
  updateTerminalSession: (sessionId: string, patch: Partial<TerminalSession>) => void;
  syncTerminalHistoryForKind: (kind: TerminalSessionKind, history: string[]) => void;
  appendTerminalSessionTranscript: (sessionId: string, chunk: string) => void;
  replaceTerminalSessionTranscript: (sessionId: string, transcript: string) => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
  fetchEntities: () => Promise<void>;
  fetchSpatialTraits: () => Promise<void>;
  fetchBlobTraits: () => Promise<void>;
  fetchKeyValueTraits: () => Promise<void>;
  fetchTableTraits: () => Promise<void>;
  fetchTemporalTraits: () => Promise<void>;
  fetchEdges: () => Promise<void>;
  saveTemporalTrait: (trait: Omit<TemporalTrait, "id">) => Promise<void>;
  saveSpatialTrait: (trait: Omit<SpatialTrait, "id">) => Promise<void>;
  selectEntity: (id: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  queryContext: (contextId: string) => Promise<void>;
  fetchEntityEdges: (entityId: string) => Promise<void>;
  startListening: () => Promise<() => void>;

  // Actions — write
  createEntity: (kind: string, label: string) => Promise<string>;
  saveEntityData: (id: string, values: Record<string, any>) => Promise<void>;
  saveTableTrait: (owner: string, namespace: string, columns: TableColumn[], rows: Record<string, any>[]) => Promise<TableTrait>;
  deleteTableTrait: (tableTraitId: string) => Promise<void>;
  deleteEntity: (id: string) => Promise<void>;
  deleteEntities: (ids: string[]) => Promise<void>;
  tagEntity: (targetId: string, tagLabel: string) => Promise<void>;
  tagEntities: (targetIds: string[], tagLabel: string) => Promise<void>;
  untagEntity: (targetId: string, tagLabel: string) => Promise<void>;
  addEdgeAction: (fromId: string, toId: string, label: string) => Promise<void>;
  removeEdge: (fromId: string, toId: string, label?: string) => Promise<void>;
  saveBlobContent: (owner: string, content: string) => Promise<void>;
  clearSelection: () => void;
  toggleRegions: () => void;
  toggleFilterKind: (kind: string) => void;
  setFilterKinds: (kinds: string[]) => void;
  toggleFilterEdgeLabel: (label: string) => void;
  setHighlightedPath: (path: string[], edgeKeys: Set<string>) => void;
  clearHighlightedPath: () => void;
  setOverlayEdges: (edges: { from: string; to: string; ruleId: string; ruleLabel: string }[]) => void;
  toggleShowDerivedEdges: () => void;
  addCreateInputDraft: () => string;
  addImportDraftsFromPaths: (paths: string[]) => string[];
  addImportDraftsFromFiles: (files: PickedInputFile[]) => string[];
  addImportDraftsFromSources: (sources: ImportSourceDraft[]) => string[];
  updateInputDraft: (jobId: string, patch: Partial<InputDraft>) => void;
  toggleInputDraftExpanded: (jobId: string) => void;
  setAllInputDraftsExpanded: (expanded: boolean) => void;
  removeInputDraft: (jobId: string) => void;
  clearInputDrafts: () => void;
  toggleSelectedInputDraft: (jobId: string) => void;
  setSelectedInputDraftIds: (jobIds: string[]) => void;
  submitInputDraft: (jobId: string) => Promise<void>;
  requestImportFilePick: () => void;
  fetchStorageHealth: () => Promise<void>;
  runInputGc: () => Promise<GcSweepStats | null>;

  // ── Activity bar / shell layout state ────────────────────────
  activeActivity: string;
  sidePanelOpen: boolean;
  rightPanelId: string | null;
  tilingModeEnabled: boolean;
  setActiveActivity: (id: string) => void;
  toggleSidePanel: () => void;
  setSidePanelOpen: (open: boolean) => void;
  setRightPanelId: (id: string | null) => void;
  setTilingModeEnabled: (enabled: boolean) => void;

  // ── Lifted graph toolbar state (shared with GraphSidePanel) ──
  graphExploreQuery: string;
  graphExploreStatus: string | null;
  graphShowGrid: boolean;
  graphPathFrom: string;
  graphPathTo: string;
  graphPathError: string | null;
  setGraphExploreQuery: (q: string) => void;
  setGraphExploreStatus: (s: string | null) => void;
  setGraphShowGrid: (show: boolean) => void;
  setGraphPathFrom: (id: string) => void;
  setGraphPathTo: (id: string) => void;
  setGraphPathError: (err: string | null) => void;
  graphResetViewFn: (() => void) | null;
  setGraphResetViewFn: (fn: (() => void) | null) => void;
  graphLoading: boolean;
  backgroundStyle: 'grid' | 'dots';
  setBackgroundStyle: (s: 'grid' | 'dots') => void;
  regionStyle: 'hatch' | 'fill';
  setRegionStyle: (s: 'hatch' | 'fill') => void;

  // Force-graph runtime preferences (persisted via humanist:settings)
  graphLayoutMode: import('./config').GraphLayoutMode;
  setGraphLayoutMode: (m: import('./config').GraphLayoutMode) => void;
  graphSimulationPaused: boolean;
  setGraphSimulationPaused: (paused: boolean) => void;
  graphShowNodeLabels: boolean;
  setGraphShowNodeLabels: (show: boolean) => void;
  graphShowEdgeLabels: boolean;
  setGraphShowEdgeLabels: (show: boolean) => void;
  graphHiddenRelationshipLabels: string[];
  setRelationshipLabelVisible: (label: string, visible: boolean) => void;
  renameRelationshipLabelVisibility: (fromLabel: string, toLabel: string) => void;
  clearRelationshipLabelVisibility: (label: string) => void;
  graphHiddenLabelCategories: import('./config').EntityCategory[];
  toggleGraphHiddenLabelCategory: (c: import('./config').EntityCategory) => void;

  // Per-node toggled image / PDF previews. Lifted from GraphPanel so the side
  // panel can offer a "collapse all" action; persisted to localStorage.
  toggledImageNodes: Set<string>;
  toggleImageNode: (nodeId: string) => void;
  clearToggledImageNodes: () => void;

  // Cross-panel delete confirmation flag — drives the inline confirm row in
  // the Graph side panel's selection actions.
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (show: boolean) => void;

  // Global UI font scale (multiplier applied to documentElement font-size).
  uiTextScale: number;
  setUiTextScale: (scale: number) => void;

  // ── Edition Panel state ───────────────────────────────────────
  editionEntityId: string | null;
  editionDocKey: string | null; // "entity" | blobTraitId
  editionMode: 'web' | 'terminal';
  editionFormat: 'yaml' | 'json';
  setEditionEntity: (id: string | null) => void;
  setEditionDoc: (key: string | null) => void;
  setEditionMode: (mode: 'web' | 'terminal') => void;
  setEditionFormat: (fmt: 'yaml' | 'json') => void;
  readBlobContent: (blobTraitId: string) => Promise<string>;
  writeBlobContentById: (blobTraitId: string, content: string) => Promise<void>;
  getEntityText: (entityId: string, format: 'yaml' | 'json') => Promise<string>;
  applyEntityText: (entityId: string, content: string, format: 'yaml' | 'json') => Promise<void>;
  createEntityNotes: (entityId: string, filename?: string) => Promise<BlobTrait | null>;
  deleteBlobTrait: (blobTraitId: string) => Promise<void>;
  renameBlobTrait: (blobTraitId: string, newFilename: string) => Promise<void>;
}

export const useOsStore = create<OsStore>((set, get) => ({
  entities: [],
  spatialTraits: [],
  blobTraits: [],
  keyValueTraits: [],
  tableTraits: [],
  temporalTraits: [],
  edges: [],
  entityHistory: [],
  traitHistory: [],
  relationshipTypes: [],
  activeLocale: 'en',
  labelTraits: [],
  allLabelTraits: [],
  selectedEntityId: null,
  selectedIds: [],
  contextEntities: [],
  selectedEntityEdges: [],
  graphMode: 'context' as const,
  hopCount: 2,
  backendReady: false,
  allEntities: [],
  allTagEdges: [],
  isLoading: false,
  lastEvent: null,
  nodePositions: {},
  showRegions: true,
  filterKinds: [],
  filterEdgeLabels: [],
  highlightedPath: [],
  overlayEdges: [],
  showDerivedEdges: true,
  highlightedEdgeKeys: new Set<string>(),
  activePtySession: INITIAL_TERMINAL_SESSION_ID,
  terminalSessions: [createTerminalSessionRecord('shell', 1, INITIAL_TERMINAL_SESSION_ID)],
  activeTerminalSessionId: INITIAL_TERMINAL_SESSION_ID,
  inputDrafts: [],
  selectedInputDraftIds: [],
  inputPickerRequestToken: 0,
  storageHealth: null,
  storageHealthLoading: false,
  gcRunning: false,
  lastGcResult: null,

  // Activity bar / shell layout
  activeActivity: 'graph',
  sidePanelOpen: true,
  rightPanelId: null,
  tilingModeEnabled: false,
  setActiveActivity: (id) => set({ activeActivity: id }),
  toggleSidePanel: () => set(s => ({ sidePanelOpen: !s.sidePanelOpen })),
  setSidePanelOpen: (open) => set({ sidePanelOpen: open }),
  setRightPanelId: (id) => set({ rightPanelId: id }),
  setTilingModeEnabled: (enabled) => set({ tilingModeEnabled: enabled }),

  // Lifted graph toolbar state
  graphExploreQuery: '',
  graphExploreStatus: null,
  graphShowGrid: true,
  graphPathFrom: '',
  graphPathTo: '',
  graphPathError: null,
  setGraphExploreQuery: (q) => set({ graphExploreQuery: q }),
  setGraphExploreStatus: (s) => set({ graphExploreStatus: s }),
  setGraphShowGrid: (show) => set({ graphShowGrid: show }),
  setGraphPathFrom: (id) => set({ graphPathFrom: id }),
  setGraphPathTo: (id) => set({ graphPathTo: id }),
  setGraphPathError: (err) => set({ graphPathError: err }),
  graphResetViewFn: null,
  setGraphResetViewFn: (fn) => set({ graphResetViewFn: fn }),
  graphLoading: false,
  backgroundStyle: 'grid' as const,
  setBackgroundStyle: (s) => set({ backgroundStyle: s }),

  graphLayoutMode: (loadPersistedSettings().graphLayoutMode ?? DEFAULT_GRAPH_MODE),
  setGraphLayoutMode: (m) => { set({ graphLayoutMode: m }); persistSettings({ graphLayoutMode: m }); },
  graphSimulationPaused: loadPersistedSettings().graphSimulationPaused ?? false,
  setGraphSimulationPaused: (paused) => { set({ graphSimulationPaused: paused }); persistSettings({ graphSimulationPaused: paused }); },
  graphShowNodeLabels: loadPersistedSettings().graphShowNodeLabels ?? true,
  setGraphShowNodeLabels: (show) => { set({ graphShowNodeLabels: show }); persistSettings({ graphShowNodeLabels: show }); },
  graphShowEdgeLabels: loadPersistedSettings().graphShowEdgeLabels ?? true,
  setGraphShowEdgeLabels: (show) => { set({ graphShowEdgeLabels: show }); persistSettings({ graphShowEdgeLabels: show }); },
  graphHiddenRelationshipLabels: loadPersistedSettings().graphHiddenRelationshipLabels ?? [],
  setRelationshipLabelVisible: (label, visible) => {
    const key = label.trim();
    if (!key) return;
    const current = get().graphHiddenRelationshipLabels;
    const next = visible
      ? current.filter(x => x !== key)
      : current.includes(key) ? current : [...current, key];
    set({ graphHiddenRelationshipLabels: next });
    persistSettings({ graphHiddenRelationshipLabels: next });
  },
  renameRelationshipLabelVisibility: (fromLabel, toLabel) => {
    const from = fromLabel.trim();
    const to = toLabel.trim();
    if (!from || !to || from === to) return;
    const current = get().graphHiddenRelationshipLabels;
    if (!current.includes(from)) return;
    const next = current.filter(x => x !== from);
    if (!next.includes(to)) next.push(to);
    set({ graphHiddenRelationshipLabels: next });
    persistSettings({ graphHiddenRelationshipLabels: next });
  },
  clearRelationshipLabelVisibility: (label) => {
    const key = label.trim();
    if (!key) return;
    const current = get().graphHiddenRelationshipLabels;
    if (!current.includes(key)) return;
    const next = current.filter(x => x !== key);
    set({ graphHiddenRelationshipLabels: next });
    persistSettings({ graphHiddenRelationshipLabels: next });
  },
  graphHiddenLabelCategories: (loadPersistedSettings().graphHiddenLabelCategories ?? []),
  toggleGraphHiddenLabelCategory: (c) => {
    const current = get().graphHiddenLabelCategories;
    const next = current.includes(c) ? current.filter(x => x !== c) : [...current, c];
    set({ graphHiddenLabelCategories: next });
    persistSettings({ graphHiddenLabelCategories: next });
  },

  toggledImageNodes: loadToggledImageNodes(),
  toggleImageNode: (nodeId) => {
    const next = new Set(get().toggledImageNodes);
    if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
    set({ toggledImageNodes: next });
    persistToggledImageNodes(next);
  },
  clearToggledImageNodes: () => {
    set({ toggledImageNodes: new Set<string>() });
    persistToggledImageNodes(new Set<string>());
  },

  showDeleteConfirm: false,
  setShowDeleteConfirm: (show) => set({ showDeleteConfirm: show }),

  uiTextScale: (() => {
    const raw = loadPersistedSettings().uiTextScale ?? DEFAULT_TEXT_SCALE;
    return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, raw));
  })(),
  setUiTextScale: (scale) => {
    const clamped = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, scale));
    set({ uiTextScale: clamped });
    persistSettings({ uiTextScale: clamped });
  },
  regionStyle: 'fill' as const,
  setRegionStyle: (s) => set({ regionStyle: s }),

  // ── Edition Panel ─────────────────────────────────────────────
  editionEntityId: null,
  editionDocKey: null,
  editionMode: 'web' as const,
  editionFormat: 'yaml' as const,
  setEditionEntity: (id) => {
    if (!id) { set({ editionEntityId: null, editionDocKey: null }); return; }
    // Default to the first attachment if any exist; otherwise fall back to
    // the synthetic 'entity' document. Keeps blob-bearing entities opening
    // straight to their content rather than the YAML wrapper.
    const own = get().blobTraits.filter(t => t.owner === id);
    const docKey = own.length > 0 ? own[0].id : 'entity';
    set({ editionEntityId: id, editionDocKey: docKey });
  },
  setEditionDoc: (key) => set({ editionDocKey: key ?? null }),
  setEditionMode: (mode) => set({ editionMode: mode }),
  setEditionFormat: (fmt) => set({ editionFormat: fmt }),
  readBlobContent: async (blobTraitId) => {
    return invoke<string>('read_blob_content', { blobTraitId });
  },
  writeBlobContentById: async (blobTraitId, content) => {
    await invoke('write_blob_content_by_id', { blobTraitId, content });
    await get().fetchBlobTraits();
  },
  getEntityText: async (entityId, format) => {
    return invoke<string>('get_entity_text', { entityId, format });
  },
  applyEntityText: async (entityId, content, format) => {
    await invoke('apply_entity_text', { entityId, content, format });
    await get().fetchEntities();
    await get().fetchSpatialTraits();
    await get().fetchTemporalTraits();
  },
  createEntityNotes: async (entityId, filename?) => {
    const trait = await invoke<BlobTrait>('create_entity_notes', { entityId, filename: filename ?? null });
    await get().fetchBlobTraits();
    return trait;
  },
  deleteBlobTrait: async (blobTraitId) => {
    await invoke('delete_blob_trait', { blobTraitId });
    const s = get();
    if (s.editionDocKey === blobTraitId) {
      set({ editionDocKey: 'entity' });
    }
    await get().fetchBlobTraits();
  },
  renameBlobTrait: async (blobTraitId, newFilename) => {
    await invoke('rename_blob_trait', { blobTraitId, newFilename });
    await get().fetchBlobTraits();
  },

  setActivePtySession: (sessionId) => set({ activePtySession: sessionId }),
  ensureTerminalWorkbench: async () => {
    const sessions = get().terminalSessions.filter(session => session.visible);
    if (sessions.length > 0) {
      const activeId = get().activeTerminalSessionId ?? sessions[0].id;
      set({
        activeTerminalSessionId: activeId,
        activePtySession: activeId,
      });
      const active = sessions.find(session => session.id === activeId);
      if (active) {
        await invoke('spawn_terminal', { sessionId: active.id, command: terminalSessionCommand(active.kind) });
      }
      return;
    }
    set({
      activeTerminalSessionId: null,
      activePtySession: null,
    });
  },
  createTerminalSession: async (kind) => {
    const sameKindCount = get().terminalSessions.filter(session => session.kind === kind && session.visible).length;
    const sharedHistory = get().terminalSessions.find(session => session.kind === kind)?.history
      ?? loadPersistedTerminalHistory(kind);
    const session = createTerminalSessionRecord(kind, sameKindCount + 1, undefined, sharedHistory);
    set(state => ({
      terminalSessions: [...state.terminalSessions, session],
      activeTerminalSessionId: session.id,
      activePtySession: session.id,
      activeActivity: 'terminal',
      sidePanelOpen: true,
    }));
    await invoke('spawn_terminal', { sessionId: session.id, command: terminalSessionCommand(kind) });
    return session.id;
  },
  activateTerminalSession: (sessionId) => {
    const session = get().terminalSessions.find(existing => existing.id === sessionId && existing.visible);
    if (!session) return;
    set({
      activeTerminalSessionId: sessionId,
      activePtySession: sessionId,
      activeActivity: 'terminal',
      sidePanelOpen: true,
    });
  },
  closeTerminalSession: async (sessionId) => {
    const sessions = get().terminalSessions;
    const target = sessions.find(session => session.id === sessionId && session.visible);
    if (!target) return;
    const remaining = sessions.filter(session => session.id !== sessionId && session.visible);
    let nextActiveId = get().activeTerminalSessionId;
    if (nextActiveId === sessionId) {
      nextActiveId = remaining[remaining.length - 1]?.id ?? null;
    }
    set(state => ({
      terminalSessions: state.terminalSessions.map(session =>
        session.id === sessionId ? { ...session, visible: false, status: 'closed' as TerminalSessionStatus } : session
      ),
      activeTerminalSessionId: nextActiveId,
      activePtySession: nextActiveId,
    }));
    await invoke('kill_terminal', { sessionId: target.id });
  },
  updateTerminalSession: (sessionId, patch) => set(state => ({
    terminalSessions: state.terminalSessions.map(session =>
      session.id === sessionId ? { ...session, ...patch } : session
    ),
  })),
  syncTerminalHistoryForKind: (kind, history) => {
    persistTerminalHistory(kind, history);
    set(state => ({
      terminalSessions: state.terminalSessions.map(session =>
        session.kind === kind
          ? { ...session, history, historyIndex: session.visible ? session.historyIndex : null }
          : session
      ),
    }));
  },
  appendTerminalSessionTranscript: (sessionId, chunk) => set(state => ({
    terminalSessions: state.terminalSessions.map(session =>
      session.id === sessionId ? { ...session, transcript: session.transcript + chunk } : session
    ),
  })),
  replaceTerminalSessionTranscript: (sessionId, transcript) => set(state => ({
    terminalSessions: state.terminalSessions.map(session =>
      session.id === sessionId ? { ...session, transcript } : session
    ),
  })),

  addCreateInputDraft: () => {
    const jobId = globalThis.crypto.randomUUID();
    set(state => ({
      inputDrafts: [
        {
          jobId,
          kind: 'create',
          label: '',
          category: 'digital',
          stage: 'draft',
          progressMessage: 'Draft entity',
          expanded: false,
          spatialTrait: null,
          temporalTrait: null,
          blobAttachment: null,
          tagLabels: [],
        },
        ...state.inputDrafts.map(d => ({ ...d, expanded: false })),
      ],
      selectedInputDraftIds: [...new Set([jobId, ...state.selectedInputDraftIds])],
    }));
    return jobId;
  },

  addImportDraftsFromPaths: (paths) => {
    const drafts = paths.map((sourcePath) => {
      const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
      const dot = fileName.lastIndexOf('.');
      const label = dot > 0 ? fileName.slice(0, dot) : fileName;
      return {
        jobId: globalThis.crypto.randomUUID(),
        kind: 'import' as const,
        label,
        category: 'digital' as EntityKind,
        sourcePath,
        fileName,
        stage: 'draft' as const,
        progressMessage: 'Import draft',
        expanded: false,
        spatialTrait: null,
        temporalTrait: null,
        blobAttachment: null,
        tagLabels: [],
      };
    });
    set(state => ({
      inputDrafts: [...drafts, ...state.inputDrafts.map(d => ({ ...d, expanded: false }))],
      selectedInputDraftIds: [...new Set([...drafts.map(d => d.jobId), ...state.selectedInputDraftIds])],
    }));
    return drafts.map(d => d.jobId);
  },

  addImportDraftsFromFiles: (files) => {
    const drafts = files.map((file) => {
      const dot = file.fileName.lastIndexOf('.');
      const label = dot > 0 ? file.fileName.slice(0, dot) : file.fileName;
      return {
        jobId: globalThis.crypto.randomUUID(),
        kind: 'import' as const,
        label,
        category: 'digital' as EntityKind,
        fileName: file.fileName,
        mime: file.mime,
        size: file.size,
        bytes: file.bytes,
        stage: 'draft' as const,
        progressMessage: 'Import draft',
        expanded: false,
        spatialTrait: null,
        temporalTrait: null,
        blobAttachment: null,
        tagLabels: [],
      };
    });
    set(state => ({
      inputDrafts: [...drafts, ...state.inputDrafts.map(d => ({ ...d, expanded: false }))],
      selectedInputDraftIds: [...new Set([...drafts.map(d => d.jobId), ...state.selectedInputDraftIds])],
    }));
    return drafts.map(d => d.jobId);
  },

  addImportDraftsFromSources: (sources: ImportSourceDraft[]) => {
    const drafts = sources.map((source) => ({
      jobId: globalThis.crypto.randomUUID(),
      kind: 'import' as const,
      label: source.label,
      category: 'digital' as EntityKind,
      sourcePath: source.sourcePath,
      fileName: source.fileName,
      stage: 'draft' as const,
      progressMessage: 'Import draft',
      expanded: false,
      spatialTrait: null,
      temporalTrait: null,
      blobAttachment: null,
      tagLabels: source.tagLabels,
    }));
    set(state => ({
      inputDrafts: [...drafts, ...state.inputDrafts.map(d => ({ ...d, expanded: false }))],
      selectedInputDraftIds: [...new Set([...drafts.map(d => d.jobId), ...state.selectedInputDraftIds])],
    }));
    return drafts.map(d => d.jobId);
  },

  updateInputDraft: (jobId, patch) => {
    set(state => ({
      inputDrafts: state.inputDrafts.map(d => d.jobId === jobId ? { ...d, ...patch } : d),
    }));
  },

  toggleInputDraftExpanded: (jobId) => {
    set(state => ({
      inputDrafts: state.inputDrafts.map(d => d.jobId === jobId ? { ...d, expanded: !d.expanded } : d),
    }));
  },

  setAllInputDraftsExpanded: (expanded) => {
    set(state => ({
      inputDrafts: state.inputDrafts.map(d => ({ ...d, expanded })),
    }));
  },

  removeInputDraft: (jobId) => {
    set(state => ({
      inputDrafts: state.inputDrafts.filter(d => d.jobId !== jobId),
      selectedInputDraftIds: state.selectedInputDraftIds.filter(id => id !== jobId),
    }));
  },

  clearInputDrafts: () => set({
    inputDrafts: [],
    selectedInputDraftIds: [],
  }),

  toggleSelectedInputDraft: (jobId) => {
    set(state => ({
      selectedInputDraftIds: state.selectedInputDraftIds.includes(jobId)
        ? state.selectedInputDraftIds.filter(id => id !== jobId)
        : [...state.selectedInputDraftIds, jobId],
    }));
  },

  setSelectedInputDraftIds: (jobIds) => set({ selectedInputDraftIds: jobIds }),

  submitInputDraft: async (jobId) => {
    const draft = get().inputDrafts.find(d => d.jobId === jobId);
    if (!draft) return;
    const trimmed = draft.label.trim();
    if (!trimmed) {
      get().updateInputDraft(jobId, {
        stage: 'error',
        progressMessage: 'Label is required',
        error: 'Label is required.',
      });
      return;
    }

    const hasCreateBlobSource = draft.kind === 'create'
      && Boolean(draft.blobAttachment || draft.sourcePath || draft.fileName || draft.bytes);

    if (draft.kind === 'create' && !hasCreateBlobSource) {
      get().updateInputDraft(jobId, {
        stage: 'creating_entity',
        progressMessage: 'Creating entity',
        error: undefined,
      });
      try {
        const entityId = await get().createEntity(draft.category, trimmed);
        await attachDraftTraits(entityId, draft.spatialTrait, draft.temporalTrait, get);
        await attachDraftTags(entityId, draft.tagLabels, get);
        get().selectEntity(entityId);
        get().updateInputDraft(jobId, {
          label: trimmed,
          stage: 'ready',
          progressMessage: 'Entity created',
          entityId,
          error: undefined,
        });
        await get().fetchStorageHealth();
      } catch (e) {
        get().updateInputDraft(jobId, {
          stage: 'error',
          progressMessage: 'Entity creation failed',
          error: String(e),
        });
      }
      return;
    }

    const sourcePath = draft.kind === 'import'
      ? (draft.sourcePath ?? null)
      : (draft.blobAttachment?.sourcePath ?? draft.sourcePath ?? null);
    const fileName = draft.kind === 'import'
      ? (draft.fileName ?? null)
      : (draft.blobAttachment?.fileName ?? draft.fileName ?? null);
    const bytes = draft.kind === 'import'
      ? (draft.bytes ?? null)
      : ((draft.blobAttachment?.sourcePath ?? draft.sourcePath) ? null : (draft.blobAttachment?.bytes ?? draft.bytes ?? null));

    if (!sourcePath && !bytes) {
      get().updateInputDraft(jobId, {
        stage: 'error',
        progressMessage: 'No import source provided',
        error: 'No import source provided.',
      });
      return;
    }

    get().updateInputDraft(jobId, {
      label: trimmed,
      stage: 'queued',
      progressMessage: 'Queued for import',
      error: undefined,
    });
    try {
      await invoke('begin_import', {
        jobId,
        label: trimmed,
        category: draft.category,
        sourcePath,
        fileName,
        bytes,
      });
    } catch (e) {
      get().updateInputDraft(jobId, {
        stage: 'error',
        progressMessage: 'Import failed to start',
        error: String(e),
      });
    }
  },

  requestImportFilePick: () => {
    set(state => ({ inputPickerRequestToken: state.inputPickerRequestToken + 1 }));
  },

  fetchStorageHealth: async () => {
    set({ storageHealthLoading: true });
    try {
      const storageHealth = await invoke<StorageHealth>('get_storage_health');
      set({ storageHealth, storageHealthLoading: false });
    } catch (e) {
      logFrontend('error', 'fetchStorageHealth error: ' + String(e));
      set({ storageHealthLoading: false });
    }
  },

  runInputGc: async () => {
    set({ gcRunning: true });
    try {
      const result = await invoke<GcSweepStats>('run_manual_gc');
      set({ gcRunning: false, lastGcResult: result });
      await get().fetchStorageHealth();
      await get().fetchBlobTraits();
      await get().fetchEntities();
      return result;
    } catch (e) {
      logFrontend('error', 'runInputGc error: ' + String(e));
      set({ gcRunning: false });
      return null;
    }
  },

  updateNodePosition: (id, x, y) => {
    set(state => ({
      nodePositions: { ...state.nodePositions, [id]: { x, y } }
    }));
  },

  fetchEntities: async () => {
    set({ isLoading: true });
    try {
      const records = await invoke<Entity[]>('list_entities');
      set({ entities: records, isLoading: false });
    } catch (e) {
      logFrontend('error', 'fetchEntities error: ' + String(e));
      set({ isLoading: false });
    }
  },

  fetchSpatialTraits: async () => {
    try {
      const traits = await invoke<SpatialTrait[]>('get_spatial_traits');
      set({ spatialTraits: traits });
    } catch (e) {
      logFrontend('error', 'fetchSpatialTraits error: ' + String(e));
    }
  },

  fetchBlobTraits: async () => {
    try {
      const traits = await invoke<BlobTrait[]>('get_blob_traits');
      const traitsWithUrls = await Promise.all(traits.map(async t => {
        try {
          const url = await invoke<string>('get_presigned_url', { storageId: t.storage_id });
          return { ...t, localUrl: url };
        } catch (e) {
          return t;
        }
      }));
      set({ blobTraits: traitsWithUrls });
    } catch (e) {
      logFrontend('error', 'fetchBlobTraits error: ' + String(e));
    }
  },

  fetchKeyValueTraits: async () => {
    try {
      const traits = await invoke<KeyValueTrait[]>('get_key_value_traits');
      set({ keyValueTraits: traits });
    } catch (e) {
      logFrontend('error', 'fetchKeyValueTraits error: ' + String(e));
    }
  },

  fetchTableTraits: async () => {
    try {
      const traits = await invoke<TableTrait[]>('get_table_traits');
      set({ tableTraits: traits });
    } catch (e) {
      logFrontend('error', 'fetchTableTraits error: ' + String(e));
    }
  },

  fetchTemporalTraits: async () => {
    try {
      const traits = await invoke<TemporalTrait[]>('get_temporal_traits');
      set({ temporalTraits: traits });
    } catch (e) {
      logFrontend('error', 'fetchTemporalTraits error: ' + String(e));
    }
  },

  saveTemporalTrait: async (trait) => {
    try {
      // Tauri v2: parameter names must be camelCase on the JS side
      // (Tauri auto-converts eventAt → event_at for the Rust handler)
      await invoke('save_temporal_trait', {
        owner: trait.owner,
        eventAt: trait.event_at ?? null,
        startsAt: trait.starts_at ?? null,
        endsAt: trait.ends_at ?? null,
        recurrence: trait.recurrence ?? null,
      });
      await get().fetchTemporalTraits();
    } catch (e) {
      logFrontend('error', 'saveTemporalTrait error: ' + String(e));
      throw e;
    }
  },

  saveSpatialTrait: async (trait) => {
    try {
      await invoke('save_spatial_trait', {
        owner: trait.owner,
        lat: trait.lat,
        lng: trait.lng,
        alt: trait.alt,
        heading: trait.heading,
        bbox: trait.bbox,
        projection: trait.projection,
      });
      await get().fetchSpatialTraits();
    } catch (e) {
      logFrontend('error', 'saveSpatialTrait error: ' + String(e));
      throw e;
    }
  },

  fetchEdges: async () => {
    try {
      const edges = await invoke<GraphEdge[]>('get_edges');
      const allTagEdges = edges.filter(e => e.label === 'tagged_as');
      set({ edges, allTagEdges });
    } catch (e) {
      logFrontend('error', 'fetchEdges error: ' + String(e));
    }
  },

  selectEntity: (id) => {
    set({ selectedEntityId: id, selectedIds: id ? [id] : [], selectedEntityEdges: [] });
    if (id) {
      get().queryContext(id);
      get().fetchEntityEdges(id);
      get().fetchTemporalTraits();
      // Phase 44: auto-expand neighborhood in context mode
      if (get().graphMode === 'context') {
        get().expandContext(id);
      }
    }
  },

  setSelectedIds: (ids) => {
    const primary = ids.length > 0 ? ids[ids.length - 1] : null;
    set({ selectedIds: ids, selectedEntityId: primary });
    if (primary) {
      get().queryContext(primary);
      get().fetchEntityEdges(primary);
      get().fetchTemporalTraits();
      // Phase 44: auto-expand neighborhood in context mode
      if (get().graphMode === 'context') {
        get().expandContext(primary);
      }
    }
  },

  toggleSelection: (id) => {
    const { selectedIds } = get();
    const next = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
    get().setSelectedIds(next);
  },

  clearSelection: () => {
    set({ selectedIds: [], selectedEntityId: null });
  },

  queryContext: async (contextId) => {
    try {
      const related = await invoke<Entity[]>('query_context', { contextId });
      set({ contextEntities: related });
    } catch (e) {
      logFrontend('error', 'queryContext error: ' + String(e));
    }
  },

  // Phase 44: merge N-hop neighborhood into the visible graph (non-destructive)
  expandContext: async (entityId) => {
    const { hopCount } = get();
    try {
      const result = await invoke<{ entities: Entity[]; edges: GraphEdge[] }>(
        'get_entity_neighborhood',
        { entityId, hops: hopCount }
      );
      set(state => {
        const existingEntityIds = new Set(state.entities.map(e => e.id));
        const newEntities = result.entities.filter(e => !existingEntityIds.has(e.id));
        const existingEdgeKeys = new Set(
          state.edges.map(e => `${e.from}|${e.to}|${e.label}`)
        );
        const newEdges = result.edges.filter(
          e => !existingEdgeKeys.has(`${e.from}|${e.to}|${e.label}`)
        );
        return {
          entities: [...state.entities, ...newEntities],
          edges: [...state.edges, ...newEdges],
        };
      });
    } catch (e) {
      logFrontend('error', 'expandContext error: ' + String(e));
    }
  },

  fetchAllEntities: async () => {
    // On first call (e.g. app bootstrap) the backend may still be initialising.
    // Retry for up to ~10 s so the Load button becomes active as soon as the
    // backend is ready, without the user having to do anything.
    for (let attempt = 0; attempt < 35; attempt++) {
      try {
        const [records, allEdges] = await Promise.all([
          invoke<Entity[]>('list_entities'),
          invoke<GraphEdge[]>('get_edges'),
        ]);
        void get().fetchKeyValueTraits();
        void get().fetchTableTraits();
        const tagEdges = allEdges.filter(e => e.label === 'tagged_as');
        set({ allEntities: records, allTagEdges: tagEdges, backendReady: true });
        return;
      } catch {
        if (attempt < 34) await new Promise(r => setTimeout(r, 300));
      }
    }
    logFrontend('error', 'fetchAllEntities: backend did not become ready within timeout');
  },

  loadExactIds: async (ids: string[]) => {
    if (ids.length === 0) return;
    set({ isLoading: true });
    // Fetch all entities and filter to exactly the queried IDs — no BFS expansion.
    let fetchedEntities: Entity[] = [];
    try {
      const all = await invoke<Entity[]>('list_entities');
      const idSet = new Set(ids);
      fetchedEntities = all.filter(e => idSet.has(e.id));
    } catch (e) {
      logFrontend('error', 'loadExactIds list_entities error: ' + String(e));
    }
    // Fetch only the edges that connect entities within the result set.
    let crossEdges: GraphEdge[] = [];
    try {
      const allEdges = await invoke<GraphEdge[]>('get_edges');
      const idSet = new Set(ids);
      crossEdges = allEdges.filter(e => idSet.has(e.from) && idSet.has(e.to));
    } catch { /* edges optional */ }
    set({ entities: fetchedEntities, edges: crossEdges, graphMode: 'context', isLoading: false });
  },

  clearGraph: () => {
    set({
      entities: [],
      edges: [],
      selectedEntityId: null,
      selectedIds: [],
      contextEntities: [],
      selectedEntityEdges: [],
      graphMode: 'context',
    });
  },

  loadFullGraph: async () => {
    logFrontend('info', '[graph/load] loadFullGraph started — setting graphLoading=true');
    set({ graphMode: 'full', isLoading: true, graphLoading: true });
    try {
      const t0 = performance.now();
      const [entities, edges] = await Promise.all([
        invoke<Entity[]>('list_entities'),
        invoke<GraphEdge[]>('get_edges'),
      ]);
      void get().fetchKeyValueTraits();
      void get().fetchTableTraits();
      const fetchMs = Math.round(performance.now() - t0);
      const allTagEdges = edges.filter(e => e.label === 'tagged_as');
      logFrontend('info',
        `[graph/load] fetch done in ${fetchMs}ms — entities=${entities.length} edges=${edges.length} tagEdges=${allTagEdges.length}`
      );
      logFrontend('info', '[graph/load] setting graphLoading=false (atomic with data)');
      set({ entities, edges, allTagEdges, allEntities: entities, isLoading: false, graphLoading: false, backendReady: true });
      logFrontend('info', '[graph/load] store update committed');
    } catch (e: any) {
      logFrontend('error', '[graph/load] loadFullGraph failed: ' + String(e));
      set({ isLoading: false, graphLoading: false });
    }
  },

  setHopCount: (n) => set({ hopCount: Math.min(5, Math.max(0, n)) }),

  searchEntitiesAction: async (query, lang) => {
    try {
      return await invoke<Entity[]>('search_entities', {
        query,
        lang: lang ?? null,
      });
    } catch (e) {
      logFrontend('error', 'searchEntities error: ' + String(e));
      return [];
    }
  },

  fetchEntityEdges: async (entityId) => {
    try {
      const edges = await invoke<GraphEdge[]>('get_entity_edges', { entityId });
      set({ selectedEntityEdges: edges });
    } catch (e) {
      logFrontend('error', 'fetchEntityEdges error: ' + String(e));
    }
  },

  // ── Write actions ────────────────────────────────────────────────────────

  createEntity: async (kind, label) => {
    const id = await invoke<string>('create_entity', { category: kind, label });
    // Auto-create canonical notes file for every new entity
    invoke('create_entity_notes', { entityId: id }).catch(() => {});
    await get().fetchEntities();
    await get().fetchKeyValueTraits();
    await get().fetchStorageHealth();
    return id;
  },

  saveEntityData: async (id, values) => {
    await invoke('save_entity_data', { id, values });
    await get().fetchKeyValueTraits();
  },

  saveTableTrait: async (owner, namespace, columns, rows) => {
    const t = await invoke<TableTrait>('save_table_trait', { owner, namespace, columns, rows });
    await get().fetchTableTraits();
    return t;
  },

  deleteTableTrait: async (tableTraitId) => {
    await invoke('delete_table_trait', { tableTraitId });
    await get().fetchTableTraits();
  },

  deleteEntity: async (id) => {
    await invoke('delete_entity', { id });
    set(state => ({
      selectedEntityId: state.selectedEntityId === id ? null : state.selectedEntityId,
      selectedIds: state.selectedIds.filter(x => x !== id),
      selectedEntityEdges: state.selectedEntityId === id ? [] : state.selectedEntityEdges
    }));
    await get().fetchEntities();
    await get().fetchKeyValueTraits();
  },

  deleteEntities: async (ids) => {
    await Promise.all(ids.map(id => invoke('delete_entity', { id })));
    set(state => ({
      selectedIds: state.selectedIds.filter(x => !ids.includes(x)),
      selectedEntityId: ids.includes(state.selectedEntityId ?? '') ? null : state.selectedEntityId
    }));
    await get().fetchEntities();
    await get().fetchKeyValueTraits();
  },

  tagEntity: async (targetId, tagLabel) => {
    await invoke('tag_entity', { targetId, tagLabel });
    await get().fetchEdges();
    if (get().selectedEntityId) await get().fetchEntityEdges(get().selectedEntityId!);
    await get().fetchEntities(); // tag entity may be new
    await get().fetchKeyValueTraits();
  },

  tagEntities: async (targetIds, tagLabel) => {
    await Promise.all(targetIds.map(id => invoke('tag_entity', { targetId: id, tagLabel })));
    await get().fetchEdges();
    await get().fetchEntities();
    await get().fetchKeyValueTraits();
    const primary = get().selectedEntityId;
    if (primary) await get().fetchEntityEdges(primary);
  },

  untagEntity: async (targetId, tagLabel) => {
    await invoke('untag_entity', { targetId, tagLabel });
    await get().fetchEdges();
    if (get().selectedEntityId) await get().fetchEntityEdges(get().selectedEntityId!);
  },

  saveBlobContent: async (owner, content) => {
    await invoke('save_blob_content', { owner, content });
    await get().fetchBlobTraits();
    await get().fetchEntities();
  },

  addEdgeAction: async (fromId, toId, label) => {
    await invoke('add_edge', { fromId, toId, label });
    await get().fetchEdges();
    if (get().selectedEntityId) await get().fetchEntityEdges(get().selectedEntityId!);
  },

  removeEdge: async (fromId, toId, label?) => {
    await invoke('remove_edge', { fromId, toId, label: label ?? null });
    await get().fetchEdges();
    if (get().selectedEntityId) await get().fetchEntityEdges(get().selectedEntityId!);
  },

  toggleRegions: () => {
    set(state => ({ showRegions: !state.showRegions }));
  },

  toggleFilterKind: (kind) => {
    set(state => {
      const { filterKinds } = state;
      const next = filterKinds.includes(kind)
        ? filterKinds.filter(k => k !== kind)
        : [...filterKinds, kind];
      return { filterKinds: next };
    });
  },

  setFilterKinds: (kinds) => {
    set({ filterKinds: kinds });
  },

  toggleFilterEdgeLabel: (label) => {
    set(state => {
      const { filterEdgeLabels } = state;
      const next = filterEdgeLabels.includes(label)
        ? filterEdgeLabels.filter(l => l !== label)
        : [...filterEdgeLabels, label];
      return { filterEdgeLabels: next };
    });
  },

  setHighlightedPath: (path, edgeKeys) => {
    set({ highlightedPath: path, highlightedEdgeKeys: edgeKeys });
  },

  clearHighlightedPath: () => {
    set({ highlightedPath: [], highlightedEdgeKeys: new Set() });
  },

  setOverlayEdges: (edges) => {
    set({ overlayEdges: edges });
  },

  toggleShowDerivedEdges: () => {
    set(state => ({ showDerivedEdges: !state.showDerivedEdges }));
  },

  // ── Phase 43: Multilingual labels ────────────────────────────────────────

  setActiveLocale: (lang) => {
    set({ activeLocale: lang, labelTraits: [] });
  },

  fetchAllLabelTraits: async () => {
    try {
      const traits = await invoke<LabelTrait[]>('get_all_label_traits');
      set({ allLabelTraits: traits });
    } catch (e) {
      logFrontend('error', 'fetchAllLabelTraits error: ' + String(e));
    }
  },

  fetchLabelTraits: async (entityId) => {
    try {
      const traits = await invoke<LabelTrait[]>('get_label_traits', { entityId });
      set({ labelTraits: traits });
    } catch (e) {
      logFrontend('error', 'fetchLabelTraits error: ' + String(e));
      set({ labelTraits: [] });
    }
  },

  saveLabelTrait: async (trait) => {
    await invoke('save_label_trait', {
      id: trait.id,
      owner: trait.owner,
      lang: trait.lang,
      text: trait.text,
    });
    await get().fetchLabelTraits(trait.owner);
    await get().fetchAllLabelTraits();
  },

  deleteLabelTrait: async (id) => {
    const owner = get().labelTraits.find(t => t.id === id)?.owner ?? '';
    await invoke('delete_label_trait', { id });
    if (owner) await get().fetchLabelTraits(owner);
    await get().fetchAllLabelTraits();
  },

  // ── Phase 45: Relationship types ─────────────────────────────────────────

  fetchRelationshipTypes: async () => {
    try {
      const types = await invoke<RelationshipType[]>('list_relationship_types');
      set({ relationshipTypes: types });
    } catch (e) {
      logFrontend('error', 'fetchRelationshipTypes error: ' + String(e));
    }
  },

  saveRelationshipType: async (rel) => {
    await invoke('save_relationship_type', {
      id: rel.id ?? null,
      label: rel.label,
      transitive: rel.transitive,
      symmetric: rel.symmetric,
      inheritsTraits: rel.inherits_traits,
      visible: rel.visible,
      flow: rel.flow ?? null,
      routing: rel.routing ?? null,
      color: rel.color ?? null,
    });
    await get().fetchRelationshipTypes();
    await get().fetchEdges();
  },

  deleteRelationshipType: async (label) => {
    await invoke('delete_relationship_type', { label });
    await get().fetchRelationshipTypes();
  },

  getEffectiveSpatialTrait: async (entityId) => {
    try {
      return await invoke<SpatialTrait | null>('get_effective_spatial_trait', { entityId });
    } catch (e) {
      logFrontend('error', 'getEffectiveSpatialTrait error: ' + String(e));
      return null;
    }
  },

  // ── Phase 44: History ────────────────────────────────────────────────────

  fetchEntityHistory: async (entityId) => {
    try {
      const snaps = await invoke<EntitySnapshot[]>('get_entity_history', { entityId });
      set({ entityHistory: snaps });
    } catch (e) {
      logFrontend('error', 'fetchEntityHistory error: ' + String(e));
      set({ entityHistory: [] });
    }
  },

  fetchTraitHistory: async (entityId) => {
    try {
      const snaps = await invoke<TraitSnapshot[]>('get_trait_history', { entityId });
      set({ traitHistory: snaps });
    } catch (e) {
      logFrontend('error', 'fetchTraitHistory error: ' + String(e));
      set({ traitHistory: [] });
    }
  },

  getEntityAsOf: async (entityId, timestamp) => {
    try {
      return await invoke<EntitySnapshot | null>('get_entity_as_of', { entityId, timestamp });
    } catch (e) {
      logFrontend('error', 'getEntityAsOf error: ' + String(e));
      return null;
    }
  },

  startListening: async () => {
    const unlistenReady = await listen('backend-ready', () => {
      set({ backendReady: true });
    });

    const unlistenEntity = await listen<EntityUpdateEvent>('entity-updated', (event) => {
      set({ lastEvent: event.payload });
      const store = useOsStore.getState();
      store.fetchEntities();
      store.fetchSpatialTraits();
      store.fetchBlobTraits();
      store.fetchKeyValueTraits();
      store.fetchTableTraits();
      store.fetchTemporalTraits();
      store.fetchAllLabelTraits();
      store.fetchAllEntities();
      store.fetchStorageHealth();
    });

    const unlistenGraph = await listen<GraphUpdateEvent>('graph-updated', () => {
      const store = useOsStore.getState();
      store.fetchEdges();
      if (store.selectedEntityId) store.fetchEntityEdges(store.selectedEntityId);
    });

    const unlistenInputProgress = await listen<InputJobProgressEvent>('input-job-progress', (event) => {
      set(state => ({
        inputDrafts: state.inputDrafts.map(d => d.jobId === event.payload.job_id
          ? {
              ...d,
              stage: event.payload.stage,
              progressMessage: event.payload.message,
            }
          : d),
      }));
    });

    const unlistenInputFinished = await listen<InputJobFinishedEvent>('input-job-finished', (event) => {
      const payload = event.payload;
      const finishedDraft = get().inputDrafts.find(d => d.jobId === payload.job_id);
      set(state => ({
        inputDrafts: state.inputDrafts.map(d => d.jobId === payload.job_id
          ? {
            ...d,
            stage: payload.stage,
            progressMessage: payload.error ?? payload.message,
            entityId: payload.entity_id ?? undefined,
            error: payload.error ?? undefined,
          }
          : d),
      }));
      const store = useOsStore.getState();
      if (payload.entity_id) {
        const attachAndRefresh = async () => {
          if (finishedDraft && payload.stage === 'ready' && !payload.error) {
            try {
              await attachDraftTraits(payload.entity_id!, finishedDraft.spatialTrait, finishedDraft.temporalTrait, useOsStore.getState);
              await attachDraftTags(payload.entity_id!, finishedDraft.tagLabels, useOsStore.getState);
            } catch (e) {
              useOsStore.getState().updateInputDraft(payload.job_id, {
                stage: 'error',
                progressMessage: 'Trait attachment failed',
                error: String(e),
              });
            }
          }
          store.selectEntity(payload.entity_id!);
          await store.fetchStorageHealth();
        };
        void attachAndRefresh();
        return;
      }
      void store.fetchStorageHealth();
    });

    return () => {
      unlistenReady();
      unlistenEntity();
      unlistenGraph();
      unlistenInputProgress();
      unlistenInputFinished();
    };
  },
}));

async function attachDraftTraits(
  owner: string,
  spatialTrait: DraftSpatialTrait | null,
  temporalTrait: DraftTemporalTrait | null,
  getStore: typeof useOsStore.getState,
) {
  const store = getStore();
  if (spatialTrait) {
    await store.saveSpatialTrait({
      owner,
      lat: spatialTrait.lat,
      lng: spatialTrait.lng,
      alt: spatialTrait.alt,
      heading: spatialTrait.heading,
      bbox: spatialTrait.bbox,
      projection: spatialTrait.projection,
    });
  }
  if (temporalTrait) {
    await store.saveTemporalTrait({
      owner,
      event_at: temporalTrait.event_at,
      starts_at: temporalTrait.starts_at,
      ends_at: temporalTrait.ends_at,
      recurrence: temporalTrait.recurrence,
    });
  }
}

async function attachDraftTags(
  owner: string,
  tagLabels: string[],
  getStore: typeof useOsStore.getState,
) {
  if (tagLabels.length === 0) return;
  const store = getStore();
  for (const tagLabel of tagLabels) {
    const trimmed = tagLabel.trim();
    if (!trimmed) continue;
    await store.tagEntity(owner, trimmed);
  }
}
