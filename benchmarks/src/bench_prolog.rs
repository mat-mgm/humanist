use prolog_engine::{ScryerMachine, InferenceEngine};
use serde::Serialize;
use std::time::Instant;

use crate::config::{BenchConfig, PrologBenchSpec};
use crate::dataset::DatasetReport;
use crate::stats::{self, Stats};


#[derive(Debug, Serialize)]
struct QueryClassSummary {
    query_class: String,
    stats: Stats,
}

/// Load the dataset into Prolog's working memory as facts.
///
/// Uses a depth-limited `reachable/3` predicate instead of naive recursion
/// to prevent infinite loops on the cyclic graph.
fn load_dataset_into_prolog(machine: &ScryerMachine, report: &DatasetReport) -> Result<(), String> {
    println!("  Loading {} entities into Prolog...", report.entity_ids.len());

    for (i, id) in report.entity_ids.iter().enumerate() {
        let ulid = id.strip_prefix("entity:").unwrap_or(id);
        let kind = if report.physical_ids.contains(id) { "physical" }
            else if report.digital_ids.contains(id) { "digital" }
            else if report.temporal_ids.contains(id) { "temporal" }
            else if report.abstract_ids.contains(id) { "abstract_" }
            else if report.agent_ids.contains(id) { "agent" }
            else { "blob" };
        let fact = format!("entity('{}', '{}', 'label_{}')", ulid, kind, i);
        let _ = machine.ingest(&fact);
    }

    // Generate edges as Prolog facts using deterministic RNG
    use rand::{SeedableRng, Rng, seq::SliceRandom};
    let mut rng = rand::rngs::StdRng::seed_from_u64(report.seed);

    let edge_labels = &["contains", "depends_on", "references", "authored_by", "located_at"];
    let non_abstract: Vec<&String> = report.entity_ids.iter()
        .filter(|id| !report.abstract_ids.contains(id))
        .collect();

    // tagged_as edges (400)
    for i in 0..400usize {
        let from_ulid = non_abstract[i % non_abstract.len()]
            .strip_prefix("entity:").unwrap_or(non_abstract[i % non_abstract.len()]);
        let to_ulid = report.abstract_ids[i % report.abstract_ids.len()]
            .strip_prefix("entity:").unwrap_or(&report.abstract_ids[i % report.abstract_ids.len()]);
        let edge_id = format!("edge_tag_{}", i);
        let fact = format!("edge('{}', '{}', '{}', 'tagged_as')", edge_id, from_ulid, to_ulid);
        let _ = machine.ingest(&fact);
    }

    // Custom edges (300) — chain + random cross-links
    let all_ulids: Vec<&str> = report.entity_ids.iter()
        .map(|id| id.strip_prefix("entity:").unwrap_or(id))
        .collect();

    let mut shuffled = all_ulids.clone();
    shuffled.shuffle(&mut rng);

    let chain_count = shuffled.len().min(300) - 1;
    let half = chain_count.min(150);
    for i in 0..half {
        let label = edge_labels[i % edge_labels.len()];
        let fact = format!("edge('edge_chain_{}', '{}', '{}', '{}')", i, shuffled[i], shuffled[i + 1], label);
        let _ = machine.ingest(&fact);
    }

    for i in 0..(300 - half) {
        let from_idx = rng.gen_range(0..all_ulids.len());
        let to_idx = rng.gen_range(0..all_ulids.len());
        if from_idx != to_idx {
            let label = edge_labels[rng.gen_range(0..edge_labels.len())];
            let fact = format!("edge('edge_rand_{}', '{}', '{}', '{}')", i, all_ulids[from_idx], all_ulids[to_idx], label);
            let _ = machine.ingest(&fact);
        }
    }

    // ── Inference rules ──
    // Depth-limited reachable to prevent infinite recursion on cyclic graphs.
    // reachable(X, Y, Depth) succeeds if Y is reachable from X within Depth hops.
    // Max depth = 6 (sufficient to traverse the graph diameter while staying terminating).
    machine.ingest("reachable(X, Y, _D) :- edge(_, X, Y, _)")?;
    machine.ingest("reachable(X, Y, D) :- D > 0, D1 is D - 1, edge(_, X, Z, _), reachable(Z, Y, D1)")?;

    println!("  ✓ Prolog knowledge base loaded.");
    Ok(())
}

/// Select source ULIDs spread across the physical entities.
fn select_source_ulids(report: &DatasetReport, count: usize) -> Vec<String> {
    let mut sources = Vec::new();
    let step = report.physical_ids.len() / (count + 1);
    for i in 0..count {
        let id = &report.physical_ids[(i + 1) * step];
        let ulid = id.strip_prefix("entity:").unwrap_or(id);
        sources.push(ulid.to_string());
    }
    sources
}

pub fn run_prolog_benchmark(
    report: &DatasetReport,
    config: &BenchConfig,
    spec: &PrologBenchSpec,
) -> Result<(), String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Benchmark 3: Prolog Inference Latency");
    println!("  Trials: {} (warmup: {}) | Sources per class: {}", config.trials, config.warmup, spec.source_count);
    println!("══════════════════════════════════════════════════════\n");

    // Initialize Prolog ONCE (tests steady-state performance per spec §4)
    println!("  Initializing Scryer Prolog...");
    let machine = ScryerMachine::new();
    load_dataset_into_prolog(&machine, report)?;
    let engine = InferenceEngine::new(machine);

    let source_ulids = select_source_ulids(report, spec.source_count);
    println!("  Source ULIDs: {:?}\n", source_ulids);

    std::fs::create_dir_all(&config.output_dir).map_err(|e| e.to_string())?;
    let csv_path = config.output_dir.join("prolog_latency.csv");
    let mut csv_writer = csv::Writer::from_path(&csv_path).map_err(|e| e.to_string())?;
    csv_writer.write_record(["query_class", "source_ulid", "trial", "latency_us", "binding_count"])
        .map_err(|e| e.to_string())?;

    let mut summaries: Vec<QueryClassSummary> = Vec::new();

    // ── Query Class 1: Direct Lookup ──
    println!("  ┌─ Direct Lookup");
    let mut direct_latencies: Vec<f64> = Vec::new();
    for source in &source_ulids {
        let query = format!("edge(_, '{}', Target, Label).", source);
        for trial in 0..config.trials {
            let t_start = Instant::now();
            let results = engine.query(&query).unwrap_or_default();
            let latency_us = t_start.elapsed().as_secs_f64() * 1_000_000.0;
            let binding_count = count_bindings(&results);

            if trial >= config.warmup {
                direct_latencies.push(latency_us);
                csv_writer.write_record(&[
                    "direct_lookup",
                    source,
                    &(trial - config.warmup).to_string(),
                    &format!("{:.2}", latency_us),
                    &binding_count.to_string(),
                ]).map_err(|e| e.to_string())?;
            }
        }
    }
    let direct_stats = stats::compute_stats(&mut direct_latencies);
    println!("  │  {}", direct_stats);
    summaries.push(QueryClassSummary { query_class: "direct_lookup".into(), stats: direct_stats });

    // ── Query Class 2: Transitive Closure (depth-limited to 6 hops) ──
    println!("  ├─ Transitive Closure (depth=6)");
    let mut trans_latencies: Vec<f64> = Vec::new();
    for source in &source_ulids {
        // Depth-limited: reachable(Source, X, 6) — max 6 hops
        let query = format!("reachable('{}', X, 6).", source);
        for trial in 0..config.trials {
            let t_start = Instant::now();
            let results = engine.query(&query).unwrap_or_default();
            let latency_us = t_start.elapsed().as_secs_f64() * 1_000_000.0;
            let binding_count = count_bindings(&results);

            if trial >= config.warmup {
                trans_latencies.push(latency_us);
                csv_writer.write_record(&[
                    "transitive_closure",
                    source,
                    &(trial - config.warmup).to_string(),
                    &format!("{:.2}", latency_us),
                    &binding_count.to_string(),
                ]).map_err(|e| e.to_string())?;
            }
        }
    }
    if !trans_latencies.is_empty() {
        let s = stats::compute_stats(&mut trans_latencies);
        println!("  │  {}", s);
        summaries.push(QueryClassSummary { query_class: "transitive_closure".into(), stats: s });
    }

    // ── Query Class 3: Aggregation (findall with depth limit) ──
    println!("  └─ Aggregation (findall, depth=4)");
    let mut agg_latencies: Vec<f64> = Vec::new();
    for source in &source_ulids {
        // Use smaller depth for findall to keep runtime bounded
        let query = format!("findall(X, reachable('{}', X, 4), Xs).", source);
        for trial in 0..config.trials {
            let t_start = Instant::now();
            let results = engine.query(&query).unwrap_or_default();
            let latency_us = t_start.elapsed().as_secs_f64() * 1_000_000.0;
            let binding_count = count_bindings(&results);

            if trial >= config.warmup {
                agg_latencies.push(latency_us);
                csv_writer.write_record(&[
                    "aggregation",
                    source,
                    &(trial - config.warmup).to_string(),
                    &format!("{:.2}", latency_us),
                    &binding_count.to_string(),
                ]).map_err(|e| e.to_string())?;
            }
        }
    }
    if !agg_latencies.is_empty() {
        let s = stats::compute_stats(&mut agg_latencies);
        println!("     {}", s);
        summaries.push(QueryClassSummary { query_class: "aggregation".into(), stats: s });
    }

    csv_writer.flush().map_err(|e| e.to_string())?;
    println!("\n  ✓ CSV written to: {}", csv_path.display());

    // Write JSON summary
    let summary_path = config.output_dir.join("prolog_summary.json");
    let json = serde_json::to_string_pretty(&summaries).map_err(|e| e.to_string())?;
    std::fs::write(&summary_path, json).map_err(|e| e.to_string())?;
    println!("  ✓ Summary written to: {}", summary_path.display());

    Ok(())
}

/// Count bindings from the raw debug output of QueryResolution.
fn count_bindings(results: &[String]) -> usize {
    let joined = results.join("");
    if joined.contains("Matches(") {
        joined.matches("Atom(").count().max(1)
    } else if joined.contains("True") {
        1
    } else {
        0
    }
}
