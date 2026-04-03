import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Entity, SpatialTrait, BlobTrait } from './models';

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

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

// ── Store definition ─────────────────────────────────────────────────────────

interface OsStore {
  // Data
  entities: Entity[];
  spatialTraits: SpatialTrait[];
  blobTraits: BlobTrait[];
  edges: GraphEdge[];
  selectedEntityId: string | null;
  contextEntities: Entity[];
  selectedEntityEdges: GraphEdge[];

  // UI flags
  isLoading: boolean;
  lastEvent: EntityUpdateEvent | null;
  nodePositions: Record<string, { x: number, y: number }>;

  // Actions — read
  updateNodePosition: (id: string, x: number, y: number) => void;
  fetchEntities: () => Promise<void>;
  fetchSpatialTraits: () => Promise<void>;
  fetchBlobTraits: () => Promise<void>;
  fetchEdges: () => Promise<void>;
  selectEntity: (id: string | null) => void;
  queryContext: (contextId: string) => Promise<void>;
  fetchEntityEdges: (entityId: string) => Promise<void>;
  startListening: () => Promise<() => void>;

  // Actions — write
  createEntity: (kind: string, label: string) => Promise<string>;
  updateMetadata: (id: string, metadata: Record<string, any>) => Promise<void>;
  deleteEntity: (id: string) => Promise<void>;
  tagEntity: (targetId: string, tagLabel: string) => Promise<void>;
  untagEntity: (targetId: string, tagLabel: string) => Promise<void>;
  addEdgeAction: (fromId: string, toId: string, label: string) => Promise<void>;
  removeEdge: (fromId: string, toId: string, label?: string) => Promise<void>;
}

export const useOsStore = create<OsStore>((set, get) => ({
  entities: [],
  spatialTraits: [],
  blobTraits: [],
  edges: [],
  selectedEntityId: null,
  contextEntities: [],
  selectedEntityEdges: [],
  isLoading: false,
  lastEvent: null,
  nodePositions: {},

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
        } catch(e) {
          return t;
        }
      }));
      set({ blobTraits: traitsWithUrls });
    } catch (e) {
      console.error('fetchBlobTraits error:', e);
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
    set({ selectedEntityId: id, selectedEntityEdges: [] });
    if (id) {
      get().queryContext(id);
      get().fetchEntityEdges(id);
    }
  },

  queryContext: async (contextId) => {
    try {
      const related = await invoke<Entity[]>('query_context', { contextId });
      set({ contextEntities: related });
    } catch (e) {
      console.error('queryContext error:', e);
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
    set({ selectedEntityId: null, selectedEntityEdges: [] });
    await get().fetchEntities();
  },

  tagEntity: async (targetId, tagLabel) => {
    await invoke('tag_entity', { targetId, tagLabel });
    await get().fetchEdges();
    if (get().selectedEntityId) await get().fetchEntityEdges(get().selectedEntityId!);
    await get().fetchEntities(); // tag entity may be new
  },

  untagEntity: async (targetId, tagLabel) => {
    await invoke('untag_entity', { targetId, tagLabel });
    await get().fetchEdges();
    if (get().selectedEntityId) await get().fetchEntityEdges(get().selectedEntityId!);
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

  startListening: async () => {
    const unlistenEntity = await listen<EntityUpdateEvent>('entity-updated', (event) => {
      set({ lastEvent: event.payload });
      const store = useOsStore.getState();
      store.fetchEntities();
      store.fetchSpatialTraits();
      store.fetchBlobTraits();
    });

    const unlistenGraph = await listen<GraphUpdateEvent>('graph-updated', () => {
      const store = useOsStore.getState();
      store.fetchEdges();
      if (store.selectedEntityId) store.fetchEntityEdges(store.selectedEntityId);
    });

    return () => {
      unlistenEntity();
      unlistenGraph();
    };
  },
}));
