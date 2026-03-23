pub mod models;
pub mod ports;
pub mod db;
pub mod blob;
pub mod bus;
pub mod gc;

#[cfg(test)]
mod tests {
    use super::*;
    use models::{Entity, EntityKind};
    use ports::{GraphDatabase, StateObserver};
    use std::collections::HashMap;
    use tokio::time::Duration;

    #[tokio::test]
    async fn test_verification_gate_2() {
        let db = db::SurrealDbAdapter::new().await.unwrap();
        let event_bus = bus::EventBus::new();
        let s3 = std::sync::Arc::new(());
        
        // Start GC
        gc::start_garbage_collection(db.clone(), s3);
        
        let ulid = ulid::Ulid::new().to_string();
        let id_str = format!("entity:{}", ulid);
        
        let entity = Entity {
            id: id_str.clone(),
            kind: EntityKind::Physical,
            label: "Test Entity".to_string(),
            tags: vec![],
            metadata: HashMap::new(),
            deleted_at: None,
        };
        
        // Subscribe BEFORE trigger
        let mut rx = event_bus.sender.subscribe();

        // 1. Insert Entity
        db.save_entity(entity.clone()).await.unwrap();
        
        // Ensure inserted
        let fetched = db.get_entity(&id_str).await.unwrap();
        assert_eq!(fetched.id, id_str);
        assert!(fetched.deleted_at.is_none());
        
        // 2. Soft-delete
        db.soft_delete(&id_str).await.unwrap();
        
        // Ensure soft deleted
        let fetched_deleted = db.get_entity(&id_str).await.unwrap();
        assert!(fetched_deleted.deleted_at.is_some());
        
        // 3. Trigger bus
        event_bus.on_event("entity.deleted".to_string(), 1, ulid.clone()).await;
        
        // Verify broadcast channel
        let event = rx.recv().await.unwrap();
        
        assert_eq!(event.topic, "entity.deleted");
        assert_eq!(event.ulid, ulid);
        assert_eq!(event.revision, 1);
    }
}
