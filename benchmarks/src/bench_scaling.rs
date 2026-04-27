use core_engine::{
    blob::LocalBlobAdapter,
    bus::EventBus,
    db::SurrealDbAdapter,
};
use prolog_engine::{InferenceEngine, ScryerMachine};
use serde::Serialize;
use std::time::Instant;

use crate::config::BenchConfig;
use crate::dataset::{generate_dataset_scaled, DatasetReport};
use crate::stats::{self, Stats};

#[derive(Debug, Serialize)]
struct ScalePoint {
    scale: usize,
    entities: usize,
    edges: usize,
    direct_lookup: Stats,
    transitive_closure: Stats,
    aggregation: Stats,
}

fn load_into_prolog(machine: &ScryerMachine, report: &DatasetReport) -> Result<(), String> {
    use rand::{seq::SliceRandom, Rng, SeedableRng};

    for (i, id) in report.entity_ids.iter().enumerate() {
        let kind = if report.physical_ids.contains(id) {
            "physical"
        } else if report.digital_ids.contains(id) {
            "digital"
        } else if report.abstract_ids.contains(id) {
            "abstract"
        } else if report.agent_ids.contains(id) {
            "persona"
        } else {
            "physical"
        };
        let _ = machine.ingest(&format!("entity('{id}', '{kind}', 'label_{i}', 'en')"));
    }

    let mut rng = rand::rngs::StdRng::seed_from_u64(report.seed);
    let labels = &["contains", "depends_on", "references", "authored_by", "located_at"];
    let non_abstract: Vec<&String> = report
        .entity_ids
        .iter()
        .filter(|id| !report.abstract_ids.contains(id))
        .collect();

    let tagged_as_count = (400 * (report.total_entities / 600).max(1)).min(non_abstract.len() * 4);
    for i in 0..tagged_as_count {
        if non_abstract.is_empty() || report.abstract_ids.is_empty() {
            break;
        }
        let from = non_abstract[i % non_abstract.len()];
        let to = &report.abstract_ids[i % report.abstract_ids.len()];
        let _ = machine.ingest(&format!("edge('{from}', '{to}', 'tagged_as')"));
    }

    let all_ids: Vec<&str> = report.entity_ids.iter().map(|s| s.as_str()).collect();
    let custom_count = 300 * (report.total_entities / 600).max(1);
    let mut shuffled = all_ids.clone();
    shuffled.shuffle(&mut rng);
    let half = (custom_count / 2).min(shuffled.len().saturating_sub(1));
    for i in 0..half {
        let label = labels[i % labels.len()];
        let _ = machine.ingest(&format!("edge('{}', '{}', '{}')", shuffled[i], shuffled[i + 1], label));
    }
    for _ in 0..(custom_count - half) {
        let from = rng.gen_range(0..all_ids.len());
        let to = rng.gen_range(0..all_ids.len());
        if from != to {
            let label = labels[rng.gen_range(0..labels.len())];
            let _ = machine.ingest(&format!("edge('{}', '{}', '{}')", all_ids[from], all_ids[to], label));
        }
    }

    machine.ingest("reachable(X, Y, _D) :- edge(X, Y, _)")?;
    machine.ingest("reachable(X, Y, D) :- D > 0, D1 is D - 1, edge(X, Z, _), reachable(Z, Y, D1)")?;
    Ok(())
}

fn measure_class<F>(trials: u32, warmup: u32, mut run: F) -> Stats
where
    F: FnMut() -> f64,
{
    let mut samples = Vec::with_capacity((trials.saturating_sub(warmup)) as usize);
    for t in 0..trials {
        let v = run();
        if t >= warmup {
            samples.push(v);
        }
    }
    if samples.is_empty() {
        samples.push(0.0);
    }
    stats::compute_stats(&mut samples)
}

/// Sub-experiment: how does Prolog query latency scale with N?
/// Generates the dataset at multiple scale factors and re-runs the three
/// query classes. Output suitable for a latency-vs-N plot.
pub async fn run_scaling_benchmark(
    config: &BenchConfig,
    scales: &[usize],
) -> Result<(), String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Sub-experiment: Prolog Scaling vs Dataset Size");
    println!("  Scales: {:?}", scales);
    println!("══════════════════════════════════════════════════════\n");

    std::fs::create_dir_all(&config.output_dir).map_err(|e| e.to_string())?;
    let csv_path = config.output_dir.join("prolog_scaling.csv");
    let mut csv_writer = csv::Writer::from_path(&csv_path).map_err(|e| e.to_string())?;
    csv_writer
        .write_record([
            "scale", "entities", "edges", "query_class", "trial", "latency_us",
        ])
        .map_err(|e| e.to_string())?;

    let mut summaries = Vec::new();

    for &scale in scales {
        println!("  ┌─ scale={}", scale);

        let db_dir = config.db_dir.join(format!("scaling_{}", scale));
        if db_dir.exists() {
            std::fs::remove_dir_all(&db_dir).map_err(|e| e.to_string())?;
        }
        std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
        std::env::set_var("HUMANIST_STORE", &db_dir);

        let db = SurrealDbAdapter::new().await?;
        let bus = EventBus::new();
        let blob_dir = config.db_dir.join(format!("scaling_blobs_{}", scale));
        let blob = LocalBlobAdapter::new(blob_dir);

        let report = generate_dataset_scaled(
            &db,
            &bus,
            &blob,
            config.seed,
            scale,
            &config.output_dir.join(format!("scaling_{}", scale)),
        )
        .await?;

        let machine = ScryerMachine::new();
        load_into_prolog(&machine, &report)?;
        let engine = InferenceEngine::new(machine);

        // Pick a single source ULID for stability across scales.
        let source = report
            .physical_ids
            .first()
            .cloned()
            .ok_or("no physical entity in report")?;

        let mut record_class = |name: &str, stats: &Stats, ts: &[f64]| -> Result<(), String> {
            for (i, lat) in ts.iter().enumerate() {
                csv_writer
                    .write_record(&[
                        scale.to_string(),
                        report.total_entities.to_string(),
                        report.total_edges.to_string(),
                        name.to_string(),
                        i.to_string(),
                        format!("{:.2}", lat),
                    ])
                    .map_err(|e| e.to_string())?;
            }
            println!("  │  {:<22} {}", name, stats);
            Ok(())
        };

        // Direct
        let mut direct_samples = Vec::new();
        let direct_stats = measure_class(config.trials, config.warmup, || {
            let q = format!("edge('{source}', T, L).");
            let t = Instant::now();
            let _ = engine.query_bindings(&q).unwrap_or_default();
            let v = t.elapsed().as_secs_f64() * 1_000_000.0;
            direct_samples.push(v);
            v
        });
        let direct_only: Vec<f64> = direct_samples
            .iter()
            .skip(config.warmup as usize)
            .copied()
            .collect();
        record_class("direct_lookup", &direct_stats, &direct_only)?;

        // Transitive
        let mut trans_samples = Vec::new();
        let trans_stats = measure_class(config.trials, config.warmup, || {
            let q = format!("reachable('{source}', X, 6).");
            let t = Instant::now();
            let _ = engine.query_bindings(&q).unwrap_or_default();
            let v = t.elapsed().as_secs_f64() * 1_000_000.0;
            trans_samples.push(v);
            v
        });
        let trans_only: Vec<f64> = trans_samples
            .iter()
            .skip(config.warmup as usize)
            .copied()
            .collect();
        record_class("transitive_closure", &trans_stats, &trans_only)?;

        // Aggregation
        let mut agg_samples = Vec::new();
        let agg_stats = measure_class(config.trials, config.warmup, || {
            let q = format!("findall(X, reachable('{source}', X, 4), Xs).");
            let t = Instant::now();
            let _ = engine.query_bindings(&q).unwrap_or_default();
            let v = t.elapsed().as_secs_f64() * 1_000_000.0;
            agg_samples.push(v);
            v
        });
        let agg_only: Vec<f64> = agg_samples
            .iter()
            .skip(config.warmup as usize)
            .copied()
            .collect();
        record_class("aggregation", &agg_stats, &agg_only)?;

        summaries.push(ScalePoint {
            scale,
            entities: report.total_entities,
            edges: report.total_edges,
            direct_lookup: direct_stats,
            transitive_closure: trans_stats,
            aggregation: agg_stats,
        });

        println!();
        std::env::remove_var("HUMANIST_STORE");
    }

    csv_writer.flush().map_err(|e| e.to_string())?;
    let summary_path = config.output_dir.join("prolog_scaling_summary.json");
    let json = serde_json::to_string_pretty(&summaries).map_err(|e| e.to_string())?;
    std::fs::write(&summary_path, json).map_err(|e| e.to_string())?;

    println!("  ✓ CSV:     {}", csv_path.display());
    println!("  ✓ Summary: {}", summary_path.display());

    Ok(())
}
