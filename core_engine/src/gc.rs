use crate::db::SurrealDbAdapter;
use crate::ports::{BlobStorageProvider, GraphDatabase};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::time::{interval, Duration};

pub fn start_garbage_collection<B: BlobStorageProvider + Send + Sync + 'static>(
    db: SurrealDbAdapter,
    blob: Arc<B>,
) {
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(60));
        loop {
            interval.tick().await;

            let select_query = r#"
                SELECT id FROM entity WHERE deleted_at != NONE AND deleted_at < time::now() - 1d;
            "#;

            if let Ok(mut response) = db.db.query(select_query).await {
                if let Ok(records) = response.take::<Vec<serde_json::Value>>(0) {
                    let expired_owners: HashSet<String> = records
                        .iter()
                        .filter_map(|row| {
                            row.get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        })
                        .collect();
                    let blob_traits = db.get_blob_traits().await.unwrap_or_default();
                    let mut referenced_storage: HashMap<String, usize> = HashMap::new();
                    for blob_trait in blob_traits
                        .iter()
                        .filter(|b| !expired_owners.contains(&b.owner))
                    {
                        *referenced_storage
                            .entry(blob_trait.storage_id.clone())
                            .or_insert(0) += 1;
                    }

                    for row in records {
                        if let Some(id_val) = row.get("id").and_then(|v| v.as_str()) {
                            let id_str = id_val.to_string();
                            for b in blob_traits.iter().filter(|b| b.owner == id_str) {
                                if !referenced_storage.contains_key(&b.storage_id) {
                                    let _ = blob.delete(&b.storage_id).await;
                                }
                                let _ = db.db.query(format!("DELETE {};", b.id)).await;
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
