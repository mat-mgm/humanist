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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    #[serde(skip_serializing)]
    pub id: String,
    pub kind: EntityKind,
    pub label: String,
    pub tags: Vec<String>,
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
