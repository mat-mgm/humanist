export type EntityKind = "physical" | "digital" | "abstract" | "agent" | "blob" | "temporal";

export interface Entity {
  id: string;
  kind: EntityKind;
  label: string;
  metadata: Record<string, any>;
  deleted_at: string | null;
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
