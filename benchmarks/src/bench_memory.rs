use core_engine::{
    bus::EventBus,
    db::SurrealDbAdapter,
    models::{Entity, EntityKind, SpatialTrait},
    ports::{GraphDatabase, StateObserver},
};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
struct MemorySummary {
    duration_secs: u64,
    samples: usize,
    target_entities: u64,
    actual_entities: u64,
    rss_kb_initial: u64,
    rss_kb_peak: u64,
    rss_kb_final: u64,
    rss_kb_steady_state: u64,
}

/// Self-contained memory profile.
///
/// Runs an ingestion task in this process and samples this process's
/// own RSS while it is running. No GUI required. Optional `--ingest-rate`
/// controls the sustained rate (entities/sec).
pub async fn run_memory_benchmark(duration_secs: u64) -> Result<(), String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Supplementary: Memory Profile (self-contained)");
    println!("══════════════════════════════════════════════════════");
    println!("  Duration: {}s", duration_secs);

    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("could not find project root")?
        .to_path_buf();
    let results_dir = project_root.join(core_engine::BENCHMARK_RESULTS_DIR);
    fs::create_dir_all(&results_dir).map_err(|e| e.to_string())?;

    // Isolated DB store for the load
    let db_dir = project_root.join("target/bench_db/memory");
    if db_dir.exists() {
        let _ = fs::remove_dir_all(&db_dir);
    }
    fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    std::env::set_var("HUMANIST_STORE", &db_dir);

    let db = Arc::new(SurrealDbAdapter::new().await?);
    let bus = Arc::new(EventBus::new());

    let counter = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicU64::new(0));

    // Target ramp: ramp from 0 to ~5000 entities/sec ceiling proportional to duration.
    // We pace ingestion to a steady ~ideal rate; back-pressure naturally limits actual rate.
    let target_total: u64 = (duration_secs.saturating_mul(83)).max(5000);

    let csv_path = results_dir.join("memory_profile.csv");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&csv_path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "timestamp_ms,rss_kb,entities_ingested").map_err(|e| e.to_string())?;

    let pid = std::process::id();
    let initial_rss = get_rss(pid).unwrap_or(0);
    println!("  Sampling PID {} (rss={} KB)", pid, initial_rss);

    // Spawn ingestion task
    let db_w = Arc::clone(&db);
    let bus_w = Arc::clone(&bus);
    let counter_w = Arc::clone(&counter);
    let stop_w = Arc::clone(&stop);
    let ingest_handle = tokio::spawn(async move {
        let mut i: u64 = 0;
        let interval = Duration::from_micros(12_000); // ~83 Hz pace
        while stop_w.load(Ordering::Relaxed) == 0 && i < target_total {
            let ulid = ulid::Ulid::new().to_string();
            let entity = Entity {
                id: format!("entity:{}", ulid),
                category: EntityKind::Physical,
                label: format!("mem_{}", i),
                lang_canonical: "en".to_string(),
                deleted_at: None,
            };
            if db_w.save_entity(entity.clone()).await.is_ok() {
                let trait_ = SpatialTrait {
                    id: format!("spatial_trait:mem_{}", ulid),
                    owner: entity.id.clone(),
                    lat: 0.0,
                    lng: 0.0,
                    alt: 0.0,
                    heading: 0.0,
                    bbox: None,
                    projection: "EPSG:4326".to_string(),
                };
                let _ = db_w.save_spatial_trait(trait_).await;
                let _ = bus_w.on_event("entity.created".to_string(), 1, ulid).await;
                counter_w.fetch_add(1, Ordering::Relaxed);
            }
            i += 1;
            tokio::time::sleep(interval).await;
        }
    });

    // Sampling loop
    let start = Instant::now();
    let epoch_start = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let sampling_interval = Duration::from_millis(500);
    let mut samples = 0usize;
    let mut peak_rss = initial_rss;
    let mut last_rss = initial_rss;

    while start.elapsed().as_secs() < duration_secs {
        let now_ms = epoch_start + start.elapsed().as_millis();
        let rss = get_rss(pid).unwrap_or(0);
        let count = counter.load(Ordering::Relaxed);
        writeln!(file, "{},{},{}", now_ms, rss, count).map_err(|e| e.to_string())?;
        peak_rss = peak_rss.max(rss);
        last_rss = rss;
        samples += 1;
        tokio::time::sleep(sampling_interval).await;
    }

    // Stop ingestion, allow steady state
    stop.store(1, Ordering::Relaxed);
    let _ = ingest_handle.await;

    // 10s steady-state observation
    let steady_start = Instant::now();
    let mut steady_samples: Vec<u64> = Vec::new();
    while steady_start.elapsed().as_secs() < 10 {
        let now_ms = epoch_start + start.elapsed().as_millis();
        let rss = get_rss(pid).unwrap_or(0);
        let count = counter.load(Ordering::Relaxed);
        writeln!(file, "{},{},{}", now_ms, rss, count).map_err(|e| e.to_string())?;
        steady_samples.push(rss);
        last_rss = rss;
        peak_rss = peak_rss.max(rss);
        samples += 1;
        tokio::time::sleep(sampling_interval).await;
    }

    let actual_count = counter.load(Ordering::Relaxed);
    let steady_state = if steady_samples.is_empty() {
        last_rss
    } else {
        steady_samples.iter().sum::<u64>() / steady_samples.len() as u64
    };

    let summary = MemorySummary {
        duration_secs,
        samples,
        target_entities: target_total,
        actual_entities: actual_count,
        rss_kb_initial: initial_rss,
        rss_kb_peak: peak_rss,
        rss_kb_final: last_rss,
        rss_kb_steady_state: steady_state,
    };

    let summary_path = results_dir.join("memory_profile_summary.json");
    let json = serde_json::to_string_pretty(&summary).map_err(|e| e.to_string())?;
    fs::write(&summary_path, json).map_err(|e| e.to_string())?;

    println!(
        "  Ingested {} / {} entities | RSS init={}KB peak={}KB steady={}KB",
        actual_count, target_total, initial_rss, peak_rss, steady_state
    );
    println!("  ✓ CSV:     {}", csv_path.display());
    println!("  ✓ Summary: {}", summary_path.display());

    std::env::remove_var("HUMANIST_STORE");
    Ok(())
}

/// Legacy load-generator subcommand kept for backward compatibility — now a no-op
/// since memory profiling runs in-process. Reserved for re-introduction if the
/// GUI-coupled profile is ever revived.
pub async fn run_load_generator(_duration_secs: u64) -> Result<(), String> {
    Err("ingest-load is deprecated; bench_memory now runs ingestion in-process".to_string())
}

fn get_rss(pid: u32) -> Option<u64> {
    let status_path = format!("/proc/{}/status", pid);
    let contents = fs::read_to_string(status_path).ok()?;
    for line in contents.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if !parts.is_empty() {
                return parts[0].parse().ok();
            }
        }
    }
    None
}
