use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityKind {
    Physical,
    Digital,
    Abstract,
    Agent,
    Blob,
    Temporal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    #[serde(skip_serializing)]
    pub id: String,
    pub kind: EntityKind,
    pub label: String,
    pub metadata: HashMap<String, serde_json::Value>,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialTrait {
    pub id: String,
    pub owner: String,
    pub lat: f64,
    pub lng: f64,
    pub alt: f64,
    pub heading: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobTrait {
    pub id: String,
    pub owner: String,
    pub storage_id: String,
    pub bucket: String,
    pub mime: String,
    pub hash: String,
    pub size: i64,
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
