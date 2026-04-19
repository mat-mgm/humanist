use std::path::PathBuf;
use std::sync::OnceLock;
use tracing::Level;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub struct LogConfig {
    pub level: Level,
    /// When set, also writes JSON-lines to a daily-rolling file in this directory.
    pub log_dir: Option<PathBuf>,
}

// Holds the file-writer flush guard for the process lifetime.
// Dropping it stops the background writer thread, so it must never be dropped early.
static GUARD: OnceLock<WorkerGuard> = OnceLock::new();

pub fn init(config: LogConfig) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(config.level.as_str()));

    let fmt_layer = fmt::layer().compact();

    if let Some(log_dir) = config.log_dir {
        std::fs::create_dir_all(&log_dir).ok();
        let file_appender = tracing_appender::rolling::daily(&log_dir, "spatial-os.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        GUARD.set(guard).ok();
        let file_layer = fmt::layer().json().with_writer(non_blocking);
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt_layer)
            .with(file_layer)
            .init();
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt_layer)
            .init();
    }
}
