use core_engine::{
    db::SurrealDbAdapter,
    models::{Entity, EntityKind, SpatialTrait, TemporalTrait, BlobTrait},
    ports::{GraphDatabase, BlobStorageProvider},
    blob::LocalBlobAdapter,
    bus::EventBus,
    ports::StateObserver,
};
use rand::{Rng, SeedableRng, rngs::StdRng, seq::SliceRandom};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Full report of what the generator produced — used by downstream benchmarks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetReport {
    pub total_entities: usize,
    pub total_edges: usize,
    pub total_traits: usize,
    pub entity_ids: Vec<String>,
    pub physical_ids: Vec<String>,
    pub digital_ids: Vec<String>,
    pub temporal_ids: Vec<String>,
    pub abstract_ids: Vec<String>,
    pub agent_ids: Vec<String>,
    pub blob_ids: Vec<String>,
    pub multi_trait_ids: Vec<String>,
    pub edge_labels: Vec<String>,
    pub seed: u64,
}

/// Deterministic test dataset specification — matches thesis Table 4.2.
const PHYSICAL_COUNT: usize = 200;
const DIGITAL_COUNT: usize = 150;
const TEMPORAL_COUNT: usize = 150;
const ABSTRACT_COUNT: usize = 50;
const AGENT_COUNT: usize = 30;
const BLOB_COUNT: usize = 20;
const TAGGED_AS_EDGES: usize = 400;
const CUSTOM_EDGES: usize = 300;
const MULTI_TRAIT_COUNT: usize = 80;

const CUSTOM_EDGE_LABELS: &[&str] = &["contains", "depends_on", "references", "authored_by", "located_at"];

pub async fn generate_dataset(
    db: &SurrealDbAdapter,
    event_bus: &EventBus,
    blob_adapter: &LocalBlobAdapter,
    seed: u64,
    output_dir: &PathBuf,
) -> Result<DatasetReport, String> {
    let mut rng = StdRng::seed_from_u64(seed);

    let test_assets_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test_assets");
    ensure_test_assets(&test_assets_dir)?;

    println!("  Generating entities...");

    let mut all_ids: Vec<String> = Vec::new();
    let mut physical_ids = Vec::new();
    let mut digital_ids = Vec::new();
    let mut temporal_ids = Vec::new();
    let mut abstract_ids = Vec::new();
    let mut agent_ids = Vec::new();
    let mut blob_ids = Vec::new();
    let mut total_traits = 0usize;

    // ── Physical entities (200) with SpatialTrait ──
    for i in 0..PHYSICAL_COUNT {
        let ulid = ulid::Ulid::from_parts(1_700_000_000_000 + i as u64, rng.gen()).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            kind: EntityKind::Physical,
            label: format!("phys_{:04}", i),
            metadata: std::collections::HashMap::new(),
            deleted_at: None,
        };
        db.save_entity(entity).await?;

        let spatial = SpatialTrait {
            id: format!("spatial_trait:{}", ulid),
            owner: id.clone(),
            lat: rng.gen_range(-60.0..70.0),
            lng: rng.gen_range(-180.0..180.0),
            alt: rng.gen_range(0.0..5000.0),
            heading: rng.gen_range(0.0..360.0),
        };
        db.save_spatial_trait(spatial).await?;
        total_traits += 1;

        physical_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Digital entities (150) with BlobTrait ──
    let png_files: Vec<PathBuf> = (0..10).map(|i| test_assets_dir.join(format!("test_{}.png", i))).collect();
    let pdf_files: Vec<PathBuf> = (0..5).map(|i| test_assets_dir.join(format!("test_{}.pdf", i))).collect();
    let gltf_files: Vec<PathBuf> = (0..5).map(|i| test_assets_dir.join(format!("test_{}.gltf", i))).collect();
    let all_test_files: Vec<&PathBuf> = png_files.iter()
        .chain(pdf_files.iter())
        .chain(gltf_files.iter())
        .collect();

    for i in 0..DIGITAL_COUNT {
        let ulid = ulid::Ulid::from_parts(1_700_000_000_000 + (PHYSICAL_COUNT + i) as u64, rng.gen()).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            kind: EntityKind::Digital,
            label: format!("digital_{:04}", i),
            metadata: std::collections::HashMap::new(),
            deleted_at: None,
        };
        db.save_entity(entity).await?;

        let test_file = all_test_files[i % all_test_files.len()];
        let storage_id = format!("{}/file", ulid);
        let _ = blob_adapter.upload(&test_file.to_string_lossy(), &storage_id).await;

        let mime = if test_file.extension().map(|e| e == "png").unwrap_or(false) { "image/png" }
                   else if test_file.extension().map(|e| e == "pdf").unwrap_or(false) { "application/pdf" }
                   else { "model/gltf+json" };

        let blob_t = BlobTrait {
            id: format!("blob_trait:{}", ulid),
            owner: id.clone(),
            storage_id,
            bucket: "local".to_string(),
            mime: mime.to_string(),
            hash: format!("sha256:{:016x}", rng.gen::<u64>()),
            size: std::fs::metadata(test_file).map(|m| m.len() as i64).unwrap_or(0),
        };
        db.save_blob_trait(blob_t).await?;
        total_traits += 1;

        digital_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Temporal entities (150) with TemporalTrait ──
    for i in 0..TEMPORAL_COUNT {
        let ulid = ulid::Ulid::from_parts(1_700_000_000_000 + (PHYSICAL_COUNT + DIGITAL_COUNT + i) as u64, rng.gen()).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            kind: EntityKind::Temporal,
            label: format!("event_{:04}", i),
            metadata: std::collections::HashMap::new(),
            deleted_at: None,
        };
        db.save_entity(entity).await?;

        let temporal = match i % 3 {
            0 => TemporalTrait { // Point event
                id: format!("temporal_trait:{}", ulid),
                owner: id.clone(),
                event_at: Some(format!("2025-{:02}-{:02}T12:00:00Z", (i % 12) + 1, (i % 28) + 1)),
                starts_at: None,
                ends_at: None,
                recurrence: None,
            },
            1 => TemporalTrait { // Span event
                id: format!("temporal_trait:{}", ulid),
                owner: id.clone(),
                event_at: None,
                starts_at: Some(format!("2025-{:02}-01T00:00:00Z", (i % 12) + 1)),
                ends_at: Some(format!("2025-{:02}-28T23:59:59Z", (i % 12) + 1)),
                recurrence: None,
            },
            _ => TemporalTrait { // Recurring event
                id: format!("temporal_trait:{}", ulid),
                owner: id.clone(),
                event_at: Some(format!("2025-01-{:02}T09:00:00Z", (i % 28) + 1)),
                starts_at: None,
                ends_at: None,
                recurrence: Some("FREQ=WEEKLY;COUNT=10".to_string()),
            },
        };
        db.save_temporal_trait(temporal).await?;
        total_traits += 1;

        temporal_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Abstract entities (50) — tag hubs, no traits ──
    for i in 0..ABSTRACT_COUNT {
        let ulid = ulid::Ulid::from_parts(
            1_700_000_000_000 + (PHYSICAL_COUNT + DIGITAL_COUNT + TEMPORAL_COUNT + i) as u64,
            rng.gen(),
        ).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            kind: EntityKind::Abstract,
            label: format!("tag_{:04}", i),
            metadata: {
                let mut m = std::collections::HashMap::new();
                m.insert("is_tag".to_string(), serde_json::Value::Bool(true));
                m
            },
            deleted_at: None,
        };
        db.save_entity(entity).await?;
        abstract_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Agent entities (30) with SpatialTrait ──
    for i in 0..AGENT_COUNT {
        let ulid = ulid::Ulid::from_parts(
            1_700_000_000_000 + (PHYSICAL_COUNT + DIGITAL_COUNT + TEMPORAL_COUNT + ABSTRACT_COUNT + i) as u64,
            rng.gen(),
        ).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            kind: EntityKind::Agent,
            label: format!("agent_{:04}", i),
            metadata: std::collections::HashMap::new(),
            deleted_at: None,
        };
        db.save_entity(entity).await?;

        let spatial = SpatialTrait {
            id: format!("spatial_trait:agent_{}", ulid),
            owner: id.clone(),
            lat: rng.gen_range(-60.0..70.0),
            lng: rng.gen_range(-180.0..180.0),
            alt: 0.0,
            heading: rng.gen_range(0.0..360.0),
        };
        db.save_spatial_trait(spatial).await?;
        total_traits += 1;

        agent_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Blob entities (20) with BlobTrait (glTF only) ──
    for i in 0..BLOB_COUNT {
        let ulid = ulid::Ulid::from_parts(
            1_700_000_000_000 + (PHYSICAL_COUNT + DIGITAL_COUNT + TEMPORAL_COUNT + ABSTRACT_COUNT + AGENT_COUNT + i) as u64,
            rng.gen(),
        ).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            kind: EntityKind::Blob,
            label: format!("model_{:04}", i),
            metadata: std::collections::HashMap::new(),
            deleted_at: None,
        };
        db.save_entity(entity).await?;

        let gltf = &gltf_files[i % gltf_files.len()];
        let storage_id = format!("{}/model", ulid);
        let _ = blob_adapter.upload(&gltf.to_string_lossy(), &storage_id).await;

        let blob_t = BlobTrait {
            id: format!("blob_trait:{}", ulid),
            owner: id.clone(),
            storage_id,
            bucket: "local".to_string(),
            mime: "model/gltf+json".to_string(),
            hash: format!("sha256:{:016x}", rng.gen::<u64>()),
            size: std::fs::metadata(gltf).map(|m| m.len() as i64).unwrap_or(0),
        };
        db.save_blob_trait(blob_t).await?;
        total_traits += 1;

        blob_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Multi-trait: add TemporalTrait to first 80 Physical entities ──
    let multi_trait_ids: Vec<String> = physical_ids[..MULTI_TRAIT_COUNT].to_vec();
    for (i, phys_id) in multi_trait_ids.iter().enumerate() {
        let ulid_part = phys_id.strip_prefix("entity:").unwrap();
        let temporal = TemporalTrait {
            id: format!("temporal_trait:mt_{}", ulid_part),
            owner: phys_id.clone(),
            event_at: Some(format!("2025-{:02}-{:02}T08:00:00Z", (i % 12) + 1, (i % 28) + 1)),
            starts_at: None,
            ends_at: None,
            recurrence: None,
        };
        db.save_temporal_trait(temporal).await?;
        total_traits += 1;
    }

    println!("  Generating edges...");
    let mut total_edges = 0usize;

    // ── tagged_as edges (400): connect non-abstract entities to abstract hubs ──
    let non_abstract: Vec<&String> = all_ids.iter()
        .filter(|id| !abstract_ids.contains(id))
        .collect();

    for i in 0..TAGGED_AS_EDGES {
        let target_entity = non_abstract[i % non_abstract.len()];
        let hub = &abstract_ids[i % abstract_ids.len()];
        db.add_edge(target_entity, hub, "tagged_as").await?;
        total_edges += 1;
    }

    // ── Custom relational edges (300): ensure connected graph ──
    // First pass: chain all entities to guarantee a connected graph
    let chain_count = all_ids.len().min(CUSTOM_EDGES) - 1;
    let mut shuffled_ids = all_ids.clone();
    shuffled_ids.shuffle(&mut rng);

    for i in 0..chain_count.min(CUSTOM_EDGES / 2) {
        let label = CUSTOM_EDGE_LABELS[i % CUSTOM_EDGE_LABELS.len()];
        db.add_edge(&shuffled_ids[i], &shuffled_ids[i + 1], label).await?;
        total_edges += 1;
    }

    // Second pass: random cross-links to fill remaining edge budget
    let remaining = CUSTOM_EDGES - chain_count.min(CUSTOM_EDGES / 2);
    for _ in 0..remaining {
        let from_idx = rng.gen_range(0..all_ids.len());
        let to_idx = rng.gen_range(0..all_ids.len());
        if from_idx != to_idx {
            let label = CUSTOM_EDGE_LABELS[rng.gen_range(0..CUSTOM_EDGE_LABELS.len())];
            db.add_edge(&all_ids[from_idx], &all_ids[to_idx], label).await?;
            total_edges += 1;
        }
    }

    // Emit events for all entities
    for id in &all_ids {
        let ulid = id.strip_prefix("entity:").unwrap_or(id);
        event_bus.on_event("entity.created".to_string(), 1, ulid.to_string()).await;
    }

    let report = DatasetReport {
        total_entities: all_ids.len(),
        total_edges,
        total_traits,
        entity_ids: all_ids,
        physical_ids,
        digital_ids,
        temporal_ids,
        abstract_ids,
        agent_ids,
        blob_ids,
        multi_trait_ids,
        edge_labels: CUSTOM_EDGE_LABELS.iter().map(|s| s.to_string()).collect(),
        seed,
    };

    // Save report
    std::fs::create_dir_all(output_dir).map_err(|e| e.to_string())?;
    let report_json = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    std::fs::write(output_dir.join("dataset_report.json"), report_json).map_err(|e| e.to_string())?;

    Ok(report)
}


// ── Test asset generation ──────────────────────────────────────────────────────

fn ensure_test_assets(dir: &PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    // Generate 10 minimal PNGs (1x1 pixel, different colors)
    for i in 0..10 {
        let path = dir.join(format!("test_{}.png", i));
        if !path.exists() {
            let png = minimal_png(i as u8 * 25, 0, 255 - (i as u8 * 25));
            std::fs::write(&path, png).map_err(|e| e.to_string())?;
        }
    }

    // Generate 5 minimal PDFs
    for i in 0..5 {
        let path = dir.join(format!("test_{}.pdf", i));
        if !path.exists() {
            let pdf = minimal_pdf(i);
            std::fs::write(&path, pdf).map_err(|e| e.to_string())?;
        }
    }

    // Generate 5 minimal glTF files
    for i in 0..5 {
        let path = dir.join(format!("test_{}.gltf", i));
        if !path.exists() {
            let gltf = minimal_gltf(i);
            std::fs::write(&path, gltf).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Minimal valid PNG — 1x1 pixel with the given RGB color.
fn minimal_png(r: u8, g: u8, b: u8) -> Vec<u8> {
    // PNG signature
    let mut out = vec![137, 80, 78, 71, 13, 10, 26, 10];

    // IHDR chunk: 1x1, 8-bit RGB
    let ihdr_data = {
        let mut d = Vec::new();
        d.extend_from_slice(&1u32.to_be_bytes()); // width
        d.extend_from_slice(&1u32.to_be_bytes()); // height
        d.push(8);  // bit depth
        d.push(2);  // color type: RGB
        d.push(0);  // compression
        d.push(0);  // filter
        d.push(0);  // interlace
        d
    };
    write_png_chunk(&mut out, b"IHDR", &ihdr_data);

    // IDAT chunk: zlib-compressed pixel data
    // Raw row: filter_byte(0) + R + G + B
    let raw_row = vec![0, r, g, b];
    let compressed = simple_deflate(&raw_row);
    write_png_chunk(&mut out, b"IDAT", &compressed);

    // IEND chunk
    write_png_chunk(&mut out, b"IEND", &[]);

    out
}

fn write_png_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    // CRC32 over chunk_type + data
    let crc = crc32(&[chunk_type.as_slice(), data].concat());
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

/// Minimal zlib wrapper around raw deflate (stored block, no compression).
fn simple_deflate(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    // zlib header: CM=8, CINFO=7, FCHECK adjusted
    out.push(0x78);
    out.push(0x01);
    // Stored block: BFINAL=1, BTYPE=00
    out.push(0x01);
    let len = data.len() as u16;
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&(!len).to_le_bytes());
    out.extend_from_slice(data);
    // Adler-32 checksum
    let adler = adler32(data);
    out.extend_from_slice(&adler.to_be_bytes());
    out
}

fn adler32(data: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn minimal_pdf(index: usize) -> Vec<u8> {
    let content = format!(
        "%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n\
         2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n\
         3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n\
         4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Test page {}) Tj ET\nendstream\nendobj\n\
         5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n\
         xref\n0 6\n\
         0000000000 65535 f \n\
         0000000009 00000 n \n\
         0000000058 00000 n \n\
         0000000115 00000 n \n\
         0000000266 00000 n \n\
         0000000360 00000 n \n\
         trailer<</Size 6/Root 1 0 R>>\nstartxref\n430\n%%EOF",
        index
    );
    content.into_bytes()
}

fn minimal_gltf(index: usize) -> String {
    format!(
        concat!(
            "{{\n",
            "  \"asset\": {{ \"version\": \"2.0\", \"generator\": \"spatial-os-bench\" }},\n",
            "  \"scene\": 0,\n",
            "  \"scenes\": [{{ \"nodes\": [0] }}],\n",
            "  \"nodes\": [{{ \"mesh\": 0, \"name\": \"triangle_{}\" }}],\n",
            "  \"meshes\": [{{ \"primitives\": [{{ \"attributes\": {{ \"POSITION\": 0 }} }}] }}],\n",
            "  \"accessors\": [{{\n",
            "    \"bufferView\": 0, \"componentType\": 5126, \"count\": 3, \"type\": \"VEC3\",\n",
            "    \"max\": [1.0, 1.0, 0.0], \"min\": [0.0, 0.0, 0.0]\n",
            "  }}],\n",
            "  \"bufferViews\": [{{ \"buffer\": 0, \"byteLength\": 36 }}],\n",
            "  \"buffers\": [{{ \"uri\": \"data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAA\", \"byteLength\": 36 }}]\n",
            "}}"
        ),
        index
    )
}
