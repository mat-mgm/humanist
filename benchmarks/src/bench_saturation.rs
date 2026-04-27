use core_engine::{
    bus::EventBus,
    db::SurrealDbAdapter,
    models::{Entity, EntityKind},
    ports::{GraphDatabase, StateObserver},
};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;

use crate::config::BenchConfig;
use crate::stats::{self, Stats};

#[derive(Debug, Serialize)]
struct SaturationSummary {
    subscribers: usize,
    batch_size: usize,
    stats: Stats,
}

async fn fresh_db(db_dir: &PathBuf) -> Result<SurrealDbAdapter, String> {
    if db_dir.exists() {
        std::fs::remove_dir_all(db_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(db_dir).map_err(|e| e.to_string())?;
    std::env::set_var("HUMANIST_STORE", db_dir);
    SurrealDbAdapter::new().await
}

/// Sub-experiment: vary subscriber count to characterise EventBus
/// fan-out cost. Fixed batch size; subscriber counts: [1, 4, 16, 64].
pub async fn run_saturation_benchmark(
    config: &BenchConfig,
    subscriber_counts: &[usize],
    batch_size: usize,
) -> Result<(), String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Sub-experiment: EventBus Fan-out Saturation");
    println!("  Trials: {} (warmup: {})", config.trials, config.warmup);
    println!("  Subscribers: {:?} | Batch: {}", subscriber_counts, batch_size);
    println!("══════════════════════════════════════════════════════\n");

    std::fs::create_dir_all(&config.output_dir).map_err(|e| e.to_string())?;
    let csv_path = config.output_dir.join("eventbus_saturation.csv");
    let mut csv_writer = csv::Writer::from_path(&csv_path).map_err(|e| e.to_string())?;
    csv_writer
        .write_record(["subscribers", "batch_size", "trial", "entity_index", "latency_us"])
        .map_err(|e| e.to_string())?;

    let mut summaries: Vec<SaturationSummary> = Vec::new();

    for &subs in subscriber_counts {
        println!("  ┌─ Subscribers: {}", subs);
        let mut all_latencies: Vec<f64> = Vec::new();

        for trial in 0..config.trials {
            let is_warmup = trial < config.warmup;
            let db_dir = config
                .db_dir
                .join(format!("saturation_{}_{}", subs, trial));
            let db = fresh_db(&db_dir).await?;
            let bus = EventBus::new();

            // Spawn N subscribers, each consuming events to keep the broadcast
            // channel from filling up. We measure round-trip on the *primary*
            // subscriber.
            let mut primary_rx = bus.sender.subscribe();
            let mut secondaries = Vec::new();
            for _ in 1..subs {
                let mut rx = bus.sender.subscribe();
                let h = tokio::spawn(async move {
                    while rx.recv().await.is_ok() {}
                });
                secondaries.push(h);
            }

            for i in 0..batch_size {
                let ulid = ulid::Ulid::new().to_string();
                let entity = Entity {
                    id: format!("entity:{}", ulid),
                    category: EntityKind::Physical,
                    label: format!("sat_{}", i),
                    lang_canonical: "en".to_string(),
                    deleted_at: None,
                };

                let t_start = Instant::now();
                db.save_entity(entity).await?;
                bus.on_event("entity.created".to_string(), trial as u64, ulid)
                    .await;
                let _ = primary_rx
                    .recv()
                    .await
                    .map_err(|e| e.to_string())?;
                let latency_us = t_start.elapsed().as_secs_f64() * 1_000_000.0;

                if !is_warmup {
                    all_latencies.push(latency_us);
                    csv_writer
                        .write_record(&[
                            subs.to_string(),
                            batch_size.to_string(),
                            (trial - config.warmup).to_string(),
                            i.to_string(),
                            format!("{:.2}", latency_us),
                        ])
                        .map_err(|e| e.to_string())?;
                }
            }

            // Drop bus to terminate secondary subscribers
            drop(bus);
            for h in secondaries {
                let _ = h.await;
            }
            let _ = std::fs::remove_dir_all(&db_dir);
        }

        if !all_latencies.is_empty() {
            let s = stats::compute_stats(&mut all_latencies);
            println!("  └─ {}\n", s);
            summaries.push(SaturationSummary {
                subscribers: subs,
                batch_size,
                stats: s,
            });
        }
    }

    csv_writer.flush().map_err(|e| e.to_string())?;
    let summary_path = config.output_dir.join("eventbus_saturation_summary.json");
    let json = serde_json::to_string_pretty(&summaries).map_err(|e| e.to_string())?;
    std::fs::write(&summary_path, json).map_err(|e| e.to_string())?;

    println!("  ✓ CSV:     {}", csv_path.display());
    println!("  ✓ Summary: {}", summary_path.display());

    std::env::remove_var("HUMANIST_STORE");
    Ok(())
}
