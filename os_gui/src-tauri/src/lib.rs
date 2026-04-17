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
use std::{collections::HashMap, sync::Arc};
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
    let spatial = st
        .db
        .get_spatial_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == entity_id);
    let blob = st
        .db
        .get_blob_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == entity_id);
    let temporal = st
        .db
        .get_temporal_traits()
        .await?
        .into_iter()
        .find(|t| t.owner == entity_id);

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
    temp.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    let (_, temp_path) = temp.keep().map_err(|e| e.to_string())?;

    // 4. Editor Command
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "vim".to_string());
    let cmd = format!("{} {}", editor, temp_path.to_string_lossy());

    // 5. Spawn PTY for this editor
    let session_id = format!("edit-{}", entity_id);
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
                    println!(
                        "[TERM_EDIT] Syncing back {} (format: {})",
                        entity_id_c, format_c
                    );
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
                        let mut s = s;
                        s.owner = entity_id_c.clone();
                        let _ = st.db.save_spatial_trait(s).await;
                    }
                    if let Some(b) = updated.blob {
                        let mut b = b;
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
                } else if let Err(e) = result {
                    eprintln!(
                        "[TERM_EDIT] Failed to parse {} editor content: {}",
                        format_c, e
                    );
                    let _ = app_c.emit("term-edit-error", format!("Parse failed: {}", e));
                }
            }
            Err(e) => {
                eprintln!(
                    "[TERM_EDIT] Failed to read temp file {}: {}",
                    temp_path.display(),
                    e
                );
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
                            eprintln!("Failed to load facts into Prolog Engine: {}", e);
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
            let _ = app.handle().emit("backend-ready", ());

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
            get_entity_neighborhood,
            query_entity_ids,
            search_entities,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
