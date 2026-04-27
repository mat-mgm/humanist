use core_engine::{
    blob::{blob_filename_for_label, infer_mime_from_path},
    db::SurrealDbAdapter,
    models::{Entity, EntityKind, KeyValueTrait, SpatialTrait, TemporalTrait, BlobTrait},
    ports::{BlobStorageProvider, GraphDatabase},
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
    #[serde(default)]
    pub entity_ids: Vec<String>,
    #[serde(default)]
    pub physical_ids: Vec<String>,
    #[serde(default)]
    pub digital_ids: Vec<String>,
    #[serde(default)]
    pub temporal_ids: Vec<String>,
    #[serde(default)]
    pub abstract_ids: Vec<String>,
    #[serde(default)]
    pub agent_ids: Vec<String>,
    #[serde(default)]
    pub blob_ids: Vec<String>,
    #[serde(default)]
    pub multi_trait_ids: Vec<String>,
    #[serde(default)]
    pub edge_labels: Vec<String>,
    pub seed: u64,
}

/// Base dataset shape — multiplied by `scale` at generation time.
/// scale = 1 reproduces the original 600-entity baseline.
const BASE_PHYSICAL: usize = 350;
const BASE_DIGITAL: usize = 170;
const BASE_ABSTRACT: usize = 50;
const BASE_AGENT: usize = 30;
const BASE_TAGGED_AS_EDGES: usize = 400;
const BASE_CUSTOM_EDGES: usize = 300;
const BASE_MULTI_TRAIT: usize = 80;

const CUSTOM_EDGE_LABELS: &[&str] = &["contains", "depends_on", "references", "authored_by", "located_at"];

pub async fn generate_dataset_scaled(
    db: &SurrealDbAdapter,
    event_bus: &EventBus,
    blob_adapter: &LocalBlobAdapter,
    seed: u64,
    scale: usize,
    output_dir: &PathBuf,
) -> Result<DatasetReport, String> {
    let scale = scale.max(1);
    let physical_count = BASE_PHYSICAL * scale;
    let digital_count = BASE_DIGITAL * scale;
    let abstract_count = BASE_ABSTRACT * scale;
    let agent_count = BASE_AGENT * scale;
    let tagged_as_edges = BASE_TAGGED_AS_EDGES * scale;
    let custom_edges = BASE_CUSTOM_EDGES * scale;
    let multi_trait_count = BASE_MULTI_TRAIT * scale;
    let temporal_count = 0usize;

    let mut rng = StdRng::seed_from_u64(seed);

    let test_assets_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test_assets");
    ensure_test_assets(&test_assets_dir)?;

    println!("  Generating entities...");

    let mut all_ids: Vec<String> = Vec::new();
    let mut physical_ids = Vec::new();
    let mut digital_ids = Vec::new();
    let temporal_ids = Vec::new();
    let mut abstract_ids = Vec::new();
    let mut agent_ids = Vec::new();
    let blob_ids = Vec::new();
    let mut total_traits = 0usize;

    // ── Physical entities with SpatialTrait ──
    for i in 0..physical_count {
        let ulid = ulid::Ulid::from_parts(1_700_000_000_000 + i as u64, rng.gen()).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            category: EntityKind::Physical,
            label: format!("phys_{:04}", i),
            lang_canonical: "en".to_string(),
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
            bbox: None,
            projection: "EPSG:4326".to_string(),
        };
        db.save_spatial_trait(spatial).await?;
        total_traits += 1;

        physical_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Digital entities (170) with BlobTrait ──
    let png_files: Vec<PathBuf> = (0..10).map(|i| test_assets_dir.join(format!("test_{}.png", i))).collect();
    let pdf_files: Vec<PathBuf> = (0..5).map(|i| test_assets_dir.join(format!("test_{}.pdf", i))).collect();
    let gltf_files: Vec<PathBuf> = (0..5).map(|i| test_assets_dir.join(format!("test_{}.gltf", i))).collect();
    let all_test_files: Vec<&PathBuf> = png_files.iter()
        .chain(pdf_files.iter())
        .chain(gltf_files.iter())
        .collect();

    for i in 0..digital_count {
        let ulid = ulid::Ulid::from_parts(1_700_000_000_000 + (physical_count + i) as u64, rng.gen()).to_string();
        let id = format!("entity:{}", ulid);
        let label = format!("digital_{:04}", i);
        let entity = Entity {
            id: id.clone(),
            category: EntityKind::Digital,
            label: label.clone(),
            lang_canonical: "en".to_string(),
            deleted_at: None,
        };
        db.save_entity(entity).await?;

        let test_file = all_test_files[i % all_test_files.len()];
        let stored = blob_adapter
            .store_file(&test_file.to_string_lossy(), Some(label.clone()))
            .await?;
        let mime = infer_mime_from_path(&test_file.to_string_lossy());
        let extension = test_file.extension().and_then(|ext| ext.to_str());

        let blob_t = BlobTrait {
            id: format!("blob_trait:{}", ulid),
            owner: id.clone(),
            filename: blob_filename_for_label(Some(&label), extension),
            storage_id: stored.storage_id,
            bucket: "local".to_string(),
            mime,
            hash: stored.hash,
            size: stored.size,
        };
        db.save_blob_trait(blob_t).await?;
        total_traits += 1;

        digital_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Abstract entities — tag hubs, marked via KeyValueTrait ──
    for i in 0..abstract_count {
        let ulid = ulid::Ulid::from_parts(
            1_700_000_000_000 + (physical_count + digital_count + temporal_count + i) as u64,
            rng.gen(),
        ).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            category: EntityKind::Abstract,
            label: format!("tag_{:04}", i),
            lang_canonical: "en".to_string(),
            deleted_at: None,
        };
        db.save_entity(entity).await?;

        let mut values = std::collections::HashMap::new();
        values.insert("entity.is_tag".to_string(), serde_json::Value::Bool(true));
        let kv = KeyValueTrait {
            id: format!("key_value_trait:tag_{}", ulid),
            owner: id.clone(),
            namespace: "entity".to_string(),
            values,
        };
        db.save_key_value_trait(kv).await?;
        total_traits += 1;

        abstract_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Persona entities with SpatialTrait ──
    for i in 0..agent_count {
        let ulid = ulid::Ulid::from_parts(
            1_700_000_000_000 + (physical_count + digital_count + temporal_count + abstract_count + i) as u64,
            rng.gen(),
        ).to_string();
        let id = format!("entity:{}", ulid);
        let entity = Entity {
            id: id.clone(),
            category: EntityKind::Persona,
            label: format!("persona_{:04}", i),
            lang_canonical: "en".to_string(),
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
            bbox: None,
            projection: "EPSG:4326".to_string(),
        };
        db.save_spatial_trait(spatial).await?;
        total_traits += 1;

        agent_ids.push(id.clone());
        all_ids.push(id);
    }

    // ── Multi-trait: add TemporalTrait to first N Physical entities ──
    let multi_trait_ids: Vec<String> = physical_ids[..multi_trait_count.min(physical_ids.len())].to_vec();
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

    for i in 0..tagged_as_edges {
        let target_entity = non_abstract[i % non_abstract.len()];
        let hub = &abstract_ids[i % abstract_ids.len()];
        db.add_edge(target_entity, hub, "tagged_as").await?;
        total_edges += 1;
    }

    // ── Custom relational edges: ensure connected graph ──
    let chain_count = all_ids.len().min(custom_edges).saturating_sub(1);
    let mut shuffled_ids = all_ids.clone();
    shuffled_ids.shuffle(&mut rng);

    let chain_target = chain_count.min(custom_edges / 2);
    for i in 0..chain_target {
        let label = CUSTOM_EDGE_LABELS[i % CUSTOM_EDGE_LABELS.len()];
        db.add_edge(&shuffled_ids[i], &shuffled_ids[i + 1], label).await?;
        total_edges += 1;
    }

    // Second pass: random cross-links to fill remaining edge budget
    let remaining = custom_edges - chain_target;
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
            "  \"asset\": {{ \"version\": \"2.0\", \"generator\": \"humanist-bench\" }},\n",
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
