export type EntityKind = "physical" | "digital" | "abstract" | "persona";

export interface Entity {
  id: string;
  category: EntityKind;
  label: string;
  lang_canonical: string;
  metadata: Record<string, any>;
  deleted_at: string | null;
}

/** Phase 43: translated label for an entity in a specific IETF BCP 47 language. */
export interface LabelTrait {
  id: string;
  owner: string;
  lang: string;
  text: string;
}

export interface SpatialTrait {
  id: string;
  owner: string;
  lat: number;
  lng: number;
  alt: number;
  heading: number;
  bbox: number[] | null;
  projection: string;
}

export interface BlobTrait {
  id: string;
  owner: string;
  filename: string;
  storage_id: string;
  bucket: string;
  mime: string;
  hash: string;
  size: number;
  localUrl?: string;
}

/** Temporal trait — three event shapes:
 *  1. Point event:     event_at set, starts_at/ends_at null.
 *  2. Span event:      starts_at + ends_at set, event_at null.
 *  3. Recurring event: any of the above + recurrence (iCal RRULE string).
 */
export interface TemporalTrait {
  id: string;
  owner: string;
  event_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  recurrence: string | null;
}

export type DraftSpatialTrait = Omit<SpatialTrait, "id" | "owner">;
export type DraftTemporalTrait = Omit<TemporalTrait, "id" | "owner">;

export interface AnalyticsTrait {
  id: string;
  owner: string;
  formula: string;
  data_source: string;
  params: Record<string, any>;
}

export interface ContextProfile {
  id: string;
  label: string;
  allowed_edges: string[];
  max_depth: number;
}

export type EdgeFlow    = 'none' | 'down' | 'right' | 'up' | 'left';
export type EdgeRouting = 'straight' | 'step' | 'arc';

/** Phase 45: semantic definition of a relationship label. */
export interface RelationshipType {
  id: string;
  label: string;
  transitive: boolean;
  symmetric: boolean;
  inherits_traits: boolean;
  /** When false, edges of this type are hidden in the graph view. Default true. */
  visible: boolean;
  flow:    EdgeFlow    | null;
  routing: EdgeRouting | null;
  color:   string      | null;
}

/** Phase 45: full edge record with optional payload fields. */
export interface EdgeRecord {
  from: string;
  to: string;
  label: string;
  strength: number | null;
  latency: number | null;
  metadata: Record<string, any> | null;
}

/** Phase 44: timestamped full-copy snapshot of an entity (entity_history table). */
export interface EntitySnapshot {
  id: string;
  entity_id: string;
  category: EntityKind;
  label: string;
  metadata: Record<string, any>;
  deleted_at: string | null;
  changed_at: string;
}

/** Phase 44: timestamped snapshot of any trait (trait_history table). */
export interface TraitSnapshot {
  id: string;
  entity_id: string;
  trait_type: string;
  data: Record<string, any>;
  changed_at: string;
}

export type InputJobKind = "create" | "import";

export type InputJobStage =
  | "draft"
  | "queued"
  | "inspecting"
  | "storing_blob"
  | "creating_entity"
  | "attaching_blob_trait"
  | "ready"
  | "error";

export interface InputDraft {
  jobId: string;
  kind: InputJobKind;
  label: string;
  category: EntityKind;
  sourcePath?: string;
  fileName?: string;
  mime?: string;
  size?: number;
  bytes?: number[];
  stage: InputJobStage;
  progressMessage: string;
  expanded: boolean;
  entityId?: string;
  error?: string;
  spatialTrait: DraftSpatialTrait | null;
  temporalTrait: DraftTemporalTrait | null;
  blobAttachment: PickedInputFile | null;
  tagLabels: string[];
}

export interface PickedInputFile {
  fileName: string;
  bytes: number[];
  mime?: string;
  size: number;
  sourcePath?: string;
}

export interface ImportSourceDraft {
  sourcePath: string;
  fileName: string;
  label: string;
  tagLabels: string[];
}

export interface PathCompletion {
  path: string;
  display: string;
  is_dir: boolean;
}

export interface StorageHealth {
  live_entity_count: number;
  soft_deleted_entity_count: number;
  edge_count: number;
  blob_trait_count: number;
  unique_blob_count: number;
  referenced_blob_bytes: number;
  blob_store_file_count: number;
  blob_store_bytes: number;
}

export interface GcSweepStats {
  expired_entities: number;
  swept_entities: number;
  removed_blob_traits: number;
  removed_blobs: number;
  reclaimed_bytes: number;
}

export type TerminalSessionKind = "shell" | "sql" | "prolog";
export type TerminalSessionStatus = "ready" | "busy" | "closed";

export interface TerminalSession {
  id: string;
  kind: TerminalSessionKind;
  title: string;
  prompt: string;
  transcript: string;
  currentInput: string;
  cursor: number;
  history: string[];
  historyIndex: number | null;
  status: TerminalSessionStatus;
  visible: boolean;
}
