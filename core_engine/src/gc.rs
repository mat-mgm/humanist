use crate::db::SurrealDbAdapter;
use crate::ports::{BlobStorageProvider, GraphDatabase};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::time::{interval, Duration};

#[derive(Debug, Clone, serde::Serialize)]
pub struct GcSweepStats {
    pub expired_entities: usize,
    pub swept_entities: usize,
    pub removed_blob_traits: usize,
    pub removed_blobs: usize,
    pub reclaimed_bytes: i64,
}

pub async fn run_garbage_collection<B: BlobStorageProvider + Send + Sync>(
    db: &SurrealDbAdapter,
    blob: &B,
) -> Result<GcSweepStats, String> {
    let select_query = r#"
        SELECT id FROM entity WHERE deleted_at != NONE AND deleted_at < time::now() - 1d;
    "#;

    let mut expired_owners: HashSet<String> = HashSet::new();
    if let Ok(mut response) = db.db.query(select_query).await {
        if let Ok(records) = response.take::<Vec<serde_json::Value>>(0) {
            expired_owners = records
                .iter()
                .filter_map(|row| {
                    row.get("id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect();
        }
    }

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

    let mut removed_blobs: usize = 0;
    let mut removed_blob_traits: usize = 0;
    let mut reclaimed_bytes: i64 = 0;
    for owner in &expired_owners {
        for b in blob_traits.iter().filter(|b| &b.owner == owner) {
            if !referenced_storage.contains_key(&b.storage_id) {
                if blob.delete(&b.storage_id).await.is_ok() {
                    removed_blobs += 1;
                    reclaimed_bytes += b.size;
                }
            }
            if db.db.query(format!("DELETE {};", b.id)).await.is_ok() {
                removed_blob_traits += 1;
            }
        }
    }

    let sweep_query = r#"
        DELETE entity WHERE deleted_at != NONE AND deleted_at < time::now() - 1d;
    "#;
    if let Err(e) = db.db.query(sweep_query).await {
        tracing::error!(error = %e, "gc sweep db error");
        return Err(e.to_string());
    }

    Ok(GcSweepStats {
        expired_entities: expired_owners.len(),
        swept_entities: expired_owners.len(),
        removed_blob_traits,
        removed_blobs,
        reclaimed_bytes,
    })
}

pub fn start_garbage_collection<B: BlobStorageProvider + Send + Sync + 'static>(
    db: SurrealDbAdapter,
    blob: Arc<B>,
) {
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            match run_garbage_collection(&db, blob.as_ref()).await {
                Ok(stats) => tracing::info!(
                    removed_blobs = stats.removed_blobs,
                    reclaimed_bytes = stats.reclaimed_bytes,
                    swept_entities = stats.swept_entities,
                    "gc sweep"
                ),
                Err(error) => tracing::error!(error = %error, "gc sweep db error"),
            }
        }
    });
}
