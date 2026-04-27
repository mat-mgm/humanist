use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use std::time::SystemTime;
use ulid::Ulid;
use core_engine::{
    models::{Entity, EntityKind, SpatialTrait, TemporalTrait},
    ports::{GraphDatabase, StateObserver},
};
use crate::AppState;

#[derive(serde::Serialize)]
pub struct BenchmarkStart {
    pub suite_id: String,
    pub ulid: String,
    pub trial: u32,
    pub measured: bool,
    pub t_commit_us: u128,
}

#[tauri::command]
pub async fn benchmark_create_entity(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    suite_id: String,
    trial: u32,
    measured: bool,
) -> Result<BenchmarkStart, String> {
    let st = state.lock().await;

    let ulid = Ulid::new().to_string();
    let id = format!("entity:{}", ulid);

    // Create a benchmark entity with the exact trait mix the thesis describes
    // for frontend sync: one entity visible on the graph, globe, and timeline.
    let entity = Entity {
        id: id.clone(),
        category: EntityKind::Physical,
        label: format!("bench_{}", ulid),
        lang_canonical: "en".to_string(),
        deleted_at: None,
    };
    
    let spatial = SpatialTrait {
        id: format!("spatial_trait:{}", ulid),
        owner: id.clone(),
        lat: 45.0 + (ulid.as_bytes()[0] as f64 / 255.0), // semi-random
        lng: 9.0 + (ulid.as_bytes()[1] as f64 / 255.0),
        alt: 100.0,
        heading: 0.0,
        bbox: None,
        projection: "EPSG:4326".to_string(),
    };

    let temporal = TemporalTrait {
        id: format!("temporal_trait:{}", ulid),
        owner: id.clone(),
        event_at: Some("2026-04-09T00:00:00Z".to_string()),
        starts_at: None,
        ends_at: None,
        recurrence: None,
    };

    // Save to DB
    st.db.save_entity(entity).await?;
    st.db.save_spatial_trait(spatial).await?;
    st.db.save_temporal_trait(temporal).await?;

    // Capture the backend timestamp after persistence has completed and just
    // before the event is emitted toward the frontend.
    let t_commit_us = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_micros();

    // Emit event to bus
    st.bus.on_event("entity.created".to_string(), 1, ulid.clone()).await;

    // Emit specific benchmark-start event to frontend
    app.emit("benchmark-start", serde_json::json!({
        "suite_id": suite_id,
        "ulid": ulid,
        "trial": trial,
        "measured": measured,
        "t_commit_us": t_commit_us
    })).map_err(|e: tauri::Error| e.to_string())?;

    Ok(BenchmarkStart {
        suite_id,
        ulid,
        trial,
        measured,
        t_commit_us,
    })
}

#[tauri::command]
pub async fn benchmark_reset_results(
    _app: AppHandle,
    suite_id: String,
    total_trials: u32,
    warmup: u32,
) -> Result<(), String> {
    let mut path = std::env::current_dir().map_err(|e| e.to_string())?;

    if path.ends_with("src-tauri") { path.pop(); }
    if path.ends_with("os_gui") { path.pop(); }

    let results_dir = path.join(core_engine::BENCHMARK_RESULTS_DIR);
    if !results_dir.exists() {
        std::fs::create_dir_all(&results_dir).map_err(|e| e.to_string())?;
    }

    let results_path = results_dir.join("frontend_sync_lag.csv");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&results_path)
        .map_err(|e| format!("Failed to open {}: {}", results_path.display(), e))?;

    use std::io::Write;
    writeln!(file, "# suite_id={},total_trials={},warmup={}", suite_id, total_trials, warmup)
        .map_err(|e| e.to_string())?;
    writeln!(file, "suite_id,trial,measured,plane,status,ulid,latency_ms")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn benchmark_report_timing(
    _app: AppHandle,
    suite_id: String,
    plane: String,
    trial: u32,
    measured: bool,
    ulid: String,
    status: String,
    latency_ms: Option<f64>,
) -> Result<(), String> {
    let mut path = std::env::current_dir().map_err(|e| e.to_string())?;

    if path.ends_with("src-tauri") { path.pop(); }
    if path.ends_with("os_gui") { path.pop(); }

    let results_dir = path.join(core_engine::BENCHMARK_RESULTS_DIR);
    if !results_dir.exists() {
        std::fs::create_dir_all(&results_dir).map_err(|e| e.to_string())?;
    }

    let results_path = results_dir.join("frontend_sync_lag.csv");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&results_path)
        .map_err(|e| format!("Failed to open {}: {}", results_path.display(), e))?;

    use std::io::Write;
    let latency = latency_ms
        .map(|value| format!("{value:.3}"))
        .unwrap_or_default();

    writeln!(
        file,
        "{},{},{},{},{},{},{}",
        suite_id,
        trial,
        measured,
        plane,
        status,
        ulid,
        latency
    ).map_err(|e| e.to_string())?;

    Ok(())
}
