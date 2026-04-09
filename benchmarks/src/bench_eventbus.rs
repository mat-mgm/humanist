use core_engine::{
    db::SurrealDbAdapter,
    models::{Entity, EntityKind},
    ports::{GraphDatabase, StateObserver},
    bus::EventBus,
};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;

use crate::config::{BenchConfig, EventBusBenchSpec};
use crate::stats::{self, Stats};

#[derive(Debug, Serialize)]
struct BatchSummary {
    batch_size: usize,
    stats: Stats,
}

/// Initializes a fresh SurrealDB at the given path.
async fn fresh_db(db_dir: &PathBuf) -> Result<SurrealDbAdapter, String> {
    // Purge and recreate
    if db_dir.exists() {
        std::fs::remove_dir_all(db_dir).map_err(|e| format!("Failed to purge bench DB: {}", e))?;
    }
    std::fs::create_dir_all(db_dir).map_err(|e| e.to_string())?;

    // Temporarily set env var so SurrealDbAdapter uses our path
    std::env::set_var("SPATIAL_OS_STORE", db_dir.parent().unwrap_or(db_dir));
    let db = SurrealDbAdapter::new().await?;
    Ok(db)
}

pub async fn run_eventbus_benchmark(config: &BenchConfig, spec: &EventBusBenchSpec) -> Result<(), String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Benchmark 1: EventBus Throughput");
    println!("  Trials: {} (warmup: {})", config.trials, config.warmup);
    println!("  Batch sizes: {:?}", spec.batch_sizes);
    println!("══════════════════════════════════════════════════════\n");

    std::fs::create_dir_all(&config.output_dir).map_err(|e| e.to_string())?;

    let csv_path = config.output_dir.join("eventbus_throughput.csv");
    let mut csv_writer = csv::Writer::from_path(&csv_path).map_err(|e| e.to_string())?;

    // Write CSV header
    csv_writer.write_record(["batch_size", "trial", "entity_index", "latency_us"])
        .map_err(|e| e.to_string())?;

    let mut summaries: Vec<BatchSummary> = Vec::new();

    for &batch_size in &spec.batch_sizes {
        println!("  ┌─ Batch size: {}", batch_size);
        let mut all_latencies: Vec<f64> = Vec::new();

        for trial in 0..config.trials {
            let is_warmup = trial < config.warmup;
            let trial_label = if is_warmup {
                format!("  │  warmup {}/{}", trial + 1, config.warmup)
            } else {
                format!("  │  trial  {}/{}", trial - config.warmup + 1, config.measured_trials())
            };

            // Fresh DB for each trial
            let db_trial_dir = config.db_dir.join(format!("eventbus_trial_{}", trial));
            let db = fresh_db(&db_trial_dir).await?;
            let bus = EventBus::new();
            let mut rx = bus.sender.subscribe();

            let mut trial_latencies: Vec<f64> = Vec::new();

            for i in 0..batch_size {
                let ulid = ulid::Ulid::new().to_string();
                let entity_id = format!("entity:{}", ulid);
                let entity = Entity {
                    id: entity_id,
                    kind: EntityKind::Physical,
                    label: format!("bench_{}", i),
                    metadata: std::collections::HashMap::new(),
                    deleted_at: None,
                };

                let t_start = Instant::now();
                db.save_entity(entity).await?;
                bus.on_event("entity.created".to_string(), trial as u64, ulid).await;
                let _event = rx.recv().await.map_err(|e| e.to_string())?;
                let latency = t_start.elapsed();

                let latency_us = latency.as_secs_f64() * 1_000_000.0;
                trial_latencies.push(latency_us);

                if !is_warmup {
                    csv_writer.write_record(&[
                        batch_size.to_string(),
                        (trial - config.warmup).to_string(),
                        i.to_string(),
                        format!("{:.2}", latency_us),
                    ]).map_err(|e| e.to_string())?;
                }
            }

            if !is_warmup {
                all_latencies.extend_from_slice(&trial_latencies);
            }

            let mut tl = trial_latencies.clone();
            let ts = stats::compute_stats(&mut tl);
            println!("{} — median={:.0}µs", trial_label, ts.median);

            // Cleanup trial DB directory
            let _ = std::fs::remove_dir_all(&db_trial_dir);
        }

        // Compute summary for this batch size
        let s = stats::compute_stats(&mut all_latencies);
        println!("  └─ Summary: {}\n", s);
        summaries.push(BatchSummary { batch_size, stats: s });
    }

    csv_writer.flush().map_err(|e| e.to_string())?;
    println!("  ✓ CSV written to: {}", csv_path.display());

    // Write JSON summary
    let summary_path = config.output_dir.join("eventbus_summary.json");
    let json = serde_json::to_string_pretty(&summaries).map_err(|e| e.to_string())?;
    std::fs::write(&summary_path, json).map_err(|e| e.to_string())?;
    println!("  ✓ Summary written to: {}", summary_path.display());

    // Restore env
    std::env::remove_var("SPATIAL_OS_STORE");

    Ok(())
}
