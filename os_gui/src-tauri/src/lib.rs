use core_engine::{
    db::SurrealDbAdapter,
    models::{Entity, EntityKind, SpatialTrait, TemporalTrait},
    ports::{GraphDatabase, StateObserver, BlobStorageProvider},
    bus::EventBus,
    blob::LocalBlobAdapter,
    gc,
};
use ulid::Ulid;
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{Mutex, mpsc, oneshot};

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

    // Upload to blob store (path handoff — Rust processes the file, not the GUI)
    let storage_id = format!("{}/{}", ulid, std::path::Path::new(&file_path)
        .file_name().and_then(|n| n.to_str()).unwrap_or("blob"));
        
    let immutable_path = match st.blob.upload(&file_path, &storage_id).await {
        Ok(_) => st.blob.presign_url(&storage_id).await.unwrap_or(file_path.clone()),
        Err(e) => {
            eprintln!("Blob upload warning: {}", e);
            file_path.clone()
        }
    };

    let size = std::fs::metadata(&file_path).map(|m| m.len() as i64).unwrap_or(0);
    let l_path = file_path.to_lowercase();
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

    let entity = Entity {
        id: id.clone(),
        kind: EntityKind::Blob,
        label: label.clone(),
        metadata: {
            let mut m = HashMap::new();
            m.insert("source_path".to_string(), serde_json::Value::String(immutable_path));
            m
        },
        deleted_at: None,
    };

    st.db.save_entity(entity).await?;
    st.db.save_blob_trait(blob_trait).await?;

    st.bus.on_event("entity.created".to_string(), 1, ulid.clone()).await;

    app.emit("entity-updated", serde_json::json!({
        "topic": "entity.created",
        "ulid": ulid,
        "label": label,
    })).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
async fn list_entities(state: State<'_, Mutex<AppState>>) -> Result<Vec<serde_json::Value>, String> {
    let st = state.lock().await;
    let mut response = st.db.db.query("SELECT *, type::string(id) AS id FROM entity WHERE deleted_at = NONE;")
        .await.map_err(|e| e.to_string())?;
    let records: Vec<serde_json::Value> = response.take(0).map_err(|e| e.to_string())?;
    Ok(records)
}

#[tauri::command]
async fn get_spatial_traits(state: State<'_, Mutex<AppState>>) -> Result<Vec<SpatialTrait>, String> {
    let st = state.lock().await;
    st.db.get_spatial_traits().await
}

#[tauri::command]
async fn get_blob_traits(state: State<'_, Mutex<AppState>>) -> Result<Vec<core_engine::models::BlobTrait>, String> {
    let st = state.lock().await;
    let result = st.db.get_blob_traits().await;
    if let Ok(ref traits) = result {
        eprintln!("[DEBUG] get_blob_traits returned {} records", traits.len());
        for t in traits {
            eprintln!("  blob id={} owner={} mime={}", t.id, t.owner, t.mime);
        }
    } else {
        eprintln!("[DEBUG] get_blob_traits error: {:?}", result);
    }
    result
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
    storage_id: String,
    content: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let st = state.lock().await;
    use core_engine::ports::BlobStorageProvider;
    st.blob.save_content(&storage_id, content.into_bytes()).await
}

#[tauri::command]
async fn query_context(
    context_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<Entity>, String> {
    let st = state.lock().await;
    st.db.query_context(&context_id).await
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
    app.emit("graph-updated", serde_json::json!({"from": from_id, "to": to_id, "label": label}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_edges(state: State<'_, Mutex<AppState>>) -> Result<Vec<serde_json::Value>, String> {
    let st = state.lock().await;
    let edges = st.db.get_edges().await?;
    Ok(edges.into_iter().map(|(f, t, l)| serde_json::json!({"from": f, "to": t, "label": l})).collect())
}

#[tauri::command]
async fn run_prolog_query(query: String, state: State<'_, Mutex<AppState>>) -> Result<Vec<String>, String> {
    let st = state.lock().await;
    let (tx, rx) = oneshot::channel();
    st.query_tx.send((query, tx)).await.map_err(|_| "Inference engine thread died".to_string())?;
    rx.await.map_err(|_| "Failed to recv response".to_string())?
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
    kind: String,
    label: String,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let kind_enum = match kind.as_str() {
        "physical"  => EntityKind::Physical,
        "digital"   => EntityKind::Digital,
        "abstract"  => EntityKind::Abstract,
        "agent"     => EntityKind::Agent,
        "blob"      => EntityKind::Blob,
        "temporal"  => EntityKind::Temporal,
        _ => return Err(format!("Unknown entity kind: {}", kind)),
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
    let st = state.lock().await;
    st.db.save_entity(entity).await?;
    st.bus.on_event("entity.created".to_string(), 1, ulid.clone()).await;
    app.emit("entity-updated", serde_json::json!({"topic": "entity.created", "ulid": ulid, "label": label}))
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
    let map = metadata.as_object().ok_or("metadata must be a JSON object".to_string())?;
    entity.metadata = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    st.db.save_entity(entity).await?;
    app.emit("entity-updated", serde_json::json!({"topic": "entity.updated", "ulid": id}))
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
    app.emit("entity-updated", serde_json::json!({"topic": "entity.deleted", "ulid": id}))
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
                kind: EntityKind::Abstract,
                label: tag_label.clone(),
                metadata: meta,
                deleted_at: None,
            };
            st.db.save_entity(tag_entity).await?;
            st.bus.on_event("entity.created".to_string(), 1, ulid).await;
            id
        }
    };
    st.db.add_edge(&target_id, &tag_id, "tagged_as").await?;
    app.emit("graph-updated", serde_json::json!({"from": target_id, "to": tag_id, "label": "tagged_as"}))
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
    let tag_id = st.db.resolve_label(&tag_label).await?
        .ok_or_else(|| format!("No entity found for tag '{}'", tag_label))?;
    st.db.delete_edge(&target_id, &tag_id, Some("tagged_as")).await?;
    app.emit("graph-updated", serde_json::json!({"from": target_id, "to": tag_id, "label": "tagged_as"}))
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
    st.db.delete_edge(&from_id, &to_id, label.as_deref()).await?;
    app.emit("graph-updated", serde_json::json!({"from": from_id, "to": to_id}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_entity_edges(
    entity_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<serde_json::Value>, String> {
    let st = state.lock().await;
    let all_edges = st.db.get_edges().await?;
    // Strip the "entity:" prefix the same way get_edges returns short ids
    let short_id = entity_id.replace("entity:", "");
    let filtered: Vec<serde_json::Value> = all_edges.into_iter()
        .filter(|(f, t, _)| f == &short_id || t == &short_id)
        .map(|(f, t, l)| serde_json::json!({"from": f, "to": t, "label": l}))
        .collect();
    Ok(filtered)
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
async fn edit_entity_in_terminal(
    entity_id: String,
    format: String, // "yaml", "json", "markdown"
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    use std::io::Write;
    let st = state.lock().await;
    
    // 1. Fetch Composite
    let entity = st.db.get_entity(&entity_id).await?;
    let spatial = st.db.get_spatial_traits().await?.into_iter().find(|t| t.owner == entity_id);
    let blob = st.db.get_blob_traits().await?.into_iter().find(|t| t.owner == entity_id);
    let temporal = st.db.get_temporal_traits().await?.into_iter().find(|t| t.owner == entity_id);

    let composite = core_engine::formats::CompositeEntity {
        entity,
        spatial,
        blob,
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
    temp.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    let (_, temp_path) = temp.keep().map_err(|e| e.to_string())?;

    // 4. Editor Command
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "vim".to_string());
    let cmd = format!("{} {}", editor, temp_path.to_string_lossy());

    // 5. Spawn PTY for this editor
    let session_id = format!("edit-{}", entity_id);
    let pty = PtyHost::spawn(app.clone(), session_id.clone(), Some(cmd))?;
    let on_exit = pty.on_exit.clone();
    
    // Store it so we can write to it
    st.pty_sessions.lock().unwrap().insert(session_id.clone(), pty);

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
                let result: Result<core_engine::formats::CompositeEntity, String> = match format_c.as_str() {
                    "json" => core_engine::formats::from_json(&new_content),
                    "markdown" => core_engine::formats::from_markdown(&new_content),
                    _ => core_engine::formats::from_yaml(&new_content),
                };

                if let Ok(updated) = result {
                println!("[TERM_EDIT] Syncing back {} (format: {})", entity_id_c, format_c);
                let state = app_c.state::<Mutex<AppState>>();
                let st = state.lock().await;

                // Ensure the ID matches (don't allow identity theft via editor)
                let mut entity_to_save = updated.entity;
                entity_to_save.id = entity_id_c.clone();

                // Update database (UPSERT)
                match st.db.save_entity(entity_to_save).await {
                    Ok(_) => println!("[TERM_EDIT] Successfully saved entity {}", entity_id_c),
                    Err(e) => {
                        eprintln!("[TERM_EDIT] Failed to save entity: {}", e);
                        let _ = app_c.emit("term-edit-error", format!("DB save failed: {}", e));
                    }
                }
                
                if let Some(s) = updated.spatial { 
                    let mut s = s; s.owner = entity_id_c.clone();
                    let _ = st.db.save_spatial_trait(s).await; 
                }
                if let Some(b) = updated.blob { 
                    let mut b = b; b.owner = entity_id_c.clone();
                    let _ = st.db.save_blob_trait(b).await; 
                }
                if let Some(t) = updated.temporal { 
                    let mut t = t; t.owner = entity_id_c.clone();
                    let _ = st.db.save_temporal_trait(t).await; 
                }
                
                // Trigger bus event for real-time reactivity
                let ulid = entity_id_c.replace("entity:", "");
                st.bus.on_event("entity.updated".to_string(), 0, ulid.clone()).await;
                
                // Also trigger a refresh on the frontend for everything
                let _ = app_c.emit("entity-updated", serde_json::json!({
                    "topic": "entity.updated",
                    "ulid": ulid,
                    "id": entity_id_c
                }));
            } else if let Err(e) = result {
                eprintln!("[TERM_EDIT] Failed to parse {} editor content: {}", format_c, e);
                let _ = app_c.emit("term-edit-error", format!("Parse failed: {}", e));
            }
        }
        Err(e) => {
            eprintln!("[TERM_EDIT] Failed to read temp file {}: {}", temp_path.display(), e);
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

#[tauri::command]
async fn open_external_path(path: String) -> Result<(), String> {
    println!("[OPENER] Attempting to open: {}", path);
    opener::open(&path).map_err(|e: opener::OpenError| e.to_string())
}

// ── App Entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let db = SurrealDbAdapter::new().await.expect("SurrealDB init failed");
                let bus = EventBus::new();
                let blob_dir = core_engine::db::store_path().join("blobs");
                let blob = LocalBlobAdapter::new(blob_dir);
                let blob_arc = Arc::new(blob.clone());
                gc::start_garbage_collection(db.clone(), blob_arc);

                // Fan out broadcast events as Tauri IPC events
                let mut rx = bus.sender.subscribe();
                let bus_clone = bus.clone();
                let ah = app_handle.clone();
                tokio::spawn(async move {
                    while let Ok(event) = rx.recv().await {
                        let _ = ah.emit("entity-updated", serde_json::json!({
                            "topic": event.topic,
                            "ulid": event.ulid,
                            "revision": event.revision,
                        }));
                    }
                });

                // Prolog Machine Injection in Dedicated Thread
                let (query_tx, mut query_rx) = mpsc::channel::<(String, oneshot::Sender<Result<Vec<String>, String>>)>(32);
                let db_p = db.clone();
                let bus_p = bus_clone.clone();

                std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
                    let local = tokio::task::LocalSet::new();

                    local.block_on(&rt, async move {
                        let machine = Arc::new(prolog_engine::ScryerMachine::new());
                        if let Err(e) = prolog_engine::synchronizer::StateSynchronizerTask::load_all_facts(&machine, &db_p).await {
                            eprintln!("Failed to load facts into Prolog Engine: {}", e);
                        }

                        let sync_task = prolog_engine::synchronizer::StateSynchronizerTask::new(machine.clone(), db_p.clone());
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

                app_handle.manage(Mutex::new(AppState { 
                    db, 
                    bus: bus_clone, 
                    blob, 
                    query_tx,
                    pty_sessions: std::sync::Mutex::new(HashMap::new()),
                }));
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_external_path,
            ingest_entity,
            list_entities,
            get_spatial_traits,
            save_spatial_trait,
            get_blob_traits,
            get_presigned_url,
            save_blob_content,
            query_context,
            spawn_terminal,
            kill_terminal,
            write_to_terminal,
            resize_terminal,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
