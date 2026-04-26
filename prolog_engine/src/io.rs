//! Prolog snapshot I/O: serialization to disk and parsing from disk.
//!
//! This is the file-system-facing wrapper around `schema::to_facts` /
//! `schema::from_facts`. The export side writes a `snapshot.pl` file and a
//! sibling `blobs/` directory; the import side parses the file and resolves
//! `blob_file` paths relative to the snapshot location.

use crate::schema;
use core_engine::blob::LocalBlobAdapter;
use core_engine::models::DomainPatch;
#[cfg(test)]
use core_engine::models::DomainSnapshot;
use core_engine::ports::GraphDatabase;
use core_engine::snapshot::{apply_patch, build_snapshot, populate_blob_files, ApplyReport};
use std::path::{Path, PathBuf};

/// Writes a complete Prolog snapshot to `out_dir`. Creates `out_dir` and
/// `out_dir/blobs/` if missing. Returns the path to the written
/// `snapshot.pl`.
pub async fn export_to_dir<DB: GraphDatabase>(
    db: &DB,
    cas: &LocalBlobAdapter,
    out_dir: &Path,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let mut snapshot = build_snapshot(db).await?;
    populate_blob_files(&mut snapshot, cas, out_dir)?;
    let text = schema::to_facts(&snapshot);
    let pl_path = out_dir.join("snapshot.pl");
    std::fs::write(&pl_path, text).map_err(|e| e.to_string())?;
    Ok(pl_path)
}

/// Parses a `.pl` snapshot, ingests referenced blob files into the local
/// CAS, and applies the patch to the database. Blob paths are resolved
/// relative to the directory containing the `.pl` file.
pub async fn import_from_file<DB: GraphDatabase>(
    db: &DB,
    cas: &LocalBlobAdapter,
    pl_path: &Path,
) -> Result<ApplyReport, String> {
    let text = std::fs::read_to_string(pl_path).map_err(|e| e.to_string())?;
    let patch: DomainPatch = schema::from_facts(&text)?;
    let root = pl_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    apply_patch(db, cas, patch, &root).await
}

/// Pure round-trip helper used by tests: write a snapshot to a temp dir,
/// read it back, and return the parsed snapshot. No DB or CAS involved.
#[cfg(test)]
pub fn round_trip_text(snapshot: &DomainSnapshot) -> Result<DomainSnapshot, String> {
    let text = schema::to_facts(snapshot);
    schema::from_facts(&text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_engine::models::{
        BlobFile, BlobTrait, EdgeRecord, Entity, EntityKind, LabelTrait, RelationshipType,
        SpatialTrait, TemporalTrait,
    };
    use std::collections::HashMap;

    fn populated_snapshot() -> DomainSnapshot {
        DomainSnapshot {
            entities: vec![
                Entity {
                    id: "entity:01HZK0".to_string(),
                    category: EntityKind::Physical,
                    label: "Tanker".to_string(),
                    lang_canonical: "en".to_string(),
                    metadata: HashMap::new(),
                    deleted_at: None,
                },
                Entity {
                    id: "entity:01HZK1".to_string(),
                    category: EntityKind::Persona,
                    label: "Captain".to_string(),
                    lang_canonical: "en".to_string(),
                    metadata: HashMap::new(),
                    deleted_at: None,
                },
            ],
            label_traits: vec![LabelTrait {
                id: "lt:01".to_string(),
                owner: "entity:01HZK0".to_string(),
                lang: "fr".to_string(),
                text: "Pétrolier".to_string(),
            }],
            spatial_traits: vec![SpatialTrait {
                id: "sp:01".to_string(),
                owner: "entity:01HZK0".to_string(),
                lat: 36.12,
                lng: -5.35,
                alt: 0.0,
                heading: 90.0,
                bbox: Some(vec![36.0, -5.0, 37.0, -4.0]),
                projection: "wgs84".to_string(),
            }],
            temporal_traits: vec![TemporalTrait {
                id: "tt:01".to_string(),
                owner: "entity:01HZK1".to_string(),
                event_at: Some("2026-04-26T12:00:00Z".to_string()),
                starts_at: None,
                ends_at: None,
                recurrence: None,
            }],
            blob_traits: vec![BlobTrait {
                id: "bt:01".to_string(),
                owner: "entity:01HZK0".to_string(),
                filename: "manifest.pdf".to_string(),
                storage_id: "sha256/ab/cdef".to_string(),
                bucket: "local".to_string(),
                mime: "application/pdf".to_string(),
                hash: "abcdef".to_string(),
                size: 0,
            }],
            relationship_types: vec![RelationshipType {
                id: "rt:contains".to_string(),
                label: "contains".to_string(),
                transitive: true,
                symmetric: false,
                inherits_traits: false,
                visible: true,
                flow: None,
                routing: None,
                color: None,
            }],
            edges: vec![EdgeRecord {
                from: "entity:01HZK0".to_string(),
                to: "entity:01HZK1".to_string(),
                label: "contains".to_string(),
                strength: Some(0.5),
                latency: Some(20),
                metadata: None,
            }],
            blob_files: vec![BlobFile {
                blob_id: "bt:01".to_string(),
                relative_path: "blobs/abcdef.pdf".to_string(),
                hash: "abcdef".to_string(),
                mime: "application/pdf".to_string(),
            }],
        }
    }

    #[test]
    fn pure_round_trip_preserves_counts_and_ids() {
        let original = populated_snapshot();
        let parsed = round_trip_text(&original).unwrap();
        assert_eq!(parsed.entities.len(), original.entities.len());
        assert_eq!(parsed.label_traits.len(), original.label_traits.len());
        assert_eq!(parsed.spatial_traits.len(), original.spatial_traits.len());
        assert_eq!(parsed.temporal_traits.len(), original.temporal_traits.len());
        assert_eq!(parsed.blob_traits.len(), original.blob_traits.len());
        assert_eq!(
            parsed.relationship_types.len(),
            original.relationship_types.len()
        );
        assert_eq!(parsed.edges.len(), original.edges.len());
        assert_eq!(parsed.blob_files.len(), original.blob_files.len());
        assert_eq!(parsed.entities[0].id, "entity:01HZK0");
        assert_eq!(parsed.spatial_traits[0].bbox.as_ref().unwrap().len(), 4);
        assert_eq!(parsed.edges[0].strength, Some(0.5));
        assert_eq!(parsed.edges[0].latency, Some(20));
    }
}
