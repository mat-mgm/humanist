use crate::blob::StoredBlob;
use crate::models::{
    EdgeRecord, EntitySnapshot, KeyValueTrait, LabelTrait, RelationshipType, SpatialTrait,
    TableTrait, TemporalTrait, TraitSnapshot,
};
use async_trait::async_trait;

#[async_trait]
pub trait StateObserver {
    async fn on_event(&self, topic: String, revision: u64, ulid: String);
}

#[async_trait]
pub trait BlobStorageProvider {
    async fn store_file(
        &self,
        local_path: &str,
        label_hint: Option<String>,
    ) -> Result<StoredBlob, String>;
    async fn store_bytes(
        &self,
        content: Vec<u8>,
        extension_hint: Option<String>,
        label_hint: Option<String>,
    ) -> Result<StoredBlob, String>;
    async fn presign_url(&self, storage_id: &str) -> Result<String, String>;
    async fn delete(&self, storage_id: &str) -> Result<(), String>;
}

#[async_trait]
pub trait GraphDatabase {
    async fn save_entity(&self, entity: crate::models::Entity) -> Result<(), String>;
    async fn get_entity(&self, id: &str) -> Result<crate::models::Entity, String>;
    async fn soft_delete(&self, id: &str) -> Result<(), String>;

    // Phase 4: Spatial traits
    async fn save_spatial_trait(&self, trait_: SpatialTrait) -> Result<(), String>;
    async fn get_spatial_traits(&self) -> Result<Vec<SpatialTrait>, String>;

    // Phase 4: Blob traits
    async fn save_blob_trait(&self, trait_: crate::models::BlobTrait) -> Result<(), String>;
    async fn get_blob_traits(&self) -> Result<Vec<crate::models::BlobTrait>, String>;
    async fn delete_blob_trait(&self, blob_trait_id: &str) -> Result<(), String>;

    async fn save_key_value_trait(&self, trait_: KeyValueTrait) -> Result<(), String>;
    async fn get_key_value_traits(&self) -> Result<Vec<KeyValueTrait>, String>;
    async fn delete_key_value_trait(&self, key_value_trait_id: &str) -> Result<(), String>;

    async fn save_table_trait(&self, trait_: TableTrait) -> Result<(), String>;
    async fn get_table_traits(&self) -> Result<Vec<TableTrait>, String>;
    async fn delete_table_trait(&self, table_trait_id: &str) -> Result<(), String>;

    // Phase 35: Temporal traits
    async fn save_temporal_trait(&self, trait_: TemporalTrait) -> Result<(), String>;
    async fn get_temporal_traits(&self) -> Result<Vec<TemporalTrait>, String>;

    // Phase 4: Context queries — fetch all entities reachable from a context entity's edges
    async fn query_context(&self, context_id: &str) -> Result<Vec<crate::models::Entity>, String>;

    // Phase 44: N-hop neighborhood — returns (entities, connecting edges) within `hops` hops
    async fn get_entity_neighborhood(
        &self,
        entity_id: &str,
        hops: u8,
    ) -> Result<(Vec<crate::models::Entity>, Vec<EdgeRecord>), String>;
    // Phase 44: Multilingual label search — matches entity.label and label_trait.text
    async fn search_entities_by_label(
        &self,
        query: &str,
        lang: Option<&str>,
    ) -> Result<Vec<crate::models::Entity>, String>;
    // Phase 44: Execute arbitrary SurrealQL and return entity IDs (strings) from the result rows
    async fn query_entity_ids(&self, query: &str) -> Result<Vec<String>, String>;

    // Phase 4: Graph edges
    async fn add_edge(&self, from_id: &str, to_id: &str, label: &str) -> Result<(), String>;
    async fn add_edge_with_payload(
        &self,
        from_id: &str,
        to_id: &str,
        label: &str,
        strength: Option<f64>,
        latency: Option<i64>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), String>;
    async fn get_edges(&self) -> Result<Vec<EdgeRecord>, String>;
    // Phase 6: Management & Resolution
    async fn resolve_label(&self, label: &str) -> Result<Option<String>, String>;
    async fn resolve_path(&self, path: &str) -> Result<Option<String>, String>;
    async fn delete_edge(
        &self,
        from_id: &str,
        to_id: &str,
        label: Option<&str>,
    ) -> Result<(), String>;
    async fn execute_raw_sql(&self, query: &str) -> Result<Vec<String>, String>;
    async fn list_entities(&self) -> Result<Vec<crate::models::Entity>, String>;

    // Phase 44: Lightweight Shadow History
    async fn get_entity_history(&self, entity_id: &str) -> Result<Vec<EntitySnapshot>, String>;
    async fn get_entity_as_of(
        &self,
        entity_id: &str,
        timestamp: &str,
    ) -> Result<Option<EntitySnapshot>, String>;
    async fn get_trait_history(&self, entity_id: &str) -> Result<Vec<TraitSnapshot>, String>;

    // Phase 45: Relationship types & trait inheritance
    async fn save_relationship_type(&self, rel_type: RelationshipType) -> Result<(), String>;
    async fn list_relationship_types(&self) -> Result<Vec<RelationshipType>, String>;
    async fn delete_relationship_type(&self, label: &str) -> Result<(), String>;
    async fn get_effective_spatial_trait(
        &self,
        entity_id: &str,
    ) -> Result<Option<SpatialTrait>, String>;

    // Phase 43: Multilingual labels
    async fn save_label_trait(&self, trait_: LabelTrait) -> Result<(), String>;
    async fn get_label_traits(&self, entity_id: &str) -> Result<Vec<LabelTrait>, String>;
    async fn get_all_label_traits(&self) -> Result<Vec<LabelTrait>, String>;
    async fn delete_label_trait(&self, id: &str) -> Result<(), String>;
    /// Resolves the best display label for an entity given an active locale.
    /// Resolution order: (1) LabelTrait matching active_lang → (2) LabelTrait matching
    /// entity.lang_canonical → (3) entity.label fallback.
    async fn resolve_display_label(
        &self,
        entity_id: &str,
        active_lang: &str,
    ) -> Result<String, String>;
}
