use core_engine::{
    db::SurrealDbAdapter,
    models::{Entity, EntityKind, SpatialTrait},
    ports::{GraphDatabase, StateObserver, BlobStorageProvider},
    bus::EventBus,
    blob::LocalBlobAdapter,
    gc,
};
use ulid::Ulid;
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

// ── Shared App State ─────────────────────────────────────────────────────────

pub struct AppState {
    pub db: SurrealDbAdapter,
    pub bus: EventBus,
    pub blob: LocalBlobAdapter,
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
        tags: vec!["gui_ingested".to_string()],
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
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let ulid = Ulid::new().to_string();
    let trait_ = SpatialTrait {
        id: format!("spatial_trait:{}", ulid),
        owner,
        lat,
        lng,
        alt,
        heading,
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

// ── App Entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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

                app_handle.manage(Mutex::new(AppState { db, bus: bus_clone, blob }));
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ingest_entity,
            list_entities,
            get_spatial_traits,
            save_spatial_trait,
            get_blob_traits,
            get_presigned_url,
            query_context,
            add_edge,
            get_edges,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
