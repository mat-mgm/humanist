use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Declarative, reproducible benchmark configuration.
/// All parameters are explicit — no hidden defaults.
/// Serialize to JSON alongside results for full reproducibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchConfig {
    pub trials: u32,
    pub warmup: u32,
    pub seed: u64,
    pub output_dir: PathBuf,
    pub db_dir: PathBuf,
}

impl BenchConfig {
    pub fn new(trials: u32, warmup: u32, seed: u64) -> Self {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        Self {
            trials,
            warmup,
            seed,
            output_dir: project_root.join(core_engine::BENCHMARK_RESULTS_DIR),
            db_dir: project_root.join("target/bench_db"),
        }
    }

    /// Total measured trials (after discarding warm-up).
    pub fn measured_trials(&self) -> u32 {
        self.trials.saturating_sub(self.warmup)
    }

    /// Write the config itself to the output directory for reproducibility.
    pub fn save_manifest(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.output_dir).map_err(|e| e.to_string())?;
        let path = self.output_dir.join("bench_config.json");
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// EventBus-specific configuration layered on top of BenchConfig.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventBusBenchSpec {
    pub batch_sizes: Vec<usize>,
}

impl Default for EventBusBenchSpec {
    fn default() -> Self {
        Self {
            batch_sizes: vec![100, 500, 1000, 5000],
        }
    }
}

/// Prolog-specific configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrologBenchSpec {
    pub source_count: usize,
}

impl Default for PrologBenchSpec {
    fn default() -> Self {
        Self {
            source_count: 5,
        }
    }
}
