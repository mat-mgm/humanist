use core_engine::{
    blob::LocalBlobAdapter,
    bus::EventBus,
    db::SurrealDbAdapter,
    gc,
    models::{
        EdgeRecord, Entity, EntityKind, EntitySnapshot, LabelTrait, RelationshipType, SpatialTrait,
        TemporalTrait, TraitSnapshot,
    },
    ports::{BlobStorageProvider, GraphDatabase, StateObserver},
};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::Arc};
use tauri::async_runtime;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use ulid::Ulid;

mod pty_manager;
use pty_manager::PtyHost;

// ── Shared App State ─────────────────────────────────────────────────────────

pub struct AppState {
    pub db: SurrealDbAdapter,
    pub bus: EventBus,
    pub blob: LocalBlobAdapter,
    pub query_tx: mpsc::Sender<(String, oneshot::Sender<Result<Vec<String>, String>>)>,
    pub pty_sessions: std::sync::Mutex<HashMap<String, PtyHost>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
struct ImportJobProgress {
    job_id: String,
    stage: String,
    message: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
struct ImportJobFinished {
    job_id: String,
    entity_id: Option<String>,
    stage: String,
    message: String,
    error: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
struct StorageHealth {
    live_entity_count: usize,
    soft_deleted_entity_count: usize,
    edge_count: usize,
    blob_trait_count: usize,
    unique_blob_count: usize,
    referenced_blob_bytes: i64,
    blob_store_file_count: usize,
    blob_store_bytes: u64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportSourceDraft {
    source_path: String,
    file_name: String,
    label: String,
    tag_labels: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
struct PathCompletion {
    path: String,
    display: String,
    is_dir: bool,
}

fn emit_import_progress(app: &AppHandle, job_id: &str, stage: &str, message: &str) {
    let _ = app.emit(
        "input-job-progress",
        ImportJobProgress {
            job_id: job_id.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
        },
    );
}

fn emit_import_finished(
    app: &AppHandle,
    job_id: &str,
    entity_id: Option<String>,
    stage: &str,
    message: &str,
    error: Option<String>,
) {
    let _ = app.emit(
        "input-job-finished",
        ImportJobFinished {
            job_id: job_id.to_string(),
            entity_id,
            stage: stage.to_string(),
            message: message.to_string(),
            error,
        },
    );
}

fn count_blob_store(path: &std::path::Path) -> Result<(usize, u64), String> {
    if !path.exists() {
        return Ok((0, 0));
    }
    let mut stack = vec![path.to_path_buf()];
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            if meta.is_dir() {
                stack.push(entry.path());
            } else if meta.is_file() {
                file_count += 1;
                total_bytes += meta.len();
            }
        }
    }
    Ok((file_count, total_bytes))
}

async fn query_count(db: &SurrealDbAdapter, query: &str) -> Result<usize, String> {
    let mut response = db.db.query(query).await.map_err(|e| e.to_string())?;
    let rows: Vec<serde_json::Value> = response.take(0).map_err(|e| e.to_string())?;
    let count = rows
        .first()
        .and_then(|row| row.get("count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    Ok(count as usize)
}

async fn compute_storage_health(
    db: &SurrealDbAdapter,
    blob: &LocalBlobAdapter,
) -> Result<StorageHealth, String> {
    let live_entity_count =
        query_count(db, "SELECT count() AS count FROM entity WHERE deleted_at = NONE GROUP ALL;")
            .await?;
    let soft_deleted_entity_count = query_count(
        db,
        "SELECT count() AS count FROM entity WHERE deleted_at != NONE GROUP ALL;",
    )
    .await?;
    let edge_count = db.get_edges().await?.len();
    let blob_traits = db.get_blob_traits().await?;
    let mut unique_storage: HashMap<String, i64> = HashMap::new();
    for trait_ in &blob_traits {
        unique_storage
            .entry(trait_.storage_id.clone())
            .or_insert(trait_.size);
    }
    let (blob_store_file_count, blob_store_bytes) = count_blob_store(&blob.base_dir)?;
    Ok(StorageHealth {
        live_entity_count,
        soft_deleted_entity_count,
        edge_count,
        blob_trait_count: blob_traits.len(),
        unique_blob_count: unique_storage.len(),
        referenced_blob_bytes: unique_storage.values().sum(),
        blob_store_file_count,
        blob_store_bytes,
    })
}

fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

fn resolve_user_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }
    let expanded = expand_tilde(trimmed);
    let raw = PathBuf::from(expanded);
    if raw.is_absolute() {
        Ok(raw)
    } else {
        Ok(std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(raw))
    }
}

fn display_path_for_mode(original: &str, resolved: &Path) -> String {
    let expanded = expand_tilde(original);
    if original.starts_with('~') {
        if let Ok(home) = std::env::var("HOME") {
            if let Ok(stripped) = resolved.strip_prefix(&home) {
                let suffix = stripped.to_string_lossy();
                return if suffix.is_empty() {
                    "~".to_string()
                } else {
                    format!("~/{}", suffix)
                };
            }
        }
    }
    if Path::new(&expanded).is_absolute() {
        return resolved.to_string_lossy().to_string();
    }
    match std::env::current_dir() {
        Ok(cwd) => resolved
            .strip_prefix(cwd)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| resolved.to_string_lossy().to_string()),
        Err(_) => resolved.to_string_lossy().to_string(),
    }
}

fn file_label_from_name(file_name: &str) -> String {
    let dot = file_name.rfind('.');
    match dot {
        Some(idx) if idx > 0 => file_name[..idx].to_string(),
        _ => file_name.to_string(),
    }
}

fn collect_import_sources(path: &Path, tag_labels: &[String]) -> Result<Vec<ImportSourceDraft>, String> {
    if path.is_file() {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Invalid file name: {}", path.display()))?
            .to_string();
        return Ok(vec![ImportSourceDraft {
            source_path: path.to_string_lossy().to_string(),
            label: file_label_from_name(&file_name),
            file_name,
            tag_labels: tag_labels.to_vec(),
        }]);
    }
    if path.is_dir() {
        let mut root_tags = tag_labels.to_vec();
        if let Some(dir_name) = path.file_name().and_then(|name| name.to_str()) {
            root_tags.push(dir_name.to_string());
        }
        let mut entries = Vec::new();
        let mut stack = vec![(path.to_path_buf(), root_tags)];
        while let Some((dir, inherited_tags)) = stack.pop() {
            for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let entry_path = entry.path();
                let meta = entry.metadata().map_err(|e| e.to_string())?;
                if meta.is_dir() {
                    let mut next_tags = inherited_tags.clone();
                    if let Some(dir_name) = entry_path.file_name().and_then(|name| name.to_str()) {
                        next_tags.push(dir_name.to_string());
                    }
                    stack.push((entry_path, next_tags));
                } else if meta.is_file() {
                    let file_name = entry_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .ok_or_else(|| format!("Invalid file name: {}", entry_path.display()))?
                        .to_string();
                    entries.push(ImportSourceDraft {
                        source_path: entry_path.to_string_lossy().to_string(),
                        label: file_label_from_name(&file_name),
                        file_name,
                        tag_labels: inherited_tags.clone(),
                    });
                }
            }
        }
        entries.sort_by(|a, b| a.source_path.cmp(&b.source_path));
        return Ok(entries);
    }
    Err(format!("Path does not exist: {}", path.display()))
}

#[tauri::command]
async fn pick_native_import_files() -> Result<Vec<String>, String> {
    let handle = async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select files to import")
            .pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>()
    });
    handle.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_native_import_directory() -> Result<Option<String>, String> {
    let handle = async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select directory to import")
            .pick_folder()
            .map(|path| path.to_string_lossy().to_string())
    });
    handle.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn expand_import_sources(paths: Vec<String>) -> Result<Vec<ImportSourceDraft>, String> {
    let handle = async_runtime::spawn_blocking(move || {
        let mut all_sources = Vec::new();
        for raw in paths {
            let resolved = resolve_user_path(&raw)?;
            all_sources.extend(collect_import_sources(&resolved, &[])?);
        }
        Ok::<Vec<ImportSourceDraft>, String>(all_sources)
    });
    handle.await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn complete_input_path(prefix: String) -> Result<Vec<PathCompletion>, String> {
    let handle = async_runtime::spawn_blocking(move || {
        let trimmed = prefix.trim();
        let expanded = expand_tilde(trimmed);
        let raw = PathBuf::from(&expanded);
        let ends_with_sep = trimmed.ends_with(std::path::MAIN_SEPARATOR) || trimmed.ends_with('/');
        let (dir_path, needle) = if ends_with_sep {
            (raw.clone(), String::new())
        } else {
            let parent = raw.parent().map(|p| p.to_path_buf()).unwrap_or_else(PathBuf::new);
            let file_part = raw
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_string();
            (parent, file_part)
        };
        let base_dir = if dir_path.as_os_str().is_empty() {
            std::env::current_dir().map_err(|e| e.to_string())?
        } else if dir_path.is_absolute() {
            dir_path
        } else {
            std::env::current_dir().map_err(|e| e.to_string())?.join(dir_path)
        };
        if !base_dir.exists() || !base_dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut completions = Vec::new();
        for entry in std::fs::read_dir(&base_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let file_name = match entry.file_name().to_str() {
                Some(name) => name.to_string(),
                None => continue,
            };
            if !needle.is_empty() && !file_name.to_lowercase().starts_with(&needle.to_lowercase()) {
                continue;
            }
            let entry_path = entry.path();
            let is_dir = entry.metadata().map_err(|e| e.to_string())?.is_dir();
            let display = display_path_for_mode(trimmed, &entry_path);
            completions.push(PathCompletion {
                path: display.clone(),
                display: if is_dir { format!("{display}/") } else { display },
                is_dir,
            });
        }
        completions.sort_by(|a, b| a.display.cmp(&b.display));
        Ok(completions)
    });
    handle.await.map_err(|e| e.to_string())?
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
async fn ingest_entity(
    label: String,
    file_path: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let ulid = Ulid::new().to_string();
    let id = format!("entity:{}", ulid);

    let st = state.lock().await;

    let stored = st.blob.store_file(&file_path, Some(label.clone())).await?;
    let mime = core_engine::blob::infer_mime_from_path(&file_path);
    let extension = std::path::Path::new(&file_path)
        .extension()
        .and_then(|ext| ext.to_str());
    let filename = core_engine::blob::blob_filename_for_label(Some(&label), extension);

    let blob_trait = core_engine::models::BlobTrait {
        id: format!("blob_trait:{}", ulid),
        owner: id.clone(),
        filename,
        storage_id: stored.storage_id.clone(),
        bucket: "local".to_string(),
        mime,
        hash: stored.hash.clone(),
        size: stored.size,
    };

    let entity = Entity {
        id: id.clone(),
        category: EntityKind::Digital,
        label: label.clone(),
        lang_canonical: "en".to_string(),
        metadata: HashMap::new(),
        deleted_at: None,
    };

    st.db.save_entity(entity).await?;
    st.db.save_blob_trait(blob_trait).await?;

    st.bus
        .on_event("entity.created".to_string(), 1, ulid.clone())
        .await;

    app.emit(
        "entity-updated",
        serde_json::json!({
            "topic": "entity.created",
            "ulid": ulid,
            "label": label,
        }),
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
async fn begin_import(
    job_id: String,
    label: String,
    category: String,
    source_path: Option<String>,
    file_name: Option<String>,
    bytes: Option<Vec<u8>>,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let category_enum = match category.as_str() {
        "physical" => EntityKind::Physical,
        "digital" => EntityKind::Digital,
        "abstract" => EntityKind::Abstract,
        "persona" => EntityKind::Persona,
        _ => return Err(format!("Unknown entity category: {}", category)),
    };

    let st = state.lock().await;
    let db = st.db.clone();
    let bus = st.bus.clone();
    let blob = st.blob.clone();
    drop(st);

    async_runtime::spawn(async move {
        emit_import_progress(&app, &job_id, "queued", "Queued for import");
        emit_import_progress(&app, &job_id, "inspecting", "Inspecting source");

        let import_result: Result<String, String> = async {
            let (stored, mime, extension) = if let Some(path) = source_path.clone() {
                emit_import_progress(&app, &job_id, "storing_blob", "Writing blob into local store");
                let stored = blob.store_file(&path, Some(label.clone())).await?;
                let mime = core_engine::blob::infer_mime_from_path(&path);
                let extension = std::path::Path::new(&path)
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.to_string());
                (stored, mime, extension)
            } else if let Some(content) = bytes.clone() {
                let name = file_name.clone().unwrap_or_else(|| label.clone());
                let extension = std::path::Path::new(&name)
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.to_string());
                let mime = core_engine::blob::infer_mime_from_path(&name);
                emit_import_progress(&app, &job_id, "storing_blob", "Writing blob into local store");
                let stored = blob
                    .store_bytes(content, extension.clone(), Some(label.clone()))
                    .await?;
                (stored, mime, extension)
            } else {
                return Err("No import source was provided".to_string());
            };

            emit_import_progress(
                &app,
                &job_id,
                "creating_entity",
                "Creating entity record",
            );
            let ulid = Ulid::new().to_string();
            let id = format!("entity:{}", ulid);
            let filename = core_engine::blob::blob_filename_for_label(
                Some(&label),
                extension.as_deref(),
            );

            let entity = Entity {
                id: id.clone(),
                category: category_enum,
                label: label.clone(),
                lang_canonical: "en".to_string(),
                metadata: HashMap::new(),
                deleted_at: None,
            };
            db.save_entity(entity).await?;

            emit_import_progress(
                &app,
                &job_id,
                "attaching_blob_trait",
                "Attaching blob metadata",
            );
            let blob_trait = core_engine::models::BlobTrait {
                id: format!("blob_trait:{}", ulid),
                owner: id.clone(),
                filename,
                storage_id: stored.storage_id.clone(),
                bucket: "local".to_string(),
                mime,
                hash: stored.hash,
                size: stored.size,
            };
            db.save_blob_trait(blob_trait).await?;
            bus.on_event("entity.created".to_string(), 1, ulid.clone()).await;
            app.emit(
                "entity-updated",
                serde_json::json!({
                    "topic": "entity.created",
                    "ulid": ulid,
                    "label": label,
                }),
            )
            .map_err(|e| e.to_string())?;
            Ok(id)
        }
        .await;

        match import_result {
            Ok(entity_id) => emit_import_finished(
                &app,
                &job_id,
                Some(entity_id),
                "ready",
                "Import complete",
                None,
            ),
            Err(error) => emit_import_finished(
                &app,
                &job_id,
                None,
                "error",
                "Import failed",
                Some(error),
            ),
        }
    });

    Ok(())
}

#[tauri::command]
async fn get_storage_health(
    state: State<'_, Mutex<AppState>>,
) -> Result<StorageHealth, String> {
    let st = state.lock().await;
    compute_storage_health(&st.db, &st.blob).await
}

#[tauri::command]
async fn run_manual_gc(
    state: State<'_, Mutex<AppState>>,
) -> Result<core_engine::gc::GcSweepStats, String> {
    let st = state.lock().await;
    gc::run_garbage_collection(&st.db, &st.blob).await
}

#[tauri::command]
async fn clear_database(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let st = state.lock().await;
    st.db
        .db
        .query(
            "DELETE entity;
             DELETE edge;
             DELETE spatial_trait;
             DELETE temporal_trait;
             DELETE blob_trait;
             DELETE label_trait;
             DELETE entity_history;
             DELETE trait_history;
             DELETE relationship_type;",
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn clear_blob_store(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let st = state.lock().await;
    st.db
        .db
        .query("DELETE blob_trait;")
        .await
        .map_err(|e| e.to_string())?;
    let blob_dir = st.blob.base_dir.clone();
    drop(st);
    if blob_dir.exists() {
        std::fs::remove_dir_all(&blob_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&blob_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn list_entities(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<serde_json::Value>, String> {
    let st = state.lock().await;
    let mut response = st
        .db
        .db
        .query("SELECT *, type::string(id) AS id FROM entity WHERE deleted_at = NONE;")
        .await
        .map_err(|e| e.to_string())?;
    let records: Vec<serde_json::Value> = response.take(0).map_err(|e| e.to_string())?;
    Ok(records)
}

#[tauri::command]
async fn get_spatial_traits(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<SpatialTrait>, String> {
    let st = state.lock().await;
    st.db.get_spatial_traits().await
}

#[tauri::command]
async fn get_blob_traits(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<core_engine::models::BlobTrait>, String> {
    let st = state.lock().await;
    st.db.get_blob_traits().await
}

#[tauri::command]
async fn save_spatial_trait(
    owner: String,
    lat: f64,
    lng: f64,
    alt: f64,
    heading: f64,
    bbox: Option<Vec<f64>>,
    projection: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let trait_ = SpatialTrait {
        id: format!("spatial_trait:{}", owner.replace("entity:", "")),
        owner,
        lat,
        lng,
        alt,
        heading,
        bbox,
        projection,
    };
    let st = state.lock().await;
    st.db.save_spatial_trait(trait_).await
}

#[tauri::command]
async fn get_presigned_url(
    storage_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let st = state.lock().await;
    use core_engine::ports::BlobStorageProvider;
    st.blob.presign_url(&storage_id).await
}

#[tauri::command]
async fn save_blob_content(
    owner: String,
    content: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let mut blob_trait = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == owner)
        .ok_or_else(|| format!("No blob trait attached to {}", owner))?;
    let entity = st.db.get_entity(&owner).await?;

    let ext = core_engine::blob::extension_from_storage_id(&blob_trait.storage_id);
    let stored = st
        .blob
        .store_bytes(content.into_bytes(), ext.clone(), Some(entity.label.clone()))
        .await?;
    blob_trait.filename =
        core_engine::blob::blob_filename_for_label(Some(entity.label.as_str()), ext.as_deref());
    blob_trait.storage_id = stored.storage_id.clone();
    blob_trait.hash = stored.hash;
    blob_trait.size = stored.size;
    st.db.save_blob_trait(blob_trait).await?;

    Ok(())
}

#[tauri::command]
async fn query_context(
    context_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<Entity>, String> {
    let st = state.lock().await;
    st.db.query_context(&context_id).await
}

// Phase 44: N-hop neighborhood
#[derive(serde::Serialize)]
struct NeighborhoodResult {
    entities: Vec<serde_json::Value>,
    edges: Vec<EdgeRecord>,
}

#[tauri::command]
async fn get_entity_neighborhood(
    entity_id: String,
    hops: u8,
    state: State<'_, Mutex<AppState>>,
) -> Result<NeighborhoodResult, String> {
    let st = state.lock().await;
    let (entities, edges) = st.db.get_entity_neighborhood(&entity_id, hops).await?;
    // Serialize entities the same way list_entities does (id as string)
    let entities_json: Vec<serde_json::Value> = entities
        .iter()
        .map(|e| {
            serde_json::json!({
                "id": e.id,
                "category": e.category,
                "label": e.label,
                "lang_canonical": e.lang_canonical,
                "metadata": e.metadata,
                "deleted_at": e.deleted_at,
            })
        })
        .collect();
    Ok(NeighborhoodResult {
        entities: entities_json,
        edges,
    })
}

// Phase 44: Execute SurrealQL and return matching entity IDs as strings
#[tauri::command]
async fn query_entity_ids(
    query: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<String>, String> {
    let st = state.lock().await;
    st.db.query_entity_ids(&query).await
}

// Phase 44: Multilingual label search
#[tauri::command]
async fn search_entities(
    query: String,
    lang: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<serde_json::Value>, String> {
    let st = state.lock().await;
    let entities = st
        .db
        .search_entities_by_label(&query, lang.as_deref())
        .await?;
    let result = entities
        .iter()
        .map(|e| {
            serde_json::json!({
                "id": e.id,
                "category": e.category,
                "label": e.label,
                "lang_canonical": e.lang_canonical,
                "metadata": e.metadata,
                "deleted_at": e.deleted_at,
            })
        })
        .collect();
    Ok(result)
}

#[tauri::command]
async fn add_edge(
    from_id: String,
    to_id: String,
    label: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    st.db.add_edge(&from_id, &to_id, &label).await?;
    app.emit(
        "graph-updated",
        serde_json::json!({"from": from_id, "to": to_id, "label": label}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn add_edge_with_payload(
    from_id: String,
    to_id: String,
    label: String,
    strength: Option<f64>,
    latency: Option<i64>,
    metadata: Option<serde_json::Value>,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    st.db
        .add_edge_with_payload(&from_id, &to_id, &label, strength, latency, metadata)
        .await?;
    app.emit(
        "graph-updated",
        serde_json::json!({"from": from_id, "to": to_id, "label": label}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_edges(state: State<'_, Mutex<AppState>>) -> Result<Vec<EdgeRecord>, String> {
    let st = state.lock().await;
    st.db.get_edges().await
}

#[tauri::command]
async fn run_prolog_query(
    query: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<String>, String> {
    let st = state.lock().await;
    let (tx, rx) = oneshot::channel();
    st.query_tx
        .send((query, tx))
        .await
        .map_err(|_| "Inference engine thread died".to_string())?;
    rx.await
        .map_err(|_| "Failed to recv response".to_string())?
}

#[tauri::command]
async fn execute_sql(query: String, state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let st = state.lock().await;
    let res = st.db.execute_raw_sql(&query).await?;
    Ok(res.join("\n"))
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn create_entity(
    category: String,
    label: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let category_enum = match category.as_str() {
        "physical" => EntityKind::Physical,
        "digital" => EntityKind::Digital,
        "abstract" => EntityKind::Abstract,
        "persona" => EntityKind::Persona,
        _ => return Err(format!("Unknown entity category: {}", category)),
    };
    let ulid = Ulid::new().to_string();
    let id = format!("entity:{}", ulid);
    let entity = Entity {
        id: id.clone(),
        category: category_enum,
        label: label.clone(),
        lang_canonical: "en".to_string(),
        metadata: HashMap::new(),
        deleted_at: None,
    };
    let st = state.lock().await;
    st.db.save_entity(entity).await?;
    st.bus
        .on_event("entity.created".to_string(), 1, ulid.clone())
        .await;
    app.emit(
        "entity-updated",
        serde_json::json!({"topic": "entity.created", "ulid": ulid, "label": label}),
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
async fn update_metadata(
    id: String,
    metadata: serde_json::Value,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let mut entity = st.db.get_entity(&id).await?;
    let map = metadata
        .as_object()
        .ok_or("metadata must be a JSON object".to_string())?;
    entity.metadata = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    st.db.save_entity(entity).await?;
    app.emit(
        "entity-updated",
        serde_json::json!({"topic": "entity.updated", "ulid": id}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_entity(
    id: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    st.db.soft_delete(&id).await?;
    app.emit(
        "entity-updated",
        serde_json::json!({"topic": "entity.deleted", "ulid": id}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn tag_entity(
    target_id: String,
    tag_label: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    // Resolve or create the tag entity
    let tag_id = match st.db.resolve_label(&tag_label).await? {
        Some(id) => id,
        _ => {
            let ulid = Ulid::new().to_string();
            let id = format!("entity:{}", ulid);
            let mut meta = HashMap::new();
            meta.insert("is_tag".to_string(), serde_json::Value::Bool(true));
            let tag_entity = Entity {
                id: id.clone(),
                category: EntityKind::Abstract,
                label: tag_label.clone(),
                lang_canonical: "en".to_string(),
                metadata: meta,
                deleted_at: None,
            };
            st.db.save_entity(tag_entity).await?;
            st.bus.on_event("entity.created".to_string(), 1, ulid).await;
            id
        }
    };
    st.db.add_edge(&target_id, &tag_id, "tagged_as").await?;
    app.emit(
        "graph-updated",
        serde_json::json!({"from": target_id, "to": tag_id, "label": "tagged_as"}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn untag_entity(
    target_id: String,
    tag_label: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let tag_id = st
        .db
        .resolve_label(&tag_label)
        .await?
        .ok_or_else(|| format!("No entity found for tag '{}'", tag_label))?;
    st.db
        .delete_edge(&target_id, &tag_id, Some("tagged_as"))
        .await?;
    app.emit(
        "graph-updated",
        serde_json::json!({"from": target_id, "to": tag_id, "label": "tagged_as"}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn remove_edge(
    from_id: String,
    to_id: String,
    label: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    st.db
        .delete_edge(&from_id, &to_id, label.as_deref())
        .await?;
    app.emit(
        "graph-updated",
        serde_json::json!({"from": from_id, "to": to_id}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_entity_edges(
    entity_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<EdgeRecord>, String> {
    let st = state.lock().await;
    let all_edges = st.db.get_edges().await?;
    let short_id = entity_id.replace("entity:", "");
    Ok(all_edges
        .into_iter()
        .filter(|e| e.from == short_id || e.to == short_id)
        .collect())
}

#[tauri::command]
async fn save_temporal_trait(
    owner: String,
    event_at: Option<String>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    recurrence: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    // Check if a trait for this owner already exists
    let existing = st.db.get_temporal_traits().await?;
    let found = existing.into_iter().find(|t| t.owner == owner);

    let id = found.map(|t| t.id).unwrap_or_else(|| {
        let ulid = ulid::Ulid::new().to_string();
        format!("temporal_trait:{}", ulid)
    });

    let trait_ = TemporalTrait {
        id,
        owner,
        event_at,
        starts_at,
        ends_at,
        recurrence,
    };
    st.db.save_temporal_trait(trait_).await
}

#[tauri::command]
async fn get_temporal_traits(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<TemporalTrait>, String> {
    let st = state.lock().await;
    st.db.get_temporal_traits().await
}

#[tauri::command]
async fn spawn_terminal(
    session_id: String,
    command: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let mut sessions = st.pty_sessions.lock().unwrap();
    if sessions.contains_key(&session_id) {
        return Ok(());
    }

    let pty = PtyHost::spawn(app.clone(), session_id.clone(), command)?;
    let on_exit = pty.on_exit.clone();
    sessions.insert(session_id.clone(), pty);

    // Monitor exit to cleanup the map
    let app_c = app.clone();
    let sid_c = session_id;
    tokio::spawn(async move {
        on_exit.notified().await;
        let state = app_c.state::<Mutex<AppState>>();
        let st = state.lock().await;
        st.pty_sessions.lock().unwrap().remove(&sid_c);
    });

    Ok(())
}

#[tauri::command]
async fn kill_terminal(
    session_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let mut sessions = st.pty_sessions.lock().unwrap();
    // Dropping the PtyHost kills its child process
    sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
async fn write_to_terminal(
    session_id: String,
    input: Vec<u8>,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let sessions = st.pty_sessions.lock().unwrap();
    if let Some(pty) = sessions.get(&session_id) {
        pty.write(&input)?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_terminal(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let sessions = st.pty_sessions.lock().unwrap();
    if let Some(pty) = sessions.get(&session_id) {
        pty.resize(rows, cols)?;
    }
    Ok(())
}

#[tauri::command]
async fn get_terminal_snapshot(
    session_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<u8>, String> {
    let st = state.lock().await;
    let sessions = st.pty_sessions.lock().unwrap();
    if let Some(pty) = sessions.get(&session_id) {
        return pty.snapshot();
    }
    Ok(Vec::new())
}

#[tauri::command]
async fn edit_entity_in_terminal(
    entity_id: String,
    format: String, // "yaml", "json", "markdown"
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    use std::io::Write;
    let st = state.lock().await;

    // Return early if the editor session is already running for this entity
    let session_id = format!("edit-{}", entity_id);
    if st.pty_sessions.lock().unwrap().contains_key(&session_id) {
        return Ok(());
    }

    // 1. Fetch Composite
    let entity = st.db.get_entity(&entity_id).await?;
    let spatial = st
        .db
        .get_spatial_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == entity_id);
    let blobs: Vec<_> = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .filter(|t| t.owner == entity_id)
        .collect();
    let temporal = st
        .db
        .get_temporal_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == entity_id);

    let composite = core_engine::formats::CompositeEntity {
        entity,
        spatial,
        blobs,
        temporal,
    };

    // 2. Serialize
    let content = match format.as_str() {
        "json" => core_engine::formats::to_json(&composite)?,
        "markdown" => core_engine::formats::to_markdown(&composite)?,
        _ => core_engine::formats::to_yaml(&composite)?,
    };

    // 3. Temp file
    let ext = match format.as_str() {
        "json" => "json",
        "markdown" => "md",
        _ => "yaml",
    };
    let mut temp = tempfile::Builder::new()
        .prefix("spatial_edit_")
        .suffix(&format!(".{}", ext))
        .tempfile()
        .map_err(|e| e.to_string())?;

    // Write contents to the tempfile before keeping it
    temp.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    let (_, temp_path) = temp.keep().map_err(|e| e.to_string())?;

    // 4. Editor Command
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "vim".to_string());
    let cmd = format!("{} {}", editor, temp_path.to_string_lossy());

    // 5. Spawn PTY for this editor
    let pty = PtyHost::spawn(app.clone(), session_id.clone(), Some(cmd))?;
    let on_exit = pty.on_exit.clone();

    // Store it so we can write to it
    st.pty_sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), pty);

    // 6. Monitor Exit and Sync
    let entity_id_c = entity_id.clone();
    let format_c = format.clone();
    let app_c = app.clone();
    let session_id_c = session_id.clone();

    tokio::spawn(async move {
        on_exit.notified().await;

        // 7. Read back from temp file
        match std::fs::read_to_string(&temp_path) {
            Ok(new_content) => {
                let result: Result<core_engine::formats::CompositeEntity, String> =
                    match format_c.as_str() {
                        "json" => core_engine::formats::from_json(&new_content),
                        "markdown" => core_engine::formats::from_markdown(&new_content),
                        _ => core_engine::formats::from_yaml(&new_content),
                    };

                if let Ok(updated) = result {
                    let state = app_c.state::<Mutex<AppState>>();
                    let st = state.lock().await;

                    // Ensure the ID matches (don't allow identity theft via editor)
                    let mut entity_to_save = updated.entity;
                    entity_to_save.id = entity_id_c.clone();

                    // Update database (UPSERT)
                    match st.db.save_entity(entity_to_save).await {
                        Ok(_) => {}
                        Err(e) => {
                            tracing::error!(error = %e, "term-edit: db save failed");
                            let _ = app_c.emit("term-edit-error", format!("DB save failed: {}", e));
                        }
                    }

                    if let Some(s) = updated.spatial {
                        let mut s = s;
                        s.owner = entity_id_c.clone();
                        let _ = st.db.save_spatial_trait(s).await;
                    }
                    for mut b in updated.blobs {
                        b.owner = entity_id_c.clone();
                        let _ = st.db.save_blob_trait(b).await;
                    }
                    if let Some(t) = updated.temporal {
                        let mut t = t;
                        t.owner = entity_id_c.clone();
                        let _ = st.db.save_temporal_trait(t).await;
                    }

                    // Trigger bus event for real-time reactivity
                    let ulid = entity_id_c.replace("entity:", "");
                    st.bus
                        .on_event("entity.updated".to_string(), 0, ulid.clone())
                        .await;

                    // Also trigger a refresh on the frontend for everything
                    let _ = app_c.emit(
                        "entity-updated",
                        serde_json::json!({
                            "topic": "entity.updated",
                            "ulid": ulid,
                            "id": entity_id_c
                        }),
                    );
                    // Print green "Saved" in the PTY canvas
                    let saved_bytes = b"\r\n\x1b[1;32m\xe2\x9c\x93 Saved\x1b[0m\r\n".to_vec();
                    let _ = app_c.emit("pty-data", (session_id_c.clone(), saved_bytes));
                } else if let Err(e) = result {
                    tracing::error!(format = %format_c, error = %e, "term-edit: parse failed");
                    let _ = app_c.emit("term-edit-error", format!("Parse failed: {}", e));
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "term-edit: read temp file failed");
                let _ = app_c.emit("term-edit-error", format!("Read failed: {}", e));
            }
        }

        // Delete temp file manually now
        let _ = std::fs::remove_file(&temp_path);

        // 8. Cleanup session
        let state = app_c.state::<Mutex<AppState>>();
        let st = state.lock().await;
        st.pty_sessions.lock().unwrap().remove(&session_id_c);
        let _ = app_c.emit(&format!("{}-exit", session_id_c), ());
    });

    Ok(())
}

// ── Phase 45: Relationship types & trait inheritance ─────────────────────────

#[tauri::command]
async fn save_relationship_type(
    id: Option<String>,
    label: String,
    transitive: bool,
    symmetric: bool,
    inherits_traits: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let record_id = id.unwrap_or_else(|| format!("relationship_type:{}", ulid::Ulid::new()));
    st.db
        .save_relationship_type(RelationshipType {
            id: record_id,
            label,
            transitive,
            symmetric,
            inherits_traits,
        })
        .await
}

#[tauri::command]
async fn list_relationship_types(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<RelationshipType>, String> {
    let st = state.lock().await;
    st.db.list_relationship_types().await
}

#[tauri::command]
async fn delete_relationship_type(
    label: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    st.db.delete_relationship_type(&label).await
}

#[tauri::command]
async fn get_effective_spatial_trait(
    entity_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Option<SpatialTrait>, String> {
    let st = state.lock().await;
    st.db.get_effective_spatial_trait(&entity_id).await
}

// ── Phase 52: Edition Panel commands ─────────────────────────────────────────

fn is_text_mime(mime: &str) -> bool {
    mime.starts_with("text/")
        || mime == "application/json"
        || mime == "application/yaml"
        || mime == "application/x-yaml"
        || mime == "application/x-prolog"
}

fn to_snake_case(s: &str) -> String {
    let raw: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    raw.split('_')
        .filter(|p| !p.is_empty())
        .map(|p| p.to_lowercase())
        .collect::<Vec<_>>()
        .join("_")
}

/// Read the raw text content of a blob by its trait ID.
#[tauri::command]
async fn read_blob_content(
    blob_trait_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let st = state.lock().await;
    let trait_ = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .find(|t| t.id == blob_trait_id)
        .ok_or_else(|| format!("Blob trait not found: {}", blob_trait_id))?;
    if !is_text_mime(&trait_.mime) {
        return Err(format!("Blob {} is not a text file (mime: {})", blob_trait_id, trait_.mime));
    }
    let path = st.blob.base_dir.join(&trait_.storage_id);
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write new text content for a blob (CAS replacement: new hash, updated pointer).
#[tauri::command]
async fn write_blob_content_by_id(
    blob_trait_id: String,
    content: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let blob_traits = st.db.get_blob_traits().await?;
    let mut trait_ = blob_traits
        .into_iter()
        .find(|t| t.id == blob_trait_id)
        .ok_or_else(|| format!("Blob trait not found: {}", blob_trait_id))?;
    let ext = core_engine::blob::extension_from_storage_id(&trait_.storage_id);
    let stored = st
        .blob
        .store_bytes(content.into_bytes(), ext, None)
        .await?;
    trait_.storage_id = stored.storage_id;
    trait_.hash = stored.hash;
    trait_.size = stored.size;
    let owner = trait_.owner.clone();
    st.db.save_blob_trait(trait_).await?;
    app.emit(
        "entity-updated",
        serde_json::json!({"topic": "entity.updated", "ulid": owner}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open a text blob directly in $EDITOR via an embedded PTY session.
#[tauri::command]
async fn edit_blob_in_terminal(
    blob_trait_id: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let session_id = format!("edit-blob-{}", blob_trait_id.replace(':', "-"));
    if st.pty_sessions.lock().unwrap().contains_key(&session_id) {
        return Ok(());
    }
    let trait_ = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .find(|t| t.id == blob_trait_id)
        .ok_or_else(|| format!("Blob trait not found: {}", blob_trait_id))?;
    if !is_text_mime(&trait_.mime) {
        return Err(format!("Blob {} is not a text file (mime: {})", blob_trait_id, trait_.mime));
    }
    let path = st.blob.base_dir.join(&trait_.storage_id);
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "vim".to_string());
    let cmd = format!("{} {}", editor, path.to_string_lossy());
    let pty = PtyHost::spawn(app.clone(), session_id.clone(), Some(cmd))?;
    let on_exit = pty.on_exit.clone();
    st.pty_sessions.lock().unwrap().insert(session_id.clone(), pty);

    // Clean up session when editor exits, then print green "Saved"
    let app_c = app.clone();
    let sid_c  = session_id.clone();
    tokio::spawn(async move {
        on_exit.notified().await;
        let saved_bytes = b"\r\n\x1b[1;32m\xe2\x9c\x93 Saved\x1b[0m\r\n".to_vec();
        let _ = app_c.emit("pty-data", (sid_c.clone(), saved_bytes));
        let state = app_c.state::<Mutex<AppState>>();
        let st = state.lock().await;
        st.pty_sessions.lock().unwrap().remove(&sid_c);
    });

    Ok(())
}

/// Delete a blob trait and its underlying CAS blob.
#[tauri::command]
async fn delete_blob_trait(
    blob_trait_id: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let trait_ = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .find(|t| t.id == blob_trait_id)
        .ok_or_else(|| format!("Blob trait not found: {}", blob_trait_id))?;
    let owner = trait_.owner.clone();
    // Remove the blob trait record
    st.db.delete_blob_trait(&blob_trait_id).await?;
    // Best-effort: delete the underlying CAS file (unreferenced anyway after GC)
    let path = st.blob.base_dir.join(&trait_.storage_id);
    let _ = std::fs::remove_file(path);
    app.emit(
        "entity-updated",
        serde_json::json!({"topic": "entity.updated", "ulid": owner}),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Rename a blob trait (filename only — does not move the CAS file).
#[tauri::command]
async fn rename_blob_trait(
    blob_trait_id: String,
    new_filename: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    let mut trait_ = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .find(|t| t.id == blob_trait_id)
        .ok_or_else(|| format!("Blob trait not found: {}", blob_trait_id))?;
    let owner = trait_.owner.clone();
    trait_.filename = new_filename;
    st.db.save_blob_trait(trait_).await?;
    app.emit(
        "entity-updated",
        serde_json::json!({"topic": "entity.updated", "ulid": owner}),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Serialize an entity + its traits to text (YAML or JSON) for the web editor.
#[tauri::command]
async fn get_entity_text(
    entity_id: String,
    format: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let st = state.lock().await;
    let entity = st.db.get_entity(&entity_id).await?;
    let spatial = st
        .db
        .get_spatial_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == entity_id);
    let blobs: Vec<_> = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .filter(|t| t.owner == entity_id)
        .collect();
    let temporal = st
        .db
        .get_temporal_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == entity_id);
    let composite = core_engine::formats::CompositeEntity { entity, spatial, blobs, temporal };
    match format.as_str() {
        "json" => core_engine::formats::to_json(&composite),
        _ => core_engine::formats::to_yaml(&composite),
    }
}

/// Parse a YAML/JSON text representation and write the entity + traits back.
#[tauri::command]
async fn apply_entity_text(
    entity_id: String,
    content: String,
    format: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let result: core_engine::formats::CompositeEntity = match format.as_str() {
        "json" => core_engine::formats::from_json(&content)?,
        _ => core_engine::formats::from_yaml(&content)?,
    };
    let st = state.lock().await;
    let mut entity = result.entity;
    entity.id = entity_id.clone();
    st.db.save_entity(entity).await?;
    if let Some(mut sp) = result.spatial {
        sp.owner = entity_id.clone();
        st.db.save_spatial_trait(sp).await?;
    }
    if let Some(mut tmp) = result.temporal {
        tmp.owner = entity_id.clone();
        st.db.save_temporal_trait(tmp).await?;
    }
    for mut b in result.blobs {
        b.owner = entity_id.clone();
        st.db.save_blob_trait(b).await?;
    }
    app.emit(
        "entity-updated",
        serde_json::json!({"topic": "entity.updated", "ulid": entity_id}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Create a notes blob for an entity.
/// If `filename` is None the default `{snake_label}.md` is used.
/// Idempotent per filename: returns the existing blob if the name is already taken.
#[tauri::command]
async fn create_entity_notes(
    entity_id: String,
    filename: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<core_engine::models::BlobTrait, String> {
    let st = state.lock().await;
    let entity = st.db.get_entity(&entity_id).await?;
    let filename = filename.unwrap_or_else(|| format!("{}.md", to_snake_case(&entity.label)));
    // Idempotent per filename
    if let Some(existing) = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == entity_id && t.filename == filename)
    {
        return Ok(existing);
    }
    let ulid = Ulid::new().to_string();
    // Each notes blob gets its own unique file (no CAS deduplication for empty content)
    let stored = st.blob.alloc_empty(&ulid, "md")?;
    let trait_ = core_engine::models::BlobTrait {
        id: format!("blob_trait:{}", ulid),
        owner: entity_id.clone(),
        filename,
        storage_id: stored.storage_id,
        bucket: "local".to_string(),
        mime: "text/markdown".to_string(),
        hash: stored.hash,
        size: stored.size,
    };
    st.db.save_blob_trait(trait_.clone()).await?;
    app.emit(
        "entity-updated",
        serde_json::json!({"topic": "entity.updated", "ulid": entity_id}),
    )
    .map_err(|e| e.to_string())?;
    Ok(trait_)
}

// ── Phase 43: Multilingual label commands ─────────────────────────────────────

#[tauri::command]
async fn save_label_trait(
    id: String,
    owner: String,
    lang: String,
    text: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    st.db
        .save_label_trait(LabelTrait {
            id,
            owner,
            lang,
            text,
        })
        .await
}

#[tauri::command]
async fn get_label_traits(
    entity_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<LabelTrait>, String> {
    let st = state.lock().await;
    st.db.get_label_traits(&entity_id).await
}

#[tauri::command]
async fn get_all_label_traits(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<LabelTrait>, String> {
    let st = state.lock().await;
    st.db.get_all_label_traits().await
}

#[tauri::command]
async fn delete_label_trait(id: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let st = state.lock().await;
    st.db.delete_label_trait(&id).await
}

#[tauri::command]
async fn resolve_display_label(
    entity_id: String,
    active_lang: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let st = state.lock().await;
    st.db.resolve_display_label(&entity_id, &active_lang).await
}

// ── Phase 44: History commands ────────────────────────────────────────────────

#[tauri::command]
async fn get_entity_history(
    entity_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<EntitySnapshot>, String> {
    let st = state.lock().await;
    st.db.get_entity_history(&entity_id).await
}

#[tauri::command]
async fn get_entity_as_of(
    entity_id: String,
    timestamp: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Option<EntitySnapshot>, String> {
    let st = state.lock().await;
    st.db.get_entity_as_of(&entity_id, &timestamp).await
}

#[tauri::command]
async fn get_trait_history(
    entity_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<TraitSnapshot>, String> {
    let st = state.lock().await;
    st.db.get_trait_history(&entity_id).await
}

#[tauri::command]
async fn log_frontend(level: String, message: String) {
    match level.as_str() {
        "error" => tracing::error!(source = "frontend", "{}", message),
        "warn" => tracing::warn!(source = "frontend", "{}", message),
        _ => {}
    }
}

#[tauri::command]
async fn open_external_path(path: String) -> Result<(), String> {
    opener::open(&path).map_err(|e: opener::OpenError| e.to_string())
}

// ── App Entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let log_dir = core_engine::db::store_path().join("logs");
            core_engine::logging::init(core_engine::logging::LogConfig {
                level: tracing::Level::INFO,
                log_dir: Some(log_dir),
            });

            let app_handle = app.handle().clone();

            // Everything that calls tokio::spawn (GC, bus listener) must run inside a
            // tokio context.  The setup closure runs on the Tauri event-loop thread — NOT
            // inside tokio — so we block_on an async block that does all the init work.
            // block_on drives the future on Tauri's internal runtime and returns once the
            // future resolves, keeping the setup closure synchronous from Tauri's POV.
            // app.manage() is called after block_on returns, guaranteeing the state is
            // registered before any frontend command can fire.
            let (db, bus, blob, query_tx) = tauri::async_runtime::block_on(async {
                let db = SurrealDbAdapter::new()
                    .await
                    .expect("SurrealDB init failed");
                let bus = EventBus::new();
                let blob_dir = core_engine::db::store_path().join("blobs");
                let blob = LocalBlobAdapter::new(blob_dir);
                let blob_arc = Arc::new(blob.clone());

                // GC needs tokio::spawn — safe here because we're inside block_on
                gc::start_garbage_collection(db.clone(), blob_arc);

                // Fan out broadcast events to the frontend
                let mut rx = bus.sender.subscribe();
                let ah = app_handle.clone();
                tokio::spawn(async move {
                    while let Ok(event) = rx.recv().await {
                        let _ = ah.emit(
                            "entity-updated",
                            serde_json::json!({
                                "topic": event.topic,
                                "ulid": event.ulid,
                                "revision": event.revision,
                            }),
                        );
                    }
                });

                // Prolog Machine in its own dedicated thread
                let (query_tx, mut query_rx) =
                    mpsc::channel::<(String, oneshot::Sender<Result<Vec<String>, String>>)>(32);
                let db_p = db.clone();
                let bus_p = bus.clone();

                std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .unwrap();
                    let local = tokio::task::LocalSet::new();

                    local.block_on(&rt, async move {
                        let machine = Arc::new(prolog_engine::ScryerMachine::new());
                        if let Err(e) =
                            prolog_engine::synchronizer::StateSynchronizerTask::load_all_facts(
                                &machine, &db_p,
                            )
                            .await
                        {
                            tracing::error!(error = %e, "prolog: fact load failed");
                        }

                        let sync_task = prolog_engine::synchronizer::StateSynchronizerTask::new(
                            machine.clone(),
                            db_p.clone(),
                        );
                        let sync_rx = bus_p.sender.subscribe();

                        tokio::task::spawn_local(async move {
                            sync_task.run(sync_rx).await;
                        });

                        let inference = prolog_engine::InferenceEngine::new((*machine).clone());

                        while let Some((query, resp_tx)) = query_rx.recv().await {
                            let res = inference.query(&query).map_err(|e| e.to_string());
                            let _ = resp_tx.send(res);
                        }
                    });
                });

                (db, bus, blob, query_tx)
            });

            // Manage state after block_on — guaranteed before any Tauri command fires
            app.manage(Mutex::new(AppState {
                db,
                bus,
                blob,
                query_tx,
                pty_sessions: std::sync::Mutex::new(HashMap::new()),
            }));

            // Tell the frontend the backend is fully ready.  The webview may have
            // already mounted and tried to invoke commands while block_on was running;
            // this event lets it know it is now safe to call anything.
            tracing::info!("backend ready");
            let _ = app.handle().emit("backend-ready", ());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_frontend,
            open_external_path,
            pick_native_import_files,
            pick_native_import_directory,
            expand_import_sources,
            complete_input_path,
            begin_import,
            get_storage_health,
            run_manual_gc,
            clear_database,
            clear_blob_store,
            ingest_entity,
            list_entities,
            get_spatial_traits,
            save_spatial_trait,
            get_blob_traits,
            get_presigned_url,
            save_blob_content,
            query_context,
            get_entity_neighborhood,
            query_entity_ids,
            search_entities,
            spawn_terminal,
            kill_terminal,
            write_to_terminal,
            resize_terminal,
            get_terminal_snapshot,
            edit_entity_in_terminal,
            add_edge,
            get_edges,
            run_prolog_query,
            execute_sql,
            exit_app,
            create_entity,
            update_metadata,
            delete_entity,
            tag_entity,
            untag_entity,
            remove_edge,
            get_entity_edges,
            save_temporal_trait,
            get_temporal_traits,
            get_entity_history,
            get_entity_as_of,
            get_trait_history,
            add_edge_with_payload,
            save_relationship_type,
            list_relationship_types,
            delete_relationship_type,
            get_effective_spatial_trait,
            save_label_trait,
            get_label_traits,
            get_all_label_traits,
            delete_label_trait,
            resolve_display_label,
            read_blob_content,
            write_blob_content_by_id,
            edit_blob_in_terminal,
            get_entity_text,
            apply_entity_text,
            create_entity_notes,
            delete_blob_trait,
            rename_blob_trait,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
