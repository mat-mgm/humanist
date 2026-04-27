mod analyze;
mod bench_eventbus;
mod bench_frontend;
mod bench_memory;
mod bench_prolog;
mod bench_saturation;
mod bench_scaling;
mod config;
mod dataset;
mod stats;

use clap::{Parser, Subcommand};
use config::{BenchConfig, EventBusBenchSpec, PrologBenchSpec};
use core_engine::{
    blob::LocalBlobAdapter,
    bus::EventBus,
    db::SurrealDbAdapter,
};

#[derive(Parser)]
#[command(name = "humanist-bench")]
#[command(about = "Spatial OS — Reproducible Benchmark Suite for Thesis Evaluation")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate the deterministic test dataset (default scale = 600 entities).
    GenerateDataset {
        #[arg(long, default_value = "42")]
        seed: u64,
        /// Multiplier on the base 600-entity shape (1 = 600, 4 = 2,400, 10 = 6,000, …)
        #[arg(long, default_value = "1")]
        scale: usize,
    },

    /// Benchmark 1: EventBus throughput (commit → broadcast latency).
    Eventbus {
        #[arg(long, default_value = "30")]
        trials: u32,
        #[arg(long, default_value = "3")]
        warmup: u32,
    },

    /// Benchmark 3: Prolog inference latency.
    Prolog {
        #[arg(long, default_value = "30")]
        trials: u32,
        #[arg(long, default_value = "3")]
        warmup: u32,
        #[arg(long, default_value = "42")]
        seed: u64,
        #[arg(long, default_value = "1")]
        scale: usize,
    },

    /// Benchmark 2: Frontend synchronization lag (requires GUI).
    Frontend,

    /// Supplementary: Memory profiling (self-contained, no GUI required).
    Memory {
        #[arg(long, default_value = "60")]
        duration: u64,
    },

    /// Sub-experiment: Prolog scaling vs dataset size.
    PrologScaling {
        #[arg(long, default_value = "30")]
        trials: u32,
        #[arg(long, default_value = "3")]
        warmup: u32,
        #[arg(long, default_value = "42")]
        seed: u64,
        /// Comma-separated scale factors. Default: 1,4,16 (600 / 2,400 / 9,600 entities).
        #[arg(long, default_value = "1,4,16")]
        scales: String,
    },

    /// Sub-experiment: EventBus fan-out saturation.
    EventbusSaturation {
        #[arg(long, default_value = "10")]
        trials: u32,
        #[arg(long, default_value = "3")]
        warmup: u32,
        /// Comma-separated subscriber counts. Default: 1,4,16,64.
        #[arg(long, default_value = "1,4,16,64")]
        subscribers: String,
        #[arg(long, default_value = "200")]
        batch_size: usize,
    },

    /// Compute derived summaries from raw CSVs (frontend, memory).
    Analyze,

    /// Reserved internal command (deprecated; bench_memory now ingests in-process).
    #[command(hide = true)]
    IngestLoad {
        #[arg(long, default_value = "60")]
        duration: u64,
    },

    /// Run all headless benchmarks sequentially.
    RunAll {
        #[arg(long, default_value = "30")]
        trials: u32,
        #[arg(long, default_value = "3")]
        warmup: u32,
        #[arg(long, default_value = "42")]
        seed: u64,
        #[arg(long, default_value = "1")]
        scale: usize,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::GenerateDataset { seed, scale } => {
            let config = BenchConfig::new(0, 0, seed);
            run_generate_dataset(&config, scale).await?;
        }

        Commands::Eventbus { trials, warmup } => {
            let config = BenchConfig::new(trials, warmup, 42);
            config.save_manifest()?;
            let spec = EventBusBenchSpec::default();
            bench_eventbus::run_eventbus_benchmark(&config, &spec).await?;
        }

        Commands::Prolog { trials, warmup, seed, scale } => {
            let config = BenchConfig::new(trials, warmup, seed);
            config.save_manifest()?;
            let report = load_or_generate_dataset(&config, scale).await?;
            let spec = PrologBenchSpec::default();
            bench_prolog::run_prolog_benchmark(&report, &config, &spec)?;
        }

        Commands::Frontend => {
            bench_frontend::run_frontend_benchmark().await?;
        }

        Commands::Memory { duration } => {
            bench_memory::run_memory_benchmark(duration).await?;
        }

        Commands::PrologScaling { trials, warmup, seed, scales } => {
            let config = BenchConfig::new(trials, warmup, seed);
            config.save_manifest()?;
            let scales = parse_csv_usize(&scales)?;
            bench_scaling::run_scaling_benchmark(&config, &scales).await?;
        }

        Commands::EventbusSaturation { trials, warmup, subscribers, batch_size } => {
            let config = BenchConfig::new(trials, warmup, 42);
            config.save_manifest()?;
            let subs = parse_csv_usize(&subscribers)?;
            bench_saturation::run_saturation_benchmark(&config, &subs, batch_size).await?;
        }

        Commands::Analyze => {
            let config = BenchConfig::new(0, 0, 42);
            analyze::analyze_all(&config.output_dir)?;
        }

        Commands::IngestLoad { duration } => {
            bench_memory::run_load_generator(duration).await?;
        }

        Commands::RunAll { trials, warmup, seed, scale } => {
            let config = BenchConfig::new(trials, warmup, seed);
            config.save_manifest()?;

            println!("╔══════════════════════════════════════════════════════╗");
            println!("║  Spatial OS — Full Benchmark Suite                   ║");
            println!("║  Trials: {} | Warmup: {} | Seed: {} | Scale: {}", trials, warmup, seed, scale);
            println!("╚══════════════════════════════════════════════════════╝\n");

            let report = run_generate_dataset(&config, scale).await?;

            let spec = EventBusBenchSpec::default();
            bench_eventbus::run_eventbus_benchmark(&config, &spec).await?;

            let prolog_spec = PrologBenchSpec::default();
            bench_prolog::run_prolog_benchmark(&report, &config, &prolog_spec)?;

            // Re-run derived analysis if frontend/memory CSVs already exist.
            let _ = analyze::analyze_all(&config.output_dir);

            println!("\n══════════════════════════════════════════════════════");
            println!("  All headless benchmarks complete.");
            println!("  Results in: {}", config.output_dir.display());
            println!("══════════════════════════════════════════════════════");
        }
    }

    Ok(())
}

fn parse_csv_usize(s: &str) -> Result<Vec<usize>, String> {
    s.split(',')
        .map(|x| x.trim().parse::<usize>().map_err(|e| e.to_string()))
        .collect()
}

async fn run_generate_dataset(
    config: &BenchConfig,
    scale: usize,
) -> Result<dataset::DatasetReport, String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Dataset Generation (seed={}, scale={})", config.seed, scale);
    println!("══════════════════════════════════════════════════════\n");

    let db_dir = config.db_dir.join("dataset");
    if db_dir.exists() {
        std::fs::remove_dir_all(&db_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    std::env::set_var("HUMANIST_STORE", &db_dir);

    let db = SurrealDbAdapter::new().await?;
    let bus = EventBus::new();
    let blob_dir = config.db_dir.join("blobs");
    let blob = LocalBlobAdapter::new(blob_dir);

    let report = dataset::generate_dataset_scaled(
        &db,
        &bus,
        &blob,
        config.seed,
        scale,
        &config.output_dir,
    )
    .await?;

    println!("\n  ✓ Dataset generated:");
    println!("    Entities:     {}", report.total_entities);
    println!("    Edges:        {}", report.total_edges);
    println!("    Traits:       {}", report.total_traits);
    println!("    Multi-trait:  {}", report.multi_trait_ids.len());

    std::env::remove_var("HUMANIST_STORE");
    Ok(report)
}

async fn load_or_generate_dataset(
    config: &BenchConfig,
    scale: usize,
) -> Result<dataset::DatasetReport, String> {
    let report_path = config.output_dir.join("dataset_report.json");
    if report_path.exists() {
        println!("  Loading existing dataset report from {}", report_path.display());
        let json = std::fs::read_to_string(&report_path).map_err(|e| e.to_string())?;
        let report: dataset::DatasetReport =
            serde_json::from_str(&json).map_err(|e| e.to_string())?;
        Ok(report)
    } else {
        run_generate_dataset(config, scale).await
    }
}
