import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { EdgeRecord, Entity, EntitySnapshot, LabelTrait, RelationshipType, SpatialTrait, BlobTrait, TemporalTrait, TraitSnapshot } from './models';

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

export type GraphEdge = EdgeRecord;

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

// ── Store definition ─────────────────────────────────────────────────────────

interface OsStore {
  // Data
  entities: Entity[];
  spatialTraits: SpatialTrait[];
  blobTraits: BlobTrait[];
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

  // UI flags
  isLoading: boolean;
  lastEvent: EntityUpdateEvent | null;
  nodePositions: Record<string, { x: number, y: number }>;
  showRegions: boolean;
  filterKinds: string[];
  filterEdgeLabels: string[];       // Edge labels to HIDE (empty = show all)   
  highlightedPath: string[];        // Node IDs on active BFS path
  highlightedEdgeKeys: Set<string>; // "from|to" keys of edges on active path
  activePtySession: string;

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
  setActivePtySession: (sessionId: string) => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
  fetchEntities: () => Promise<void>;
  fetchSpatialTraits: () => Promise<void>;
  fetchBlobTraits: () => Promise<void>;
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
  updateMetadata: (id: string, metadata: Record<string, any>) => Promise<void>;
  deleteEntity: (id: string) => Promise<void>;
  deleteEntities: (ids: string[]) => Promise<void>;
  tagEntity: (targetId: string, tagLabel: string) => Promise<void>;
  tagEntities: (targetIds: string[], tagLabel: string) => Promise<void>;
  untagEntity: (targetId: string, tagLabel: string) => Promise<void>;
  addEdgeAction: (fromId: string, toId: string, label: string) => Promise<void>;
  removeEdge: (fromId: string, toId: string, label?: string) => Promise<void>;
  saveBlobContent: (owner: string, content: string) => Promise<void>;
  toggleRegions: () => void;
  toggleFilterKind: (kind: string) => void;
  setFilterKinds: (kinds: string[]) => void;
  toggleFilterEdgeLabel: (label: string) => void;
  setHighlightedPath: (path: string[], edgeKeys: Set<string>) => void;
  clearHighlightedPath: () => void;

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
}

export const useOsStore = create<OsStore>((set, get) => ({
  entities: [],
  spatialTraits: [],
  blobTraits: [],
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
  isLoading: false,
  lastEvent: null,
  nodePositions: {},
  showRegions: true,
  filterKinds: [],
  filterEdgeLabels: [],
  highlightedPath: [],
  highlightedEdgeKeys: new Set<string>(),
  activePtySession: 'main',

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

  setActivePtySession: (sessionId) => set({ activePtySession: sessionId }),

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
      console.error('fetchEntities error:', e);
      set({ isLoading: false });
    }
  },

  fetchSpatialTraits: async () => {
    try {
      const traits = await invoke<SpatialTrait[]>('get_spatial_traits');
      set({ spatialTraits: traits });
    } catch (e) {
      console.error('fetchSpatialTraits error:', e);
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
      console.error('fetchBlobTraits error:', e);
    }
  },

  fetchTemporalTraits: async () => {
    try {
      const traits = await invoke<TemporalTrait[]>('get_temporal_traits');
      set({ temporalTraits: traits });
    } catch (e) {
      console.error('fetchTemporalTraits error:', e);
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
      console.error('saveTemporalTrait error:', e);
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
      console.error('saveSpatialTrait error:', e);
      throw e;
    }
  },

  fetchEdges: async () => {
    try {
      const edges = await invoke<GraphEdge[]>('get_edges');
      set({ edges });
    } catch (e) {
      console.error('fetchEdges error:', e);
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

  queryContext: async (contextId) => {
    try {
      const related = await invoke<Entity[]>('query_context', { contextId });
      set({ contextEntities: related });
    } catch (e) {
      console.error('queryContext error:', e);
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
      console.error('expandContext error:', e);
    }
  },

  fetchAllEntities: async () => {
    // On first call (e.g. app bootstrap) the backend may still be initialising.
    // Retry for up to ~10 s so the Load Full button becomes active as soon as the
    // backend is ready, without the user having to do anything.
    for (let attempt = 0; attempt < 35; attempt++) {
      try {
        const records = await invoke<Entity[]>('list_entities');
        set({ allEntities: records, backendReady: true });
        return;
      } catch {
        if (attempt < 34) await new Promise(r => setTimeout(r, 300));
      }
    }
    console.error('fetchAllEntities: backend did not become ready within timeout');
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
      console.error('loadExactIds list_entities error:', e);
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
    // Do NOT clear entities before the fetch — setting entities:[] triggers a
    // render with an empty ForceGraph2D while its simulation is still running,
    // which causes "The object can not be found here." from a stale callback.
    // Instead, switch mode and mark loading, then replace data in one update.
    set({ graphMode: 'full', isLoading: true });
    try {
      const [entities, edges] = await Promise.all([
        invoke<Entity[]>('list_entities'),
        invoke<GraphEdge[]>('get_edges'),
      ]);
      set({ entities, edges, isLoading: false });
    } catch (e: any) {
      console.error('loadFullGraph failed:', e);
      set({ isLoading: false });
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
      console.error('searchEntities error:', e);
      return [];
    }
  },

  fetchEntityEdges: async (entityId) => {
    try {
      const edges = await invoke<GraphEdge[]>('get_entity_edges', { entityId });
      set({ selectedEntityEdges: edges });
    } catch (e) {
      console.error('fetchEntityEdges error:', e);
    }
  },

  // ── Write actions ────────────────────────────────────────────────────────

  createEntity: async (kind, label) => {
    const id = await invoke<string>('create_entity', { kind, label });
    await get().fetchEntities();
    return id;
  },

  updateMetadata: async (id, metadata) => {
    await invoke('update_metadata', { id, metadata });
    await get().fetchEntities();
  },

  deleteEntity: async (id) => {
    await invoke('delete_entity', { id });
    set(state => ({
      selectedEntityId: state.selectedEntityId === id ? null : state.selectedEntityId,
      selectedIds: state.selectedIds.filter(x => x !== id),
      selectedEntityEdges: state.selectedEntityId === id ? [] : state.selectedEntityEdges
    }));
    await get().fetchEntities();
  },

  deleteEntities: async (ids) => {
    await Promise.all(ids.map(id => invoke('delete_entity', { id })));
    set(state => ({
      selectedIds: state.selectedIds.filter(x => !ids.includes(x)),
      selectedEntityId: ids.includes(state.selectedEntityId ?? '') ? null : state.selectedEntityId
    }));
    await get().fetchEntities();
  },

  tagEntity: async (targetId, tagLabel) => {
    await invoke('tag_entity', { targetId, tagLabel });
    await get().fetchEdges();
    if (get().selectedEntityId) await get().fetchEntityEdges(get().selectedEntityId!);
    await get().fetchEntities(); // tag entity may be new
  },

  tagEntities: async (targetIds, tagLabel) => {
    await Promise.all(targetIds.map(id => invoke('tag_entity', { targetId: id, tagLabel })));
    await get().fetchEdges();
    await get().fetchEntities();
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

  // ── Phase 43: Multilingual labels ────────────────────────────────────────

  setActiveLocale: (lang) => {
    set({ activeLocale: lang, labelTraits: [] });
  },

  fetchAllLabelTraits: async () => {
    try {
      const traits = await invoke<LabelTrait[]>('get_all_label_traits');
      set({ allLabelTraits: traits });
    } catch (e) {
      console.error('fetchAllLabelTraits error:', e);
    }
  },

  fetchLabelTraits: async (entityId) => {
    try {
      const traits = await invoke<LabelTrait[]>('get_label_traits', { entityId });
      set({ labelTraits: traits });
    } catch (e) {
      console.error('fetchLabelTraits error:', e);
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
      console.error('fetchRelationshipTypes error:', e);
    }
  },

  saveRelationshipType: async (rel) => {
    await invoke('save_relationship_type', {
      id: rel.id ?? null,
      label: rel.label,
      transitive: rel.transitive,
      symmetric: rel.symmetric,
      inheritsTraits: rel.inherits_traits,
    });
    await get().fetchRelationshipTypes();
  },

  deleteRelationshipType: async (label) => {
    await invoke('delete_relationship_type', { label });
    await get().fetchRelationshipTypes();
  },

  getEffectiveSpatialTrait: async (entityId) => {
    try {
      return await invoke<SpatialTrait | null>('get_effective_spatial_trait', { entityId });
    } catch (e) {
      console.error('getEffectiveSpatialTrait error:', e);
      return null;
    }
  },

  // ── Phase 44: History ────────────────────────────────────────────────────

  fetchEntityHistory: async (entityId) => {
    try {
      const snaps = await invoke<EntitySnapshot[]>('get_entity_history', { entityId });
      set({ entityHistory: snaps });
    } catch (e) {
      console.error('fetchEntityHistory error:', e);
      set({ entityHistory: [] });
    }
  },

  fetchTraitHistory: async (entityId) => {
    try {
      const snaps = await invoke<TraitSnapshot[]>('get_trait_history', { entityId });
      set({ traitHistory: snaps });
    } catch (e) {
      console.error('fetchTraitHistory error:', e);
      set({ traitHistory: [] });
    }
  },

  getEntityAsOf: async (entityId, timestamp) => {
    try {
      return await invoke<EntitySnapshot | null>('get_entity_as_of', { entityId, timestamp });
    } catch (e) {
      console.error('getEntityAsOf error:', e);
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
      store.fetchTemporalTraits();
      store.fetchAllLabelTraits();
      store.fetchAllEntities();
    });

    const unlistenGraph = await listen<GraphUpdateEvent>('graph-updated', () => {
      const store = useOsStore.getState();
      store.fetchEdges();
      if (store.selectedEntityId) store.fetchEntityEdges(store.selectedEntityId);
    });

    return () => {
      unlistenReady();
      unlistenEntity();
      unlistenGraph();
    };
  },
}));
