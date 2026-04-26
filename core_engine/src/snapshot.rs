//! Domain snapshot construction and patch application.
//!
//! `build_snapshot` walks the database and produces a `DomainSnapshot`. The
//! Prolog interchange format is *built on top* of this: callers serialize
//! the snapshot via `prolog_engine::schema::to_facts` and write it to disk
//! alongside a `blobs/` directory.
//!
//! `apply_patch` replays a `DomainPatch` (typically the parser output of an
//! interchange file) against the database using existing port methods. It
//! is an additive UPSERT pass; no destructive writes happen here.

use crate::blob::LocalBlobAdapter;
use crate::models::{BlobFile, DomainPatch, DomainSnapshot};
use crate::ports::{BlobStorageProvider, GraphDatabase};
use std::path::{Path, PathBuf};

/// Reads the entire authoritative state of the database into a snapshot.
/// Blob bytes are *not* included; callers that need disk-backed blobs
/// produce `BlobFile` entries via `populate_blob_files`.
///
/// Edge endpoints are normalized to the canonical `entity:<ulid>` form
/// regardless of what `get_edges` returns internally, so the snapshot is
/// always self-consistent for round-trip.
pub async fn build_snapshot<DB: GraphDatabase>(db: &DB) -> Result<DomainSnapshot, String> {
    let mut edges = db.get_edges().await?;
    for edge in &mut edges {
        edge.from = canonicalize_entity_id(&edge.from);
        edge.to = canonicalize_entity_id(&edge.to);
    }
    Ok(DomainSnapshot {
        entities: db.list_entities().await?,
        label_traits: db.get_all_label_traits().await?,
        spatial_traits: db.get_spatial_traits().await?,
        temporal_traits: db.get_temporal_traits().await?,
        blob_traits: db.get_blob_traits().await?,
        relationship_types: db.list_relationship_types().await?,
        edges,
        blob_files: Vec::new(),
    })
}

/// Ensures an entity ID carries the `entity:` table prefix. Idempotent.
fn canonicalize_entity_id(id: &str) -> String {
    if id.starts_with("entity:") {
        id.to_string()
    } else {
        format!("entity:{}", id)
    }
}

/// Copies every blob trait's content into `out_dir/blobs/<filename>` and
/// produces matching `BlobFile` entries on the snapshot. Existing files are
/// not overwritten if they already match by hash — this keeps repeated
/// exports cheap.
pub fn populate_blob_files(
    snapshot: &mut DomainSnapshot,
    cas: &LocalBlobAdapter,
    out_dir: &Path,
) -> Result<(), String> {
    let blobs_dir = out_dir.join("blobs");
    std::fs::create_dir_all(&blobs_dir).map_err(|e| e.to_string())?;

    for trait_ in &snapshot.blob_traits {
        let src = cas.base_dir.join(&trait_.storage_id);
        if !src.exists() {
            tracing::warn!(blob_id = %trait_.id, storage_id = %trait_.storage_id, "blob content missing on export");
            continue;
        }
        let safe_name = export_filename(&trait_.hash, &trait_.filename);
        let dest = blobs_dir.join(&safe_name);
        if !dest.exists() {
            std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        }
        snapshot.blob_files.push(BlobFile {
            blob_id: trait_.id.clone(),
            relative_path: format!("blobs/{}", safe_name),
            hash: trait_.hash.clone(),
            mime: trait_.mime.clone(),
        });
    }
    Ok(())
}

fn export_filename(hash: &str, original: &str) -> String {
    let stem_hash = if hash.len() >= 12 { &hash[..12] } else { hash };
    let ext = Path::new(original)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();
    format!("{}{}", stem_hash, ext)
}

/// Applies a `DomainPatch` to the database. Blob content is ingested via
/// the CAS; `BlobTrait.storage_id`/`hash`/`size` on the patch are replaced
/// by the values produced by the local CAS so the destination is canonical.
pub async fn apply_patch<DB: GraphDatabase>(
    db: &DB,
    cas: &LocalBlobAdapter,
    patch: DomainPatch,
    snapshot_root: &Path,
) -> Result<ApplyReport, String> {
    let mut report = ApplyReport::default();

    for entity in patch.entities {
        db.save_entity(entity).await?;
        report.entities += 1;
    }

    for label_trait in patch.label_traits {
        db.save_label_trait(label_trait).await?;
        report.label_traits += 1;
    }

    for spatial in patch.spatial_traits {
        db.save_spatial_trait(spatial).await?;
        report.spatial_traits += 1;
    }

    for temporal in patch.temporal_traits {
        db.save_temporal_trait(temporal).await?;
        report.temporal_traits += 1;
    }

    for rel_type in patch.relationship_types {
        db.save_relationship_type(rel_type).await?;
        report.relationship_types += 1;
    }

    let blob_files: std::collections::HashMap<String, BlobFile> = patch
        .blob_files
        .into_iter()
        .map(|f| (f.blob_id.clone(), f))
        .collect();

    for mut blob in patch.blob_traits {
        if let Some(file) = blob_files.get(&blob.id) {
            let abs = resolve_blob_path(snapshot_root, &file.relative_path);
            match std::fs::read(&abs) {
                Ok(bytes) => {
                    let extension = std::path::Path::new(&blob.filename)
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(String::from);
                    let stored = cas
                        .store_bytes(bytes, extension, Some(blob.filename.clone()))
                        .await?;
                    blob.storage_id = stored.storage_id;
                    blob.hash = stored.hash;
                    blob.size = stored.size;
                }
                Err(err) => {
                    tracing::warn!(path = %abs.display(), error = %err, "blob file missing on import; trait inserted without content");
                }
            }
        }
        db.save_blob_trait(blob).await?;
        report.blob_traits += 1;
    }

    for edge in patch.edges {
        let from = canonicalize_entity_id(&edge.from);
        let to = canonicalize_entity_id(&edge.to);
        if edge.strength.is_some() || edge.latency.is_some() || edge.metadata.is_some() {
            db.add_edge_with_payload(
                &from,
                &to,
                &edge.label,
                edge.strength,
                edge.latency,
                edge.metadata,
            )
            .await?;
        } else {
            db.add_edge(&from, &to, &edge.label).await?;
        }
        report.edges += 1;
    }

    Ok(report)
}

fn resolve_blob_path(snapshot_root: &Path, relative: &str) -> PathBuf {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        rel.to_path_buf()
    } else {
        snapshot_root.join(rel)
    }
}

#[derive(Debug, Default, Clone)]
pub struct ApplyReport {
    pub entities: usize,
    pub label_traits: usize,
    pub spatial_traits: usize,
    pub temporal_traits: usize,
    pub blob_traits: usize,
    pub relationship_types: usize,
    pub edges: usize,
}
