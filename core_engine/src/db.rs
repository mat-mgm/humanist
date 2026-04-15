use async_trait::async_trait;
use surrealdb::engine::local::{Db, SurrealKv};
use surrealdb::Surreal;
use std::sync::Arc;
use std::path::PathBuf;

use crate::models::{EdgeRecord, Entity, EntitySnapshot, RelationshipType, SpatialTrait, TemporalTrait, TraitSnapshot};
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

            DEFINE TABLE edge SCHEMAFULL TYPE RELATION IN entity OUT entity;
            DEFINE FIELD in ON edge TYPE record<entity>;
            DEFINE FIELD out ON edge TYPE record<entity>;
            DEFINE FIELD label ON edge TYPE string;
            DEFINE FIELD IF NOT EXISTS strength ON edge TYPE option<float>;
            DEFINE FIELD IF NOT EXISTS latency ON edge TYPE option<int>;
            DEFINE FIELD IF NOT EXISTS metadata ON edge FLEXIBLE TYPE option<object>;

            DEFINE TABLE IF NOT EXISTS relationship_type SCHEMAFULL;
            DEFINE FIELD label ON relationship_type TYPE string;
            DEFINE FIELD transitive ON relationship_type TYPE bool DEFAULT false;
            DEFINE FIELD symmetric ON relationship_type TYPE bool DEFAULT false;
            DEFINE FIELD inherits_traits ON relationship_type TYPE bool DEFAULT false;
            DEFINE INDEX IF NOT EXISTS idx_relationship_type_label ON relationship_type FIELDS label UNIQUE;

            DEFINE TABLE IF NOT EXISTS entity_history SCHEMALESS;
            DEFINE INDEX idx_entity_history_entity_id ON entity_history FIELDS entity_id;

            DEFINE TABLE IF NOT EXISTS trait_history SCHEMALESS;
            DEFINE INDEX idx_trait_history_entity_id ON trait_history FIELDS entity_id;

            DEFINE TABLE blob_trait SCHEMAFULL;
            DEFINE FIELD owner ON blob_trait TYPE string;
            DEFINE FIELD storage_id ON blob_trait TYPE string;
            DEFINE FIELD bucket ON blob_trait TYPE string;
            DEFINE FIELD mime ON blob_trait TYPE string;
            DEFINE FIELD hash ON blob_trait TYPE string;
            DEFINE FIELD size ON blob_trait TYPE int;

            DEFINE TABLE spatial_trait SCHEMAFULL;
            DEFINE FIELD owner ON spatial_trait TYPE string;
            DEFINE FIELD lat ON spatial_trait TYPE float;
            DEFINE FIELD lng ON spatial_trait TYPE float;
            DEFINE FIELD alt ON spatial_trait TYPE float;
            DEFINE FIELD heading ON spatial_trait TYPE float;
            DEFINE FIELD bbox ON spatial_trait TYPE option<array<float>>;
            DEFINE FIELD projection ON spatial_trait TYPE string;
            
            DEFINE TABLE temporal_trait SCHEMAFULL;
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
        let id_clean = entity.id.replace("entity:", "");
        let qs = format!("UPSERT entity:{} CONTENT $entity;", id_clean);
        
        let mut value = serde_json::to_value(&entity).map_err(|e| e.to_string())?;
        if let Some(obj) = value.as_object_mut() {
            obj.remove("id");
        }
        
        self.db.query(qs)
            .bind(("entity", value.clone()))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;

        // Shadow write: append a full snapshot to entity_history.
        let history_qs = "CREATE entity_history CONTENT $snap;";
        let mut snap = value;
        if let Some(obj) = snap.as_object_mut() {
            obj.insert("entity_id".to_string(), serde_json::Value::String(entity.id.clone()));
            obj.insert("changed_at".to_string(), serde_json::Value::String(
                chrono::Utc::now().to_rfc3339()
            ));
        }
        let _ = self.db.query(history_qs).bind(("snap", snap)).await;
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
        let id_cleaned = trait_.id.replace("spatial_trait:", "");
        let qs = format!("UPSERT spatial_trait:{} CONTENT $trait_;", id_cleaned);
        let mut value = serde_json::to_value(&trait_).map_err(|e| e.to_string())?;
        if let Some(obj) = value.as_object_mut() {
            obj.remove("id");
        }
        self.db.query(qs)
            .bind(("trait_", value.clone()))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;

        // Shadow write: append to unified trait_history.
        let snap = serde_json::json!({
            "entity_id": trait_.owner,
            "trait_type": "spatial",
            "data": value,
            "changed_at": chrono::Utc::now().to_rfc3339(),
        });
        let _ = self.db.query("CREATE trait_history CONTENT $snap;").bind(("snap", snap)).await;
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
            .bind(("trait_", value.clone()))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;

        // Shadow write: append to unified trait_history.
        let snap = serde_json::json!({
            "entity_id": trait_.owner,
            "trait_type": "temporal",
            "data": value,
            "changed_at": chrono::Utc::now().to_rfc3339(),
        });
        let _ = self.db.query("CREATE trait_history CONTENT $snap;").bind(("snap", snap)).await;
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

    async fn add_edge_with_payload(
        &self, from_id: &str, to_id: &str, label: &str,
        strength: Option<f64>, latency: Option<i64>, metadata: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let qs = format!(
            "RELATE {}->edge->{} SET label = $label, strength = $strength, latency = $latency, metadata = $metadata;",
            from_id, to_id
        );
        self.db.query(qs)
            .bind(("label", label.to_string()))
            .bind(("strength", strength))
            .bind(("latency", latency))
            .bind(("metadata", metadata.unwrap_or(serde_json::Value::Object(Default::default()))))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_edges(&self) -> Result<Vec<EdgeRecord>, String> {
        let mut resp = self.db.query(
            "SELECT type::string(in) AS in, type::string(out) AS out, label, strength, latency, metadata FROM edge;"
        ).await.map_err(|e| e.to_string())?;
        let rows: Vec<serde_json::Value> = resp.take(0).map_err(|e| e.to_string())?;

        let mut edges: Vec<EdgeRecord> = rows.iter().filter_map(|r| {
            let from = r.get("in")?.as_str()?.replace("entity:", "");
            let to = r.get("out")?.as_str()?.replace("entity:", "");
            let label = r.get("label")?.as_str()?.to_string();
            let strength = r.get("strength").and_then(|v| v.as_f64());
            let latency = r.get("latency").and_then(|v| v.as_i64());
            let metadata = r.get("metadata").cloned();
            Some(EdgeRecord { from, to, label, strength, latency, metadata })
        }).collect();

        // Expand symmetric relationship types at read time — no duplicate storage.
        let rel_types = self.list_relationship_types().await.unwrap_or_default();
        let symmetric_labels: std::collections::HashSet<&str> = rel_types.iter()
            .filter(|rt| rt.symmetric)
            .map(|rt| rt.label.as_str())
            .collect();

        if !symmetric_labels.is_empty() {
            let existing_keys: std::collections::HashSet<(&str, &str, &str)> = edges.iter()
                .map(|e| (e.from.as_str(), e.to.as_str(), e.label.as_str()))
                .collect();
            let mut synthetic: Vec<EdgeRecord> = edges.iter()
                .filter(|e| symmetric_labels.contains(e.label.as_str()))
                .filter(|e| !existing_keys.contains(&(e.to.as_str(), e.from.as_str(), e.label.as_str())))
                .map(|e| EdgeRecord {
                    from: e.to.clone(),
                    to: e.from.clone(),
                    label: e.label.clone(),
                    strength: e.strength,
                    latency: e.latency,
                    metadata: e.metadata.clone(),
                })
                .collect();
            edges.append(&mut synthetic);
        }
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

    // Phase 44: Lightweight Shadow History

    async fn get_entity_history(&self, entity_id: &str) -> Result<Vec<EntitySnapshot>, String> {
        let mut resp = self.db
            .query("SELECT *, type::string(id) AS id FROM entity_history WHERE entity_id = $eid ORDER BY changed_at DESC;")
            .bind(("eid", entity_id.to_string()))
            .await.map_err(|e| e.to_string())?;
        let snaps: Vec<EntitySnapshot> = resp.take(0).map_err(|e| e.to_string())?;
        Ok(snaps)
    }

    async fn get_entity_as_of(&self, entity_id: &str, timestamp: &str) -> Result<Option<EntitySnapshot>, String> {
        let mut resp = self.db
            .query("SELECT *, type::string(id) AS id FROM entity_history WHERE entity_id = $eid AND changed_at <= $ts ORDER BY changed_at DESC LIMIT 1;")
            .bind(("eid", entity_id.to_string()))
            .bind(("ts", timestamp.to_string()))
            .await.map_err(|e| e.to_string())?;
        let mut snaps: Vec<EntitySnapshot> = resp.take(0).map_err(|e| e.to_string())?;
        Ok(snaps.pop())
    }

    async fn get_trait_history(&self, entity_id: &str) -> Result<Vec<TraitSnapshot>, String> {
        let mut resp = self.db
            .query("SELECT *, type::string(id) AS id FROM trait_history WHERE entity_id = $eid ORDER BY changed_at DESC;")
            .bind(("eid", entity_id.to_string()))
            .await.map_err(|e| e.to_string())?;
        let snaps: Vec<TraitSnapshot> = resp.take(0).map_err(|e| e.to_string())?;
        Ok(snaps)
    }

    // Phase 45: Relationship types

    async fn save_relationship_type(&self, rel_type: RelationshipType) -> Result<(), String> {
        let id_clean = rel_type.id.replace("relationship_type:", "");
        let qs = format!("UPSERT relationship_type:{} CONTENT $data;", id_clean);
        let mut value = serde_json::to_value(&rel_type).map_err(|e| e.to_string())?;
        if let Some(obj) = value.as_object_mut() {
            obj.remove("id");
        }
        self.db.query(qs)
            .bind(("data", value))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn list_relationship_types(&self) -> Result<Vec<RelationshipType>, String> {
        let mut resp = self.db
            .query("SELECT *, type::string(id) AS id FROM relationship_type ORDER BY label ASC;")
            .await.map_err(|e| e.to_string())?;
        let types: Vec<RelationshipType> = resp.take(0).map_err(|e| e.to_string())?;
        Ok(types)
    }

    async fn delete_relationship_type(&self, label: &str) -> Result<(), String> {
        self.db
            .query("DELETE relationship_type WHERE label = $label;")
            .bind(("label", label.to_string()))
            .await.map_err(|e| e.to_string())?
            .check().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Walk outgoing edges whose relationship_type has `inherits_traits = true`,
    /// up to MAX_DEPTH hops, returning the first ancestor SpatialTrait found.
    async fn get_effective_spatial_trait(&self, entity_id: &str) -> Result<Option<SpatialTrait>, String> {
        const MAX_DEPTH: usize = 5;

        // Collect all inheriting labels once.
        let rel_types = self.list_relationship_types().await?;
        let inheriting_labels: std::collections::HashSet<String> = rel_types
            .into_iter()
            .filter(|rt| rt.inherits_traits)
            .map(|rt| rt.label)
            .collect();

        if inheriting_labels.is_empty() {
            return Ok(None);
        }

        let spatial_traits = self.get_spatial_traits().await?;
        let edges = self.get_edges().await?;

        // BFS up the graph
        let mut visited = std::collections::HashSet::new();
        let mut frontier = vec![entity_id.to_string()];

        for _ in 0..MAX_DEPTH {
            let mut next = Vec::new();
            for current_id in &frontier {
                let short = current_id.replace("entity:", "");
                for edge in &edges {
                    if (edge.from == short || format!("entity:{}", edge.from) == *current_id)
                        && inheriting_labels.contains(&edge.label)
                    {
                        let parent = format!("entity:{}", edge.to);
                        if visited.contains(&parent) { continue; }
                        visited.insert(parent.clone());

                        // Check if parent has a SpatialTrait
                        let found = spatial_traits.iter().find(|t| {
                            t.owner == parent
                                || t.owner == edge.to
                                || format!("entity:{}", t.owner) == parent
                        });
                        if let Some(t) = found {
                            return Ok(Some(t.clone()));
                        }
                        next.push(parent);
                    }
                }
            }
            if next.is_empty() { break; }
            frontier = next;
        }
        Ok(None)
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
