mod config;
mod stats;
mod dataset;
mod bench_eventbus;
mod bench_prolog;
mod bench_frontend;
mod bench_memory;

use clap::{Parser, Subcommand};
use config::{BenchConfig, EventBusBenchSpec, PrologBenchSpec};
use core_engine::{
    db::SurrealDbAdapter,
    bus::EventBus,
    blob::LocalBlobAdapter,
};

#[derive(Parser)]
#[command(name = "spatial-os-bench")]
#[command(about = "Spatial OS — Reproducible Benchmark Suite for Thesis Evaluation")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate the deterministic 600-entity test dataset
    GenerateDataset {
        /// RNG seed for deterministic generation
        #[arg(long, default_value = "42")]
        seed: u64,
    },

    /// Benchmark 1: EventBus throughput (save_entity → broadcast latency)
    Eventbus {
        /// Number of trials per batch size
        #[arg(long, default_value = "30")]
        trials: u32,

        /// Number of warm-up trials to discard
        #[arg(long, default_value = "3")]
        warmup: u32,
    },

    /// Benchmark 3: Prolog inference latency
    Prolog {
        /// Number of trials per query × source combination
        #[arg(long, default_value = "30")]
        trials: u32,

        /// Number of warm-up trials to discard
        #[arg(long, default_value = "3")]
        warmup: u32,

        /// RNG seed (must match dataset generation)
        #[arg(long, default_value = "42")]
        seed: u64,
    },

    /// Benchmark 2: Frontend synchronization lag (requires GUI)
    Frontend,

    /// Supplementary: Memory profiling (requires GUI)
    Memory {
        /// Duration in seconds to sample RSS
        #[arg(long, default_value = "60")]
        duration: u64,
    },

    /// INTERNAL: Generate load during memory profiling
    #[command(hide = true)]
    IngestLoad {
        /// Duration to sustain ingestion
        #[arg(long, default_value = "60")]
        duration: u64,
    },

    /// Run all headless benchmarks sequentially
    RunAll {
        /// Number of trials per configuration
        #[arg(long, default_value = "30")]
        trials: u32,

        /// Number of warm-up trials to discard
        #[arg(long, default_value = "3")]
        warmup: u32,

        /// RNG seed for all operations
        #[arg(long, default_value = "42")]
        seed: u64,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::GenerateDataset { seed } => {
            let config = BenchConfig::new(0, 0, seed);
            run_generate_dataset(&config).await?;
        }

        Commands::Eventbus { trials, warmup } => {
            let config = BenchConfig::new(trials, warmup, 42);
            config.save_manifest()?;
            let spec = EventBusBenchSpec::default();
            bench_eventbus::run_eventbus_benchmark(&config, &spec).await?;
        }

        Commands::Prolog { trials, warmup, seed } => {
            let config = BenchConfig::new(trials, warmup, seed);
            config.save_manifest()?;

            // Load or generate dataset
            let report = load_or_generate_dataset(&config).await?;
            let spec = PrologBenchSpec::default();
            bench_prolog::run_prolog_benchmark(&report, &config, &spec)?;
        }

        Commands::Frontend => {
            bench_frontend::run_frontend_benchmark().await?;
        }

        Commands::Memory { duration } => {
            bench_memory::run_memory_benchmark(duration).await?;
        }

        Commands::IngestLoad { duration } => {
            bench_memory::run_load_generator(duration).await?;
        }

        Commands::RunAll { trials, warmup, seed } => {
            let config = BenchConfig::new(trials, warmup, seed);
            config.save_manifest()?;

            println!("╔══════════════════════════════════════════════════════╗");
            println!("║  Spatial OS — Full Benchmark Suite                   ║");
            println!("║  Trials: {} | Warmup: {} | Seed: {}                  ║", trials, warmup, seed);
            println!("╚══════════════════════════════════════════════════════╝\n");

            // 1. Generate dataset
            let report = run_generate_dataset(&config).await?;

            // 2. EventBus benchmark
            let spec = EventBusBenchSpec::default();
            bench_eventbus::run_eventbus_benchmark(&config, &spec).await?;

            // 3. Prolog benchmark
            let prolog_spec = PrologBenchSpec::default();
            bench_prolog::run_prolog_benchmark(&report, &config, &prolog_spec)?;

            println!("\n══════════════════════════════════════════════════════");
            println!("  All headless benchmarks complete.");
            println!("  Results in: {}", config.output_dir.display());
            println!("══════════════════════════════════════════════════════");
        }
    }

    Ok(())
}

async fn run_generate_dataset(config: &BenchConfig) -> Result<dataset::DatasetReport, String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Dataset Generation (seed={})", config.seed);
    println!("══════════════════════════════════════════════════════\n");

    // Use isolated DB for dataset generation
    let db_dir = config.db_dir.join("dataset");
    if db_dir.exists() {
        std::fs::remove_dir_all(&db_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    std::env::set_var("SPATIAL_OS_STORE", db_dir.parent().unwrap_or(&db_dir));

    let db = SurrealDbAdapter::new().await?;
    let bus = EventBus::new();
    let blob_dir = config.db_dir.join("blobs");
    let blob = LocalBlobAdapter::new(blob_dir);

    let report = dataset::generate_dataset(&db, &bus, &blob, config.seed, &config.output_dir).await?;

    println!("\n  ✓ Dataset generated:");
    println!("    Entities:     {}", report.total_entities);
    println!("    Edges:        {}", report.total_edges);
    println!("    Traits:       {}", report.total_traits);
    println!("    Multi-trait:  {}", report.multi_trait_ids.len());

    std::env::remove_var("SPATIAL_OS_STORE");
    Ok(report)
}

async fn load_or_generate_dataset(config: &BenchConfig) -> Result<dataset::DatasetReport, String> {
    let report_path = config.output_dir.join("dataset_report.json");
    if report_path.exists() {
        println!("  Loading existing dataset report from {}", report_path.display());
        let json = std::fs::read_to_string(&report_path).map_err(|e| e.to_string())?;
        let report: dataset::DatasetReport = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        Ok(report)
    } else {
        run_generate_dataset(config).await
    }
}
