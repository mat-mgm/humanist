use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityKind {
    Physical,
    Digital,
    Abstract,
    Persona,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: String,
    pub category: EntityKind,
    pub label: String,
    #[serde(default = "default_lang_canonical")]
    pub lang_canonical: String,
    pub deleted_at: Option<String>,
}

fn default_lang_canonical() -> String {
    "en".to_string()
}

/// A translated label for an entity in a specific language.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelTrait {
    pub id: String,
    pub owner: String,
    /// IETF BCP 47 language tag, e.g. "en", "de", "pt".
    pub lang: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialTrait {
    pub id: String,
    pub owner: String,
    pub lat: f64,
    pub lng: f64,
    pub alt: f64,
    pub heading: f64,
    pub bbox: Option<Vec<f64>>,
    pub projection: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobTrait {
    pub id: String,
    pub owner: String,
    pub filename: String,
    pub storage_id: String,
    pub bucket: String,
    pub mime: String,
    pub hash: String,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValueTrait {
    pub id: String,
    pub owner: String,
    pub namespace: String,
    pub values: HashMap<String, serde_json::Value>,
}

impl KeyValueTrait {
    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.values.get(key)
    }

    pub fn insert(&mut self, key: impl Into<String>, value: serde_json::Value) {
        self.values.insert(key.into(), value);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableTrait {
    pub id: String,
    pub owner: String,
    pub namespace: String,
    pub columns: Vec<TableColumn>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
}

/// Represents a temporal event attached to an entity.
/// Three shapes are supported:
///   1. Point event:     event_at is set, starts_at/ends_at are None.
///   2. Span event:      starts_at + ends_at are set, event_at is None.
///   3. Recurring event: any of the above + recurrence holds an iCal RRULE string
///                        (e.g. "FREQ=WEEKLY;COUNT=10").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemporalTrait {
    pub id: String,
    pub owner: String,
    /// ISO 8601 instant for a momentaneous event.
    pub event_at: Option<String>,
    /// ISO 8601 start of a span event.
    pub starts_at: Option<String>,
    /// ISO 8601 end of a span event.
    pub ends_at: Option<String>,
    /// iCal RRULE recurrence rule (e.g. "FREQ=DAILY;COUNT=30").
    pub recurrence: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsTrait {
    pub id: String,
    pub owner: String,
    pub formula: String,
    pub data_source: String,
    pub params: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextProfile {
    pub id: String,
    pub label: String,
    pub allowed_edges: Vec<String>,
    #[serde(default = "default_max_depth")]
    pub max_depth: i64,
}

fn default_max_depth() -> i64 {
    2
}

/// Defines the semantic properties of a relationship label.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipType {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub transitive: bool,
    #[serde(default)]
    pub symmetric: bool,
    #[serde(default)]
    pub inherits_traits: bool,
    /// When false, edges of this type are hidden in the graph view.
    #[serde(default = "default_visible")]
    pub visible: bool,
    /// Layout flow direction: "none" | "down" | "right" | "up" | "left"
    #[serde(default)]
    pub flow: Option<String>,
    /// Edge routing style: "straight" | "step" | "arc"
    #[serde(default)]
    pub routing: Option<String>,
    /// Optional hex color override for edges of this type, e.g. "#ff6b6b"
    #[serde(default)]
    pub color: Option<String>,
}

fn default_visible() -> bool { true }

/// A full edge record including optional payload fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeRecord {
    pub from: String,
    pub to: String,
    pub label: String,
    pub strength: Option<f64>,
    pub latency: Option<i64>,
    pub metadata: Option<serde_json::Value>,
}

/// A timestamped full-copy snapshot of an entity, written on every save.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitySnapshot {
    pub id: String,
    pub entity_id: String,
    pub category: EntityKind,
    pub label: String,
    pub deleted_at: Option<String>,
    pub changed_at: String,
}

/// A timestamped full-copy snapshot of any trait, written on every save.
/// The `trait_type` discriminator is `"spatial"` or `"temporal"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraitSnapshot {
    pub id: String,
    pub entity_id: String,
    pub trait_type: String,
    pub data: serde_json::Value,
    pub changed_at: String,
}

/// A complete in-memory mirror of the domain state: every entity, trait, edge,
/// and relationship type the system holds. Used as the boundary type for
/// import/export and as the input to the Prolog fact serializer. Has no
/// dependency on Prolog or any storage backend.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DomainSnapshot {
    #[serde(default)]
    pub entities: Vec<Entity>,
    #[serde(default)]
    pub label_traits: Vec<LabelTrait>,
    #[serde(default)]
    pub spatial_traits: Vec<SpatialTrait>,
    #[serde(default)]
    pub temporal_traits: Vec<TemporalTrait>,
    #[serde(default)]
    pub blob_traits: Vec<BlobTrait>,
    #[serde(default)]
    pub key_value_traits: Vec<KeyValueTrait>,
    #[serde(default)]
    pub table_traits: Vec<TableTrait>,
    #[serde(default)]
    pub relationship_types: Vec<RelationshipType>,
    #[serde(default)]
    pub edges: Vec<EdgeRecord>,
    /// Optional sidecar entries describing where each blob's content can be
    /// loaded from on disk during import. Present in interchange snapshots,
    /// absent in pure in-memory snapshots.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blob_files: Vec<BlobFile>,
}

/// A pointer from a `BlobTrait` to a content file on disk. Used in the
/// interchange format so an importer knows which file holds the bytes for
/// a given blob. Paths are interpreted relative to the snapshot file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobFile {
    pub blob_id: String,
    pub relative_path: String,
    pub hash: String,
    pub mime: String,
}

/// The output of an import: an additive merge target. Has the same shape as
/// `DomainSnapshot` but is semantically distinct — applying a patch should
/// be idempotent (UPSERT semantics) rather than wholesale replacement.
pub type DomainPatch = DomainSnapshot;
