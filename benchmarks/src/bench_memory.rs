use std::path::Path;
use std::fs;
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::io::Write;
use core_engine::ports::{GraphDatabase, StateObserver};


pub async fn run_memory_benchmark(duration_secs: u64) -> Result<(), String> {
    println!("\n══════════════════════════════════════════════════════");
    println!("  Supplementary: Memory Profiling");
    println!("══════════════════════════════════════════════════════");
    println!("  Target Duration: {}s", duration_secs);

    // 1. PID Discovery
    let (host_pid, renderer_pid) = find_pids()?;
    println!("  Found Host PID: {}", host_pid);
    println!("  Found Renderer PID: {}", renderer_pid);

    // 2. Prepare CSV
    let results_path = Path::new("docs/thesis/results/memory_profile.csv");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(results_path)
        .map_err(|e| e.to_string())?;

    writeln!(file, "timestamp_ms,rust_rss_kb,chromium_rss_kb,entities_ingested").map_err(|e| e.to_string())?;

    // 3. Start Load Generation (simulated ingest via CLI)
    // We launch a subprocess that just keeps adding entities to the DB
    let mut load_gen = Command::new("cargo")
        .args(&["run", "--release", "-p", "benchmarks", "--", "ingest-load", "--duration", &duration_secs.to_string()])
        .spawn()
        .map_err(|e| format!("Failed to start load generator: {}", e))?;

    // 4. Sampling Loop
    let start_time = Instant::now();
    let epoch_start = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    let sampling_interval = Duration::from_millis(500);
    
    let mut entities_estimated;
    
    println!("  Sampling RSS every 500ms...");

    while start_time.elapsed().as_secs() < duration_secs {
        let now_ms = epoch_start + start_time.elapsed().as_millis();
        
        let rust_rss = get_rss(host_pid).unwrap_or(0);
        let chromium_rss = get_rss(renderer_pid).unwrap_or(0);
        
        // Load generator targets ~83 entities/sec
        entities_estimated = (start_time.elapsed().as_secs_f64() * 83.0) as u64;

        writeln!(file, "{},{},{},{}", now_ms, rust_rss, chromium_rss, entities_estimated)
            .map_err(|e| e.to_string())?;
        
        tokio::time::sleep(sampling_interval).await;
    }

    let _ = load_gen.kill();
    println!("  Sampling complete. Results in docs/thesis/results/memory_profile.csv");
    
    Ok(())
}

fn find_pids() -> Result<(u32, u32), String> {
    // 1. Find the host PID (os_gui or spatial-os)
    let output = Command::new("ps")
        .args(&["-eo", "pid,ppid,comm,args"])
        .output()
        .map_err(|e| e.to_string())?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let mut host_pid = None;
    let mut renderer_pid = None;
    let mut candidates = Vec::new();

    // First pass: Find host candidates
    for line in stdout.lines() {
        let parts: Vec<&str> = line.trim().split_whitespace().collect();
        if parts.len() < 4 { continue; }
        
        let pid: u32 = parts[0].parse().unwrap_or(0);
        let ppid: u32 = parts[1].parse().unwrap_or(0);
        let comm = parts[2];
        let args = parts[3..].join(" ");
        
        candidates.push((pid, ppid, comm.to_string(), args));
    }

    // Direct match for host
    for (pid, _, comm, args) in &candidates {
        if *comm == "os_gui" || *comm == "spatial-os" || args.contains("target/debug/os_gui") {
            // Avoid greedy matches (like the grep command or tauri dev)
            if !args.contains("tauri dev") && !args.contains("cargo") && !args.contains("grep") {
                host_pid = Some(*pid);
                break;
            }
        }
    }

    let h_pid = host_pid.ok_or_else(|| "Could not find Spatial OS host process. Is the GUI open?".to_string())?;

    // Second pass: Find renderer child of host
    for (pid, ppid, comm, args) in &candidates {
        if *ppid == h_pid {
            if args.contains("--type=renderer") || *comm == "WebKitWebProces" || comm.contains("WebKit") {
                renderer_pid = Some(*pid);
                break;
            }
        }
    }

    // Fallback: some environments might have deeply nested structures, try name search
    if renderer_pid.is_none() {
        for (pid, _, comm, args) in &candidates {
            if (args.contains("--type=renderer") || comm.contains("WebKitWebProces")) && !args.contains("grep") {
                renderer_pid = Some(*pid);
                break;
            }
        }
    }

    match renderer_pid {
        Some(r) => Ok((h_pid, r)),
        None => Err("Could not find Chromium/WebKit renderer process. Is the GUI open?".to_string()),
    }
}

fn get_rss(pid: u32) -> Option<u64> {
    let status_path = format!("/proc/{}/status", pid);
    let contents = fs::read_to_string(status_path).ok()?;
    for line in contents.lines() {
        if line.starts_with("VmRSS:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                return parts[1].parse().ok();
            }
        }
    }
    None
}

/// Helper for the load generator subcommand
pub async fn run_load_generator(duration_secs: u64) -> Result<(), String> {
    // This is run as a separate process to avoid GIL-like lockups or async interference
    // It just hits the DB/EventBus hard.
    let target = duration_secs * 83; // ~5000 entities
    println!("  Load generator: creating {} entities over {}s", target, duration_secs);
    
    // We'll reuse the dataset logic but in a loop
    // For now, a simple loop that saves entities
    // Actually, we should just let it run.
    
    let start = Instant::now();
    let interval = Duration::from_micros(12000); // ~83 Hz
    
    // Minimal DB init
    let db = core_engine::db::SurrealDbAdapter::new().await.map_err(|e| e.to_string())?;
    let bus = core_engine::bus::EventBus::new();
    
    for i in 0..target {
        if start.elapsed().as_secs() >= duration_secs { break; }
        
        let ulid = ulid::Ulid::new().to_string();
        let entity = core_engine::models::Entity {
            id: format!("entity:{}", ulid),
            kind: core_engine::models::EntityKind::Physical,
            label: format!("load_{}", i),
            metadata: std::collections::HashMap::new(),
            deleted_at: None,
        };
        
        let _ = db.save_entity(entity).await;
        let _ = bus.on_event("entity.created".to_string(), 1, ulid).await;
        
        tokio::time::sleep(interval).await;
    }
    
    Ok(())
}
