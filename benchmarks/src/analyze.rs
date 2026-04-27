use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

use crate::stats::{self, Stats};

#[derive(Debug, Serialize)]
struct PlaneSummary {
    plane: String,
    measured: usize,
    timeouts: usize,
    stats: Stats,
}

/// Compute per-plane summary stats from the GUI-emitted frontend_sync_lag.csv.
/// Header: suite_id,trial,measured,plane,status,ulid,latency_ms
pub fn analyze_frontend(results_dir: &Path) -> Result<(), String> {
    let csv_path = results_dir.join("frontend_sync_lag.csv");
    if !csv_path.exists() {
        println!("  (no frontend_sync_lag.csv — skipping)");
        return Ok(());
    }

    let mut rdr = csv::ReaderBuilder::new()
        .comment(Some(b'#'))
        .has_headers(true)
        .from_path(&csv_path)
        .map_err(|e| e.to_string())?;

    let mut by_plane: BTreeMap<String, (Vec<f64>, usize)> = BTreeMap::new();

    for rec in rdr.records() {
        let rec = rec.map_err(|e| e.to_string())?;
        // Tolerate the simpler legacy schema (plane,trial,latency_ms)
        // as well as the spec schema.
        let headers = ["suite_id", "trial", "measured", "plane", "status", "ulid", "latency_ms"];
        let field = |name: &str| -> Option<String> {
            let idx = headers.iter().position(|h| *h == name)?;
            rec.get(idx).map(|s| s.to_string())
        };

        let (plane, status, latency_str, measured_flag) = if rec.len() >= 7 {
            (
                field("plane").unwrap_or_default(),
                field("status").unwrap_or_else(|| "ok".into()),
                field("latency_ms").unwrap_or_default(),
                field("measured").unwrap_or_else(|| "true".into()),
            )
        } else {
            // legacy: plane,trial,latency_ms
            (
                rec.get(0).unwrap_or("").to_string(),
                "ok".to_string(),
                rec.get(2).unwrap_or("").to_string(),
                "true".to_string(),
            )
        };

        if measured_flag == "false" {
            continue;
        }
        let entry = by_plane.entry(plane).or_default();
        if status == "timeout" {
            entry.1 += 1;
            continue;
        }
        if let Ok(v) = latency_str.parse::<f64>() {
            entry.0.push(v);
        }
    }

    let mut summaries = Vec::new();
    for (plane, (mut samples, timeouts)) in by_plane {
        if samples.is_empty() {
            continue;
        }
        let s = stats::compute_stats(&mut samples);
        println!("  {:<20} {} | timeouts={}", plane, s, timeouts);
        summaries.push(PlaneSummary {
            plane,
            measured: s.count,
            timeouts,
            stats: s,
        });
    }

    let out_path = results_dir.join("frontend_sync_summary.json");
    let json = serde_json::to_string_pretty(&summaries).map_err(|e| e.to_string())?;
    std::fs::write(&out_path, json).map_err(|e| e.to_string())?;
    println!("  ✓ {}", out_path.display());
    Ok(())
}

#[derive(Debug, Serialize)]
struct MemoryAnalysis {
    samples: usize,
    duration_ms: u64,
    rss_kb_initial: u64,
    rss_kb_peak: u64,
    rss_kb_final: u64,
    rss_kb_delta: i64,
    entities_observed: u64,
    rss_kb_per_entity: f64,
}

pub fn analyze_memory(results_dir: &Path) -> Result<(), String> {
    let csv_path = results_dir.join("memory_profile.csv");
    if !csv_path.exists() {
        println!("  (no memory_profile.csv — skipping)");
        return Ok(());
    }

    let mut rdr = csv::Reader::from_path(&csv_path).map_err(|e| e.to_string())?;
    let headers = rdr.headers().map_err(|e| e.to_string())?.clone();
    let h: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
    let ts_idx = h.iter().position(|s| s == "timestamp_ms").ok_or("missing timestamp_ms")?;
    let rss_idx = h
        .iter()
        .position(|s| s == "rss_kb")
        .or_else(|| h.iter().position(|s| s == "rust_rss_kb"))
        .ok_or("missing rss column")?;
    let ent_idx = h
        .iter()
        .position(|s| s == "entities_ingested")
        .ok_or("missing entities_ingested")?;

    let mut first_ts = None;
    let mut last_ts = 0u64;
    let mut initial_rss = 0u64;
    let mut peak_rss = 0u64;
    let mut final_rss = 0u64;
    let mut max_entities = 0u64;
    let mut samples = 0usize;

    for rec in rdr.records() {
        let rec = rec.map_err(|e| e.to_string())?;
        let ts: u64 = rec.get(ts_idx).and_then(|s| s.parse().ok()).unwrap_or(0);
        let rss: u64 = rec.get(rss_idx).and_then(|s| s.parse().ok()).unwrap_or(0);
        let ent: u64 = rec.get(ent_idx).and_then(|s| s.parse().ok()).unwrap_or(0);
        if first_ts.is_none() {
            first_ts = Some(ts);
            initial_rss = rss;
        }
        last_ts = ts;
        peak_rss = peak_rss.max(rss);
        final_rss = rss;
        max_entities = max_entities.max(ent);
        samples += 1;
    }

    let duration_ms = last_ts.saturating_sub(first_ts.unwrap_or(0));
    let delta = final_rss as i64 - initial_rss as i64;
    let per_entity = if max_entities > 0 {
        delta as f64 / max_entities as f64
    } else {
        0.0
    };

    let analysis = MemoryAnalysis {
        samples,
        duration_ms,
        rss_kb_initial: initial_rss,
        rss_kb_peak: peak_rss,
        rss_kb_final: final_rss,
        rss_kb_delta: delta,
        entities_observed: max_entities,
        rss_kb_per_entity: per_entity,
    };

    println!(
        "  samples={} duration={}ms RSS init={}KB peak={}KB final={}KB Δ={}KB ents={} per_entity={:.3}KB",
        samples, duration_ms, initial_rss, peak_rss, final_rss, delta, max_entities, per_entity
    );

    let out_path = results_dir.join("memory_profile_analysis.json");
    let json = serde_json::to_string_pretty(&analysis).map_err(|e| e.to_string())?;
    std::fs::write(&out_path, json).map_err(|e| e.to_string())?;
    println!("  ✓ {}", out_path.display());
    Ok(())
}

pub fn analyze_all(results_dir: &Path) -> Result<(), String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Analyzer: derived summaries from raw CSVs");
    println!("══════════════════════════════════════════════════════\n");
    println!("Frontend sync lag:");
    analyze_frontend(results_dir)?;
    println!("\nMemory profile:");
    analyze_memory(results_dir)?;
    Ok(())
}
