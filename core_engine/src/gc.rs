use std::sync::Arc;
use tokio::time::{interval, Duration};
use crate::db::SurrealDbAdapter;
use crate::ports::{GraphDatabase, BlobStorageProvider};

pub fn start_garbage_collection<B: BlobStorageProvider + Send + Sync + 'static>(db: SurrealDbAdapter, blob: Arc<B>) {
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            
            let select_query = r#"
                SELECT id FROM entity WHERE deleted_at != NONE AND deleted_at < time::now() - 1d;
            "#;
            
            if let Ok(mut response) = db.db.query(select_query).await {
                if let Ok(records) = response.take::<Vec<serde_json::Value>>(0) {
                    for row in records {
                        if let Some(id_val) = row.get("id").and_then(|v| v.as_str()) {
                            let id_str = id_val.to_string();
                            if let Ok(blobs) = db.get_blob_traits().await {
                                for b in blobs.into_iter().filter(|b| b.owner == id_str) {
                                    let _ = blob.delete(&b.storage_id).await;
                                    let _ = db.db.query(format!("DELETE {};", b.id)).await;
                                }
                            }
                        }
                    }
                }
            }

            // Sweep query to completely delete entities soft-deleted > 24 hours ago
            let sweep_query = r#"
                DELETE entity WHERE deleted_at != NONE AND deleted_at < time::now() - 1d;
            "#;
            
            if let Err(e) = db.db.query(sweep_query).await {
                eprintln!("GC Error sweeping DB: {}", e);
            }
        }
    });
}
