# Benchmark Specification for Thesis Evaluation

**Purpose:** This document specifies all tests and benchmarks that must be implemented in the Spatial OS codebase to produce the data required by the thesis (Chapter 5: Results). A developer agent should be able to implement all items below independently.

**Output Location:** All benchmark code should live in a new workspace crate: `benchmarks/` at the project root (add to `Cargo.toml` workspace members).

**Key Constraint:** Every benchmark must be **deterministic and reproducible**. Use `std::time::Instant` for timing (not wall-clock). Each benchmark must support configurable trial counts and output CSV results to `./docs/thesis/results/`.

---

## 1. Test Dataset Generator

### Purpose
Generate the heterogeneous dataset specified in the thesis. This generator is used by both the qualitative evaluation (schema comparison) and as the pre-loaded state for quantitative benchmarks.

### Specification

| Entity Kind | Attached Traits | Count | Notes |
|-------------|----------------|-------|-------|
| Physical | SpatialTrait | 200 | Random lat/lng/alt within reasonable bounds |
| Digital | BlobTrait | 150 | Use 20 fixed test files (PNG/PDF/glTF), cycled |
| Temporal | TemporalTrait | 150 | Mix of point events, span events, and recurring events |
| Abstract | (none) | 50 | Tag hub nodes with descriptive labels |
| Agent | SpatialTrait | 30 | Random lat/lng, alt=0 |
| Blob | BlobTrait | 20 | Use fixed glTF test files |
| **Total** | | **600** | |

### Relationships
- **400** `tagged_as` edges: Connect entities to Abstract hub nodes. Distribution: each Abstract node should have 6–10 tagged entities.
- **300** custom relational edges: Use labels like `contains`, `depends_on`, `references`, `authored_by`, `located_at`. Connect entities randomly but ensure a connected graph (no isolated components).
- **80 multi-trait entities**: 80 Physical entities should also receive a `TemporalTrait` (geolocated events). These already counted in the 200 Physical total.

### Implementation Details
- **Crate:** `benchmarks/src/dataset.rs`
- **Interface:** `pub async fn generate_dataset(db: &SurrealDbAdapter, event_bus: &EventBus, blob_adapter: &LocalBlobAdapter) -> Result<DatasetReport, String>`
- **Entity IDs:** Client-generated ULIDs via `ulid::Ulid::new().to_string()`. Do NOT rely on database-generated IDs.
- **Binary test files:** Create a `benchmarks/test_assets/` directory with:
  - 10 small PNG images (1x1 pixel colored squares, ~100 bytes each)
  - 5 small PDF files (single-page, minimal content)
  - 5 minimal glTF files (single triangle mesh)
- **DatasetReport struct** should contain: total entities created, total edges created, total traits attached, list of all ULIDs generated.
- **Determinism:** Accept an optional `seed: u64` parameter. Use a seeded RNG (`rand::SeedableRng`) for all random values (coordinates, edge targets).

### CLI Integration
Add a subcommand to `os_cli`: `spatial-os benchmark generate-dataset [--seed N]`

---

## 2. Benchmark 1: EventBus Throughput

### Purpose
Measure the time from `SurrealDB` atomic commit to completed `EventResponse` broadcast on the Tokio channel.

### Protocol
1. **Setup:** Initialize a fresh `SurrealDbAdapter` and `EventBus`. Subscribe to the broadcast channel.
2. **Configuration:** Run with batch sizes: `[100, 500, 1000, 5000]`
3. **Per batch:**
   - Record `Instant::now()` as `t_start`
   - Call `db.save_entity(entity).await`
   - Immediately call `event_bus.on_event(topic, revision, ulid).await`
   - On the subscriber: `rx.recv().await` — record `Instant::now()` as `t_end`
   - Latency = `t_end - t_start`
4. **Trials:** 30 per batch size. Purge DB directory between trials.
5. **Warm-up:** Discard first 3 trials per configuration.
6. **Output:** CSV file `results/eventbus_throughput.csv` with columns: `batch_size, trial, entity_index, latency_us`

### Implementation Details
- **File:** `benchmarks/src/bench_eventbus.rs`
- **Entry point:** `pub async fn run_eventbus_benchmark(config: BenchConfig) -> Result<(), String>`
- `BenchConfig`: `{ batch_sizes: Vec<usize>, trials: u32, warmup: u32, output_dir: PathBuf }`
- For each entity in a batch, create a minimal `Entity { kind: Physical, label: format!("bench_{}", i), metadata: empty, ... }`
- The DB must be re-initialized per trial. Delete and recreate the data directory using `std::fs::remove_dir_all` on `core_engine::db::default_db_path()`.

### Statistical Output
After all trials, compute and print:
- Median latency per batch size
- IQR (Q1, Q3)
- p95, p99 percentile
- Write summary to `results/eventbus_summary.json`

---

## 3. Benchmark 2: Frontend Synchronization Lag

### Purpose
Measure end-to-end latency from backend event emission to completed render cycle on each frontend plane.

### Protocol
1. **Setup:** Launch the full Tauri application.
2. **Instrument the backend:** Add a Tauri IPC command `benchmark_create_entity` that:
   - Creates an entity with SpatialTrait + TemporalTrait
   - Records `std::time::Instant` as `t_backend_commit`
   - Emits `t_backend_commit` (as microseconds since an epoch anchor) to the frontend via a dedicated `benchmark_timing` event
3. **Instrument the frontend (React):** For each view plane, register a render-completion hook:
   - **D3 Graph:** After the new node is added to the simulation, chain `onEngineStop` → `requestAnimationFrame` → record `performance.now()` as `t_d3`
   - **CesiumJS Globe:** Listen for `scene.postRender` after the new entity point primitive is added → record `performance.now()` as `t_cesium`
   - **Timeline:** After Zustand state update triggers re-render, use `requestAnimationFrame` → record `performance.now()` as `t_timeline`
4. **Delta calculation:** Frontend reports `t_<plane> - t_backend_commit` for each plane via IPC callback.
5. **Trials:** 30 per plane. First 3 discarded.
6. **Output:** CSV file `results/frontend_sync_lag.csv` with columns: `trial, plane, latency_ms`

### Implementation Details

#### Backend Changes (Rust — `os_gui/src-tauri/src/lib.rs`)
- Add `#[tauri::command] async fn benchmark_create_entity(...)` that returns a timing anchor.
- Add `#[tauri::command] async fn benchmark_report_timing(plane: String, latency_ms: f64)` to collect frontend measurements.
- Store results in a `Vec<BenchmarkResult>` behind an `Arc<Mutex<>>`.

#### Frontend Changes (TypeScript — `os_gui/src/`)
- Create `src/benchmark/SyncBenchmark.ts` module:
  - Listen for `benchmark_timing` events from backend.
  - Register one-shot render callbacks on each plane.
  - Report deltas back via `invoke('benchmark_report_timing', { plane, latency_ms })`.

### Note
This benchmark requires the GUI to be running. It cannot be headless. The developer may create a simple keyboard shortcut (e.g., `Ctrl+Shift+B`) that triggers 30 sequential benchmark rounds with 1-second intervals.

---

## 4. Benchmark 3: Inference Engine Response Time

### Purpose
Measure Prolog query latency from `InferenceEngine::query()` call to receiving the complete binding set.

### Protocol
1. **Setup:** Initialize `ScryerMachine`, create `InferenceEngine`. Load the full test dataset (600 entities, 700 edges) via manual `machine.ingest()` calls converting the dataset into Prolog assertions:
   - `entity('ULID', 'kind', 'label').`
   - `edge('edge_id', 'from_ulid', 'to_ulid', 'label').`
   - `spatial('ULID', Lat, Lng, Alt).`
   - `temporal('ULID', 'event_at', 'starts_at', 'ends_at').`
2. **Ingest inference rules:**
   ```prolog
   reachable(X, Y) :- edge(_, X, Y, _).
   reachable(X, Y) :- edge(_, X, Z, _), reachable(Z, Y).
   ```
3. **Query classes:**
   - **Direct Lookup:** `edge(_, 'ULID_SOURCE', Target, Label).` — pick 5 different source ULIDs, 30 trials each.
   - **Transitive Closure:** `reachable('ULID_SOURCE', X).` — pick 5 source ULIDs near graph center, 30 trials each.
   - **Aggregation:** `findall(X, reachable('ULID_SOURCE', X), Xs).` — pick 5 source ULIDs, 30 trials each.
4. **Timing:** Wrap each `inference_engine.query()` call in `Instant::now()` ... `elapsed()`.
5. **Output:** CSV file `results/prolog_latency.csv` with columns: `query_class, source_ulid, trial, latency_us, binding_count`

### Implementation Details
- **File:** `benchmarks/src/bench_prolog.rs`
- **Entry point:** `pub fn run_prolog_benchmark(dataset_report: &DatasetReport, config: BenchConfig) -> Result<(), String>`
- Use the `DatasetReport` from the generator to get the actual ULIDs for query targets.
- The Prolog machine must NOT be re-initialized between trials (it tests steady-state performance of the persistent engine).

---

## 5. Supplementary: Memory Profiling

### Purpose
Track RSS of Rust host and Chromium renderer during sustained ingestion.

### Protocol
1. **Setup:** Launch the Tauri application. Record PIDs of the Rust host and Chromium renderer.
2. **Ingestion ramp:** Use `os_cli` to ingest entities at a steady rate (approximately 83 entities/second) for 60 seconds (total: ~5,000 entities).
3. **Sampling:** A background thread reads `/proc/[pid]/status` every 500ms, extracting `VmRSS` values.
4. **Cool-down:** After ingestion completes, continue sampling for 10 seconds.
5. **Output:** CSV file `results/memory_profile.csv` with columns: `timestamp_ms, rust_rss_kb, chromium_rss_kb, entities_ingested`

### Implementation Details
- **File:** `benchmarks/src/bench_memory.rs`
- Can be a standalone binary that spawns the ingestion CLI as a subprocess while sampling.
- PID of the Tauri Rust host: look for process matching `spatial-os` or `os_gui`.
- PID of Chromium renderer: child process of the host with `--type=renderer` in cmdline.

---

## 6. Output Directory Structure

```
docs/thesis/results/
├── eventbus_throughput.csv
├── eventbus_summary.json
├── frontend_sync_lag.csv
├── prolog_latency.csv
├── prolog_summary.json
├── memory_profile.csv
└── dataset_report.json
```

## 7. CLI Integration

Add to `os_cli` or as a standalone binary:
```
spatial-os benchmark generate-dataset [--seed 42]
spatial-os benchmark eventbus [--trials 30] [--warmup 3]
spatial-os benchmark prolog [--trials 30]
spatial-os benchmark memory [--duration 60]
```

The frontend sync lag benchmark must be run interactively via the GUI (Ctrl+Shift+B trigger).

## 8. Dependencies to Add

Add to `benchmarks/Cargo.toml`:
```toml
[dependencies]
core_engine = { path = "../core_engine" }
prolog_engine = { path = "../prolog_engine" }
tokio = { version = "1", features = ["full"] }
ulid = "1"
rand = { version = "0.8", features = ["std_rng"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
csv = "1"
clap = { version = "4", features = ["derive"] }
```

## 9. Acceptance Criteria

All benchmarks must:
- [ ] Compile with `cargo check --workspace` (zero warnings).
- [ ] Run to completion without panics on the development machine.
- [ ] Produce valid CSV files parseable by any standard CSV reader.
- [ ] Be invocable via CLI subcommands.
- [ ] Support configurable trial counts (default: 30).
- [ ] Include warm-up trial discarding (default: 3).
- [ ] Print a statistical summary (median, IQR, p95, p99) to stdout after completion.
