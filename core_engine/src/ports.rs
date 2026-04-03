use async_trait::async_trait;
use crate::models::SpatialTrait;

#[async_trait]
pub trait StateObserver {
    async fn on_event(&self, topic: String, revision: u64, ulid: String);
}

#[async_trait]
pub trait BlobStorageProvider {
    async fn upload(&self, local_path: &str, storage_id: &str) -> Result<(), String>;
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

    // Phase 4: Context queries — fetch all entities reachable from a context entity's edges
    async fn query_context(&self, context_id: &str) -> Result<Vec<crate::models::Entity>, String>;
    
    // Phase 4: Graph edges
    async fn add_edge(&self, from_id: &str, to_id: &str, label: &str) -> Result<(), String>;
    async fn get_edges(&self) -> Result<Vec<(String, String, String)>, String>;
    // Phase 6: Management & Resolution
    async fn resolve_label(&self, label: &str) -> Result<Option<String>, String>;
    async fn resolve_path(&self, path: &str) -> Result<Option<String>, String>;
    async fn delete_edge(&self, from_id: &str, to_id: &str, label: Option<&str>) -> Result<(), String>;
    async fn execute_raw_sql(&self, query: &str) -> Result<Vec<String>, String>;
    async fn list_entities(&self) -> Result<Vec<crate::models::Entity>, String>;
}
