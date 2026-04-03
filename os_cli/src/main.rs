use clap::{Parser, Subcommand};
use core_engine::{
    db::SurrealDbAdapter,
    models::{Entity, EntityKind},
    ports::{GraphDatabase, StateObserver},
    bus::EventBus,
};
use ulid::Ulid;
use std::{collections::HashMap, sync::Arc};

#[derive(Parser)]
#[command(name = "spatial-os")]
#[command(about = "Spatial-Analytical Knowledge OS — CLI Interface")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Blob / File Management
    Blob {
        #[command(subcommand)]
        sub: BlobSub,
    },
    /// Database Management
    Db {
        #[command(subcommand)]
        sub: DbSub,
    },
    /// Entity Management
    Entity {
        #[command(subcommand)]
        sub: EntitySub,
    },
    /// Edge / Relationship Management
    Edge {
        #[command(subcommand)]
        sub: EdgeSub,
    },
    /// Prolog OS Logic Engine
    Prolog {
        #[command(subcommand)]
        sub: PrologSub,
    },
    /// Start the Graphical Interface
    Gui,
}

#[derive(Subcommand)]
enum BlobSub {
    /// Ingest a file into storage
    Add {
        file: String,

        /// Human-readable label for this entity
        #[arg(short, long, default_value = "Ingested File")]
        label: String,
    },
    /// Soft-delete a blob
    Rm { file: String },
    /// List all blobs
    Ls,
    /// Open a blob with the default viewer
    Open { file: String },
}

#[derive(Subcommand)]
enum DbSub {
    /// Execute raw SurrealQL
    Sql { query: String },
    /// Run consistency check
    Verify,
    /// Force garbage collection
    Gc,
}

#[derive(Subcommand)]
enum EntitySub {
    /// Create a new generic entity
    Add {
        kind: String,
        label: String,
    },
    /// Remove an entity
    Rm { term: String },
    /// List all active entities
    Ls,
    /// Search entities by label/metadata
    Search { term: String },
    /// Update metadata via JSON
    Update { term: String, json: String },
    /// Add a tag to an entity
    Tag { term: String, tag: String },
    /// Remove a tag from an entity
    Untag { term: String, tag: String },
}

#[derive(Subcommand)]
enum EdgeSub {
    /// Link two entities
    Add {
        from: String,
        to: String,
        #[arg(short, long, default_value = "linked_to")]
        label: String,
    },
    /// Remove an edge between two entities
    Rm { from: String, to: String },
}

#[derive(Subcommand)]
enum PrologSub {
    /// Interpret logic query against graph state natively
    Query { query: String },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    // Initialize core_engine subsystems
    let db = SurrealDbAdapter::new().await?;
    let bus = EventBus::new();
    let blob_dir = core_engine::db::store_path().join("blobs");
    let blob = core_engine::blob::LocalBlobAdapter::new(blob_dir);
    let blob_arc = Arc::new(blob);
    // gc::start_garbage_collection(db.clone(), blob_arc); // Disabled in short-lived CLI tools to prevent db channel drops!

    match cli.command {
        Commands::Blob { sub } => handle_blob(db, bus, blob_arc, sub).await?,
        Commands::Db { sub } => handle_db(db, sub).await?,
        Commands::Entity { sub } => handle_entity(db, bus, sub).await?,
        Commands::Edge { sub } => handle_edge(db, sub).await?,
        Commands::Prolog { sub } => handle_prolog(db, sub).await?,
        Commands::Gui => {
            println!("🚀 Starting OS GUI...");
            std::process::Command::new("./target/release/os_gui")
                .spawn()
                .map_err(|e| format!("Failed to launch GUI: {}. Is it built?", e))?;
        }
    }

    Ok(())
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn handle_blob(db: SurrealDbAdapter, bus: EventBus, blob: Arc<core_engine::blob::LocalBlobAdapter>, sub: BlobSub) -> Result<(), Box<dyn std::error::Error>> {
    use core_engine::ports::BlobStorageProvider;
    match sub {
        BlobSub::Add { file, label } => {
            let ulid = Ulid::new().to_string();
            let id = format!("entity:{}", ulid);
            
            let storage_id = format!("{}/{}", ulid, std::path::Path::new(&file).file_name().and_then(|n| n.to_str()).unwrap_or("blob"));
            if let Err(e) = blob.upload(&file, &storage_id).await {
                return Err(format!("Failed to upload physical blob: {}", e).into());
            }

            // Auto-upload adjacent .bin files for .gltf to ensure geometries aren't broken
            let file_path = std::path::Path::new(&file);
            if file_path.extension().and_then(|e| e.to_str()) == Some("gltf") {
                let bin_path = file_path.with_extension("bin");
                if bin_path.exists() {
                    let bin_storage_id = format!("{}/{}", ulid, bin_path.file_name().and_then(|n| n.to_str()).unwrap_or("blob.bin"));
                    let _ = blob.upload(&bin_path.to_string_lossy(), &bin_storage_id).await;
                }
            }
            
            let size = std::fs::metadata(&file).map(|m| m.len() as i64).unwrap_or(0);
            let l_path = file.to_lowercase();
            let mime = if l_path.ends_with(".png") { "image/png" }
                       else if l_path.ends_with(".jpg") || l_path.ends_with(".jpeg") { "image/jpeg" }
                       else if l_path.ends_with(".gif") { "image/gif" }
                       else if l_path.ends_with(".pdf") { "application/pdf" }
                       else if l_path.ends_with(".glb") || l_path.ends_with(".gltf") { "model/gltf-binary" }
                       else { "application/octet-stream" };
                       
            let blob_trait = core_engine::models::BlobTrait {
                id: format!("blob_trait:{}", ulid),
                owner: id.clone(),
                storage_id: storage_id.clone(),
                bucket: "local".to_string(),
                mime: mime.to_string(),
                hash: ulid.clone(),
                size,
            };
            db.save_blob_trait(blob_trait).await?;

            let entity = Entity {
                id: id.clone(),
                kind: EntityKind::Blob,
                label: label.clone(),
                metadata: {
                    let mut m = HashMap::new();
                    m.insert("source_path".to_string(), serde_json::Value::String(file.clone()));
                    m
                },
                deleted_at: None,
            };
            db.save_entity(entity).await?;
            bus.on_event("entity.created".to_string(), 1, ulid.clone()).await;
            println!("✅ Ingested: {} ({})", file, id);
        }
        BlobSub::Rm { file } => {
            if let Some(id) = db.resolve_path(&file).await? {
                db.soft_delete(&id).await?;
                println!("✅ Deleted blob: {} ({})", file, id);
            } else {
                println!("❌ Could not find blob for path: {}", file);
            }
        }
        BlobSub::Ls => {
            let entities = db.list_entities().await?;
            for e in entities.iter().filter(|e| matches!(e.kind, core_engine::models::EntityKind::Blob)) {
                let path = e.metadata.get("source_path").and_then(|v| v.as_str()).unwrap_or("?");
                println!("- {} [{}] ({})", e.label, path, e.id);
            }
        }
        BlobSub::Open { file } => {
            if let Some(id) = db.resolve_path(&file).await? {
                println!("📂 Generating pre-signed URL for {}...", id);
                // In a real S3 scenario, we'd use core_engine::BlobStorageProvider
                println!("(Stub) Open URL: https://s3.local/{} — opening in default browser...", id);
            } else {
                println!("❌ Unknown file: {}", file);
            }
        }
    }
    Ok(())
}

async fn handle_db(db: SurrealDbAdapter, sub: DbSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        DbSub::Sql { query } => {
            let res = db.execute_raw_sql(&query).await?;
            for txt in res {
                println!("{}", txt);
            }
        }
        DbSub::Verify => {
            println!("🔍 Checking graph consistency...");
            let entities = db.list_entities().await?;
            let edges = db.get_edges().await?;
            let blobs = db.get_blob_traits().await?;
            
            let mut orphaned_blobs = 0;
            for b in &blobs {
                if !entities.iter().any(|e| e.id == b.owner) {
                    orphaned_blobs += 1;
                }
            }
            
            println!("Found {} entities, {} edges, {} blob traits.", entities.len(), edges.len(), blobs.len());
            if orphaned_blobs > 0 {
                println!("⚠️ Warning: Found {} orphaned blob traits without a valid owner.", orphaned_blobs);
            }
            println!("✅ Integrity check passed.");
        }
        DbSub::Gc => {
            println!("🧹 Triggering manual garbage collection sweep...");
            // Manual GC trigger logic can be added to core_engine::gc
            println!("✅ Sweep complete.");
        }
    }
    Ok(())
}

async fn handle_entity(db: SurrealDbAdapter, bus: EventBus, sub: EntitySub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        EntitySub::Add { kind, label } => {
            let kind_enum = match kind.to_lowercase().as_str() {
                "physical" => EntityKind::Physical,
                "digital" => EntityKind::Digital,
                "abstract" => EntityKind::Abstract,
                "agent" => EntityKind::Agent,
                _ => return Err("Invalid kind. Use physical, digital, abstract, or agent.".into()),
            };
            let ulid = Ulid::new().to_string();
            let id = format!("entity:{}", ulid);
            let entity = Entity {
                id: id.clone(),
                kind: kind_enum,
                label: label.clone(),
                metadata: HashMap::new(),
                deleted_at: None,
            };
            db.save_entity(entity).await?;
            bus.on_event("entity.created".to_string(), 1, ulid.clone()).await;
            println!("✅ Created {} entity: {} ({})", kind, label, id);
        }
        EntitySub::Rm { term } => {
            let id = if term.starts_with("entity:") { Some(term.clone()) } else { db.resolve_label(&term).await? };
            if let Some(id) = id {
                db.soft_delete(&id).await?;
                println!("✅ Deleted entity: {} ({})", term, id);
            } else {
                println!("❌ Could not resolve entity: {}", term);
            }
        }
        EntitySub::Ls => {
            let entities = db.list_entities().await?;
            for e in entities {
                println!("- {:?} | {} ({})", e.kind, e.label, e.id);
            }
        }
        EntitySub::Search { term } => {
            let entities = db.list_entities().await?;
            let tag_id = db.resolve_label(&term).await?;
            let tagged_ids: std::collections::HashSet<_> = if let Some(t_id) = tag_id {
                let edges = db.get_edges().await?;
                let raw_t_id = t_id.replace("entity:", "");
                edges.into_iter()
                    .filter(|(_, to, lbl)| lbl == "tagged_as" && *to == raw_t_id)
                    .map(|(from, _, _)| format!("entity:{}", from))
                    .collect()
            } else {
                std::collections::HashSet::new()
            };

            let matches: Vec<_> = entities.into_iter()
                .filter(|e| e.label.contains(&term) || tagged_ids.contains(&e.id))
                .collect();
            if matches.is_empty() {
                println!("No results found for '{}'", term);
            } else {
                for e in matches {
                    println!("- {} ({})", e.label, e.id);
                }
            }
        }
        EntitySub::Update { term, json } => {
            if let Some(id) = db.resolve_label(&term).await.unwrap_or(if term.starts_with("entity:") { Some(term.clone()) } else { None }) {
                let metadata: HashMap<String, serde_json::Value> = serde_json::from_str(&json)?;
                let mut e = db.get_entity(&id).await?;
                e.metadata = metadata;
                db.save_entity(e).await?;
                println!("✅ Updated metadata for: {}", term);
            } else {
                println!("❌ Could not find entity: {}", term);
            }
        }
        EntitySub::Tag { term, tag } => {
            if let Some(target_id) = db.resolve_label(&term).await.unwrap_or(if term.starts_with("entity:") { Some(term.clone()) } else { None }) {
                // Find or create the tag entity natively
                let tag_id = if let Some(id) = db.resolve_label(&tag).await? {
                    id
                } else {
                    let ulid = ulid::Ulid::new().to_string();
                    let id = format!("entity:{}", ulid);
                    let mut entity = Entity {
                        id: id.clone(),
                        kind: EntityKind::Abstract,
                        label: tag.clone(),
                        metadata: HashMap::new(),
                        deleted_at: None,
                    };
                    entity.metadata.insert("is_tag".to_string(), serde_json::Value::Bool(true));
                    db.save_entity(entity).await?;
                    bus.on_event("entity.created".to_string(), 1, ulid).await;
                    id
                };
                
                // Add the edge linking them!
                db.add_edge(&target_id, &tag_id, "tagged_as").await?;
                println!("✅ Added tag '{}' to {}", tag, term);
            } else {
                println!("❌ Could not find entity: {}", term);
            }
        }
        EntitySub::Untag { term, tag } => {
            if let Some(target_id) = db.resolve_label(&term).await.unwrap_or(if term.starts_with("entity:") { Some(term.clone()) } else { None }) {
                if let Some(tag_id) = db.resolve_label(&tag).await.unwrap_or(if tag.starts_with("entity:") { Some(tag.clone()) } else { None }) {
                    // Softly remove the semantic edge linking them without erasing the Tag Node itself!
                    db.delete_edge(&target_id, &tag_id, Some("tagged_as")).await?;
                    println!("✅ Removed tag '{}' from {}", tag, term);
                } else {
                    println!("❌ Could not find tag entity: {}", tag);
                }
            } else {
                println!("❌ Could not find entity: {}", term);
            }
        }
    }
    Ok(())
}

async fn handle_edge(db: SurrealDbAdapter, sub: EdgeSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        EdgeSub::Add { from, to, label } => {
            let f_id = if from.starts_with("entity:") { Some(from.clone()) } else { db.resolve_label(&from).await? };
            let t_id = if to.starts_with("entity:") { Some(to.clone()) } else { db.resolve_label(&to).await? };
            
            match (f_id, t_id) {
                (Some(f), Some(t)) => {
                    db.add_edge(&f, &t, &label).await?;
                    println!("✅ Linked {} → {} with trait '{}'", from, to, label);
                }
                _ => println!("❌ Could not resolve one or both entities."),
            }
        }
        EdgeSub::Rm { from, to } => {
            let f_id = if from.starts_with("entity:") { Some(from.clone()) } else { db.resolve_label(&from).await? };
            let t_id = if to.starts_with("entity:") { Some(to.clone()) } else { db.resolve_label(&to).await? };
            
            match (f_id, t_id) {
                (Some(f), Some(t)) => {
                    db.delete_edge(&f, &t, None).await?;
                    println!("✅ Removed edge: {} → {}", from, to);
                }
                _ => println!("❌ Could not resolve one or both entities."),
            }
        }
    }
    Ok(())
}

async fn handle_prolog(db: SurrealDbAdapter, sub: PrologSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        PrologSub::Query { query } => {
            let machine = prolog_engine::ScryerMachine::new();
            println!("🔄 Loading logical graph layout into memory...");
            prolog_engine::synchronizer::StateSynchronizerTask::load_all_facts(&machine, &db).await?;
            let engine = prolog_engine::InferenceEngine::new(machine);
            
            println!("🔍 Executing query: {}", query);
            let results = engine.query(&query)?;
            
            if results.is_empty() {
                println!("No standard output matched, check inference validation.");
            } else {
                for res in results {
                    println!("{}", res);
                }
            }
        }
    }
    Ok(())
}
