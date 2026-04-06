use async_trait::async_trait;
use surrealdb::engine::local::{Db, SurrealKv};
use surrealdb::Surreal;
use std::sync::Arc;
use std::path::PathBuf;

use crate::models::{Entity, SpatialTrait, TemporalTrait};
use crate::ports::GraphDatabase;

#[derive(Clone)]
pub struct SurrealDbAdapter {
    pub db: Arc<Surreal<Db>>,
}

impl SurrealDbAdapter {
    /// Opens (or creates) the shared on-disk database.
    /// Path: $HOME/.local/share/spatial-os/db
    /// Both the CLI and GUI call this, so they share the same data.
    pub async fn new() -> Result<Self, String> {
        let path = default_db_path();
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        let db = Surreal::new::<SurrealKv>(path).await.map_err(|e| e.to_string())?;
        db.use_ns("spatial_os").use_db("core").await.map_err(|e| e.to_string())?;
        
        let schema_ql = r#"
            DEFINE TABLE entity SCHEMAFULL;
            DEFINE FIELD kind ON entity TYPE string ASSERT $value IN ['physical', 'digital', 'abstract', 'agent', 'blob', 'temporal'];
            DEFINE FIELD label ON entity TYPE string;
            DEFINE FIELD metadata ON entity TYPE object FLEXIBLE;
            DEFINE FIELD deleted_at ON entity TYPE option<datetime>;

            DEFINE TABLE spatial_trait SCHEMAFULL;
            DEFINE FIELD owner ON spatial_trait TYPE string;
            DEFINE FIELD lat ON spatial_trait TYPE float;
            DEFINE FIELD lng ON spatial_trait TYPE float;
            DEFINE FIELD alt ON spatial_trait TYPE float;
            DEFINE FIELD heading ON spatial_trait TYPE float;

            DEFINE TABLE blob_trait SCHEMAFULL;
            DEFINE FIELD owner ON blob_trait TYPE string;
            DEFINE FIELD storage_id ON blob_trait TYPE string;
            DEFINE FIELD bucket ON blob_trait TYPE string;
            DEFINE FIELD mime ON blob_trait TYPE string;
            DEFINE FIELD hash ON blob_trait TYPE string;
            DEFINE FIELD size ON blob_trait TYPE int;

            DEFINE TABLE edge SCHEMAFULL TYPE RELATION IN entity OUT entity;
            DEFINE FIELD in ON edge TYPE record<entity>;
            DEFINE FIELD out ON edge TYPE record<entity>;
            DEFINE FIELD label ON edge TYPE string;

            DEFINE TABLE IF NOT EXISTS temporal_trait SCHEMAFULL;
            DEFINE FIELD owner ON temporal_trait TYPE string;
            DEFINE FIELD event_at ON temporal_trait TYPE option<string>;
            DEFINE FIELD starts_at ON temporal_trait TYPE option<string>;
            DEFINE FIELD ends_at ON temporal_trait TYPE option<string>;
            DEFINE FIELD recurrence ON temporal_trait TYPE option<string>;
        "#;
        
        db.query(schema_ql).await.map_err(|e| e.to_string())?;

        Ok(Self { db: Arc::new(db) })
    }
}

#[async_trait]
impl GraphDatabase for SurrealDbAdapter {
    async fn save_entity(&self, entity: Entity) -> Result<(), String> {
        let qs = format!("UPSERT {} CONTENT $entity;", entity.id);
        self.db.query(qs)
            .bind(("entity", entity))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_entity(&self, id: &str) -> Result<Entity, String> {
        let qs = format!("SELECT *, type::string(id) AS id FROM {};", id);
        
        let mut response = self.db.query(qs)
            .await.map_err(|e| e.to_string())?;
            
        let mut entities: Vec<Entity> = response.take(0).map_err(|e| e.to_string())?;
        
        if let Some(mut e) = entities.pop() {
            e.id = id.to_string();
            Ok(e)
        } else {
            Err("Entity not found".to_string())
        }
    }

    async fn soft_delete(&self, id: &str) -> Result<(), String> {
        let query = format!("UPDATE {} SET deleted_at = time::now();", id);
        self.db.query(query).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn save_spatial_trait(&self, trait_: SpatialTrait) -> Result<(), String> {
        let qs = format!("CREATE {} CONTENT $trait_;", trait_.id);
        let mut value = serde_json::to_value(&trait_).map_err(|e| e.to_string())?;
        if let Some(obj) = value.as_object_mut() {
            obj.remove("id");
        }
        self.db.query(qs)
            .bind(("trait_", value))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_spatial_traits(&self) -> Result<Vec<SpatialTrait>, String> {
        let mut response = self.db.query("SELECT *, type::string(id) AS id FROM spatial_trait;")
            .await.map_err(|e| e.to_string())?;
        let traits: Vec<SpatialTrait> = response.take(0).map_err(|e| e.to_string())?;
        Ok(traits)
    }

    async fn save_blob_trait(&self, trait_: crate::models::BlobTrait) -> Result<(), String> {
        let qs = format!("CREATE {} CONTENT $trait_;", trait_.id);
        let mut value = serde_json::to_value(&trait_).map_err(|e| e.to_string())?;
        if let Some(obj) = value.as_object_mut() {
            obj.remove("id");
        }
        self.db.query(qs)
            .bind(("trait_", value))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_blob_traits(&self) -> Result<Vec<crate::models::BlobTrait>, String> {
        let mut response = self.db.query("SELECT *, type::string(id) AS id, type::string(owner) AS owner FROM blob_trait;")
            .await.map_err(|e| e.to_string())?;
            
        let traits: Vec<crate::models::BlobTrait> = response.take(0).map_err(|e| e.to_string())?;
        Ok(traits)
    }

    async fn save_temporal_trait(&self, trait_: TemporalTrait) -> Result<(), String> {
        let id_cleaned = trait_.id.replace("temporal_trait:", "");
        let qs = format!("UPSERT temporal_trait:{} CONTENT $trait_;", id_cleaned);
        let mut value = serde_json::to_value(&trait_).map_err(|e| e.to_string())?;
        if let Some(obj) = value.as_object_mut() {
            obj.remove("id");
            // Strip null fields: SurrealDB option<string> expects NONE (absent field),
            // not JSON null. Absent fields in CONTENT are stored as NONE automatically.
            obj.retain(|_, v| !v.is_null());
        }
        self.db.query(qs)
            .bind(("trait_", value))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_temporal_traits(&self) -> Result<Vec<TemporalTrait>, String> {
        let mut response = self.db.query(
            "SELECT *, type::string(id) AS id, type::string(owner) AS owner FROM temporal_trait;"
        ).await.map_err(|e| e.to_string())?;
        let traits: Vec<TemporalTrait> = response.take(0).map_err(|e| e.to_string())?;
        Ok(traits)
    }

    async fn query_context(&self, context_id: &str) -> Result<Vec<Entity>, String> {
        let id_part = context_id.strip_prefix("entity:").unwrap_or(context_id).to_string();
        // Get all entity IDs linked from this context entity via edges
        let qs = "SELECT to_id FROM edge WHERE from_id = $context_id AND deleted_at = NONE;";
        let mut resp = self.db.query(qs)
            .bind(("context_id", format!("entity:{}", id_part)))
            .await.map_err(|e| e.to_string())?;
        
        let rows: Vec<serde_json::Value> = resp.take(0).map_err(|e| e.to_string())?;
        
        let mut entities = Vec::new();
        for row in rows {
            if let Some(to_id) = row.get("to_id").and_then(|v| v.as_str()) {
                if let Ok(e) = self.get_entity(to_id).await {
                    entities.push(e);
                }
            }
        }
        Ok(entities)
    }

    async fn add_edge(&self, from_id: &str, to_id: &str, label: &str) -> Result<(), String> {
        let qs = format!("RELATE {}->edge->{} SET label = $label;", from_id, to_id);
        self.db.query(qs)
            .bind(("label", label.to_string()))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_edges(&self) -> Result<Vec<(String, String, String)>, String> {
        // In SurrealDB relations, vertices are `in` and `out`. We serialize them manually into strings to prevent JSON enum crashes.
        let mut resp = self.db.query("SELECT type::string(in) AS in, type::string(out) AS out, label FROM edge;")
            .await.map_err(|e| e.to_string())?;
        let rows: Vec<serde_json::Value> = resp.take(0).map_err(|e| e.to_string())?;
        
        let edges = rows.iter().filter_map(|r| {
            // Relation endpoints are typically record strings
            let from = r.get("in")?.as_str()?.replace("entity:", "");
            let to = r.get("out")?.as_str()?.replace("entity:", "");
            let lbl = r.get("label")?.as_str()?.to_string();
            Some((from, to, lbl))
        }).collect();
        Ok(edges)
    }

    async fn resolve_label(&self, label: &str) -> Result<Option<String>, String> {
        let entities = self.list_entities().await?;
        Ok(entities.into_iter().find(|e| e.label == label).map(|e| e.id))
    }

    async fn resolve_path(&self, path: &str) -> Result<Option<String>, String> {
        let entities = self.list_entities().await?;
        Ok(entities.into_iter()
            .find(|e| e.metadata.get("source_path").and_then(|v| v.as_str()) == Some(path))
            .map(|e| e.id))
    }

    async fn delete_edge(&self, from_id: &str, to_id: &str, label: Option<&str>) -> Result<(), String> {
        let qs = match label {
            Some(lbl) => format!("DELETE edge WHERE in = {} AND out = {} AND label = '{}';", from_id, to_id, lbl),
            None => format!("DELETE edge WHERE in = {} AND out = {};", from_id, to_id),
        };
        self.db.query(qs)
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn execute_raw_sql(&self, query: &str) -> Result<Vec<String>, String> {
        let mut resp = self.db.query(query).await.map_err(|e| e.to_string())?;
        
        // Take the raw surrealdb::Value natively!
        // This invokes `impl QueryResult<Value> for usize` which safely retrieves the raw AST
        // bypassing `serde` deserialization bugs on Record Enums inside Vec<T>.
        let raw_val: Result<surrealdb::Value, _> = resp.take(0);
        match raw_val {
            Ok(val) => {
                // val.to_string() formats it nicely. But if it's an inline string, it might be compact.
                // We'll return it formatted using the #? Debug formatter if we want it pretty printed, 
                // but #? on Value might be an AST structure.
                // Let's print it formatted like JSON!
                let formatted = format!("{:#}", val); 
                Ok(vec![formatted])
            },
            Err(e) => {
                Ok(vec![format!("Error extracting raw AST: {}", e)])
            }
        }
    }

    async fn list_entities(&self) -> Result<Vec<Entity>, String> {
        let mut response = self.db.query("SELECT *, type::string(id) AS id FROM entity WHERE deleted_at = NONE;")
            .await.map_err(|e| e.to_string())?;
        let entities: Vec<Entity> = response.take(0).map_err(|e| e.to_string())?;
        Ok(entities)
    }
}

/// Returns the conventional store path: `$SPATIAL_OS_STORE` -> `~/.local/share/spatial-os/store` -> `/tmp/spatial-os-store`
pub fn store_path() -> PathBuf {
    std::env::var("SPATIAL_OS_STORE").map(PathBuf::from).unwrap_or_else(|_| {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join(".local/share/spatial-os/store"))
            .unwrap_or_else(|_| PathBuf::from("/tmp/spatial-os-store"))
    })
}

/// Resolves to `store_path()/db`.
/// Both CLI and GUI use this path, giving them a shared persistent database locally per-project.
pub fn default_db_path() -> PathBuf {
    store_path().join("db")
}
