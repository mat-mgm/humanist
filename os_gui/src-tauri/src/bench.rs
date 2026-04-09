use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use std::time::SystemTime;
use std::collections::HashMap;
use ulid::Ulid;
use core_engine::{
    models::{Entity, EntityKind, SpatialTrait, TemporalTrait},
    ports::{GraphDatabase, StateObserver},
};
use crate::AppState;

#[derive(serde::Serialize)]
pub struct BenchmarkStart {
    pub ulid: String,
    pub t_start: u128,
}

#[tauri::command]
pub async fn benchmark_create_entity(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<BenchmarkStart, String> {
    let st = state.lock().await;
    
    let ulid = Ulid::new().to_string();
    let id = format!("entity:{}", ulid);
    
    // Server-side start time in microseconds
    let t_start = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_micros();

    // Create a dummy entity with Spatial and Temporal traits
    let entity = Entity {
        id: id.clone(),
        kind: EntityKind::Physical,
        label: format!("bench_{}", ulid),
        metadata: HashMap::new(),
        deleted_at: None,
    };
    
    let spatial = SpatialTrait {
        id: format!("spatial_trait:{}", ulid),
        owner: id.clone(),
        lat: 45.0 + (ulid.as_bytes()[0] as f64 / 255.0), // semi-random
        lng: 9.0 + (ulid.as_bytes()[1] as f64 / 255.0),
        alt: 100.0,
        heading: 0.0,
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

    // Emit event to bus
    st.bus.on_event("entity.created".to_string(), 1, ulid.clone()).await;

    // Emit specific benchmark-start event to frontend
    app.emit("benchmark-start", serde_json::json!({
        "ulid": ulid,
        "t_start": t_start
    })).map_err(|e: tauri::Error| e.to_string())?;

    Ok(BenchmarkStart {
        ulid,
        t_start
    })
}

#[tauri::command]
pub async fn benchmark_report_timing(
    _app: AppHandle,
    plane: String,
    trial: u32,
    latency_ms: f64,
) -> Result<(), String> {
    // Attempt to find project root by looking for Cargo.toml or just using relative to CWD
    // For local dev, we assume the user runs from project root or os_gui.
    let mut path = std::env::current_dir().map_err(|e| e.to_string())?;
    
    // If we are in os_gui or os_gui/src-tauri, move up to root
    if path.ends_with("src-tauri") { path.pop(); }
    if path.ends_with("os_gui") { path.pop(); }
    
    let results_dir = path.join(core_engine::BENCHMARK_RESULTS_DIR);
    if !results_dir.exists() {
        std::fs::create_dir_all(&results_dir).map_err(|e| e.to_string())?;
    }
    
    let results_path = results_dir.join("frontend_sync_lag.csv");
    let file_exists = results_path.exists();
    
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&results_path)
        .map_err(|e| format!("Failed to open {}: {}", results_path.display(), e))?;

    use std::io::Write;
    if !file_exists {
        writeln!(file, "plane,trial,latency_ms").map_err(|e| e.to_string())?;
    }
    
    writeln!(file, "{},{},{:.3}", plane, trial, latency_ms).map_err(|e| e.to_string())?;
    
    Ok(())
}
