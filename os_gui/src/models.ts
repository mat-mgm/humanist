export type EntityKind = "physical" | "digital" | "abstract" | "agent" | "blob";

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
