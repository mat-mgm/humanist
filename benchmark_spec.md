# Benchmark Specification for Thesis Evaluation

Purpose: define the benchmark suite that supports the thesis chapters
`Experimental Setup` and `Results` in [docs/thesis/thesis.tex](/home/rs/computation/programming/rust/humanist/docs/thesis/thesis.tex).

This specification is intentionally aligned with the current Humanist model and the rebased `eval/benchmarking` branch. Older drafts that referred to separate `temporal`, `agent`, or `blob` entity kinds are obsolete.

## Scope

- All benchmark-related code lives on `eval/benchmarking`.
- Headless benchmark code lives in the workspace crate `benchmarks/`.
- GUI-only benchmark instrumentation lives in `os_gui/src-tauri/src/bench.rs` and `os_gui/src/benchmark/`.
- Results are written to `docs/thesis/results/`.

## Global Constraints

- Determinism first: use seeded RNG where synthetic data is generated.
- Prefer `std::time::Instant` for local latency measurement inside one process.
- When a benchmark crosses the backend/frontend boundary, use epoch-based timestamps only as a transport bridge, and keep the conversion explicit.
- Every benchmark must support configurable trial counts.
- Warm-up runs must be identifiable and excluded from the reported thesis statistics.
- Benchmarks must be isolated from the user’s normal store. Use a dedicated benchmark store root.

## Dataset Generator

Purpose: generate the heterogeneous dataset used by the quantitative evaluation and consistent with the thesis chapter text.

### Dataset Shape

Entity categories:

| Category | Traits | Count | Notes |
|---|---|---:|---|
| Physical | `SpatialTrait` | 350 | infrastructure sites and events |
| Digital | `BlobTrait` | 170 | PNG, PDF, and glTF fixtures cycled deterministically |
| Abstract | none | 50 | tag hub nodes |
| Persona | `SpatialTrait` | 30 | personnel references |
| Total |  | 600 |  |

Additional trait structure:

- `80` physical entities must also receive a `TemporalTrait`.
- Total semantic edges: `400` `tagged_as`.
- Total custom relational edges: `300`.
- Total graph edges: `700`.

### Implementation

- File: `benchmarks/src/dataset.rs`
- Entry point:

```rust
pub async fn generate_dataset(
    db: &SurrealDbAdapter,
    event_bus: &EventBus,
    blob_adapter: &LocalBlobAdapter,
    seed: u64,
    output_dir: &PathBuf,
) -> Result<DatasetReport, String>
```

- Entity IDs must be client-generated ULIDs.
- Blob assets live under `benchmarks/test_assets/`.
- The generator must emit `dataset_report.json`.
- `DatasetReport` must at minimum capture:
  - total entities
  - total edges
  - total traits
  - all entity IDs
  - the multi-trait entity IDs
  - the RNG seed used

## Benchmark 1: EventBus Throughput

Purpose: measure commit-to-broadcast latency for the core engine event path.

### Protocol

1. Create a fresh benchmark-local store.
2. Initialize `SurrealDbAdapter` and `EventBus`.
3. Subscribe to the Tokio broadcast channel before writing.
4. For each batch size in `[100, 500, 1000, 5000]`:
   - write entities one by one
   - capture `Instant::now()` immediately before `save_entity`
   - emit the matching bus event
   - stop the timer when the subscriber receives the event
5. Repeat across configurable trials.
6. Treat warm-up trials separately from measured trials.

### Outputs

- `docs/thesis/results/eventbus_throughput.csv`
- `docs/thesis/results/eventbus_summary.json`

CSV columns:

```text
batch_size,trial,entity_index,latency_us
```

## Benchmark 2: Frontend Synchronization Lag

Purpose: measure backend-commit to frontend-render latency for the three thesis planes:

- D3 graph
- Cesium globe
- Timeline

This benchmark is interactive and requires the GUI.

### Correct Timing Model

The benchmark timestamp must be taken after backend persistence succeeds and immediately before the backend emits the benchmark-start event. That timestamp is the backend-side anchor.

Because this benchmark crosses process/runtime boundaries, the frontend may use epoch-based microseconds derived from:

```ts
(performance.timeOrigin + performance.now()) * 1000
```

The conversion must be explicit in the frontend benchmark manager.

### Required Flow

1. The user launches the GUI.
2. The benchmark manager switches the app into the default activity-bar shell, disables tiling mode for the run, activates the `causal` primary canvas, forces the CausalPanel bottom tab to `timeline`, and mounts `graph` in the right panel.
3. A keyboard shortcut starts the suite: `Ctrl+Shift+B`.
4. The backend command creates one entity carrying both `SpatialTrait` and `TemporalTrait`.
5. The backend records `t_commit_us` after the save sequence completes.
6. The backend emits a `benchmark-start` event with:
   - `suite_id`
   - `trial`
   - `measured`
   - `ulid`
   - `t_commit_us`
7. Each measured plane corresponds to the current GUI shell:
   - primary canvas top split: globe
   - primary canvas bottom tab: timeline
   - right panel: graph
8. Each plane reports exactly once per trial:
   - D3 graph: first paint after the node appears in graph data
   - Cesium globe: first `postRender` after the entity exists in the viewer
   - Timeline: first paint after the new temporal trait appears
9. Missing planes must be recorded as timeouts, not silently ignored.

### Trial Structure

- Warm-up trials: `3`
- Measured trials: `30`
- Total suite length: `33`

### Outputs

- `docs/thesis/results/frontend_sync_lag.csv`

CSV layout:

```text
# suite_id=<uuid>,total_trials=33,warmup=3
suite_id,trial,measured,plane,status,ulid,latency_ms
```

Notes:

- `measured=false` rows are warm-up rows.
- `status=ok` indicates a successful render measurement.
- `status=timeout` indicates the plane did not report before the trial timeout.

### Implementation Files

- Backend: `os_gui/src-tauri/src/bench.rs`
- Backend registration: `os_gui/src-tauri/src/lib.rs`
- Frontend manager: `os_gui/src/benchmark/SyncBenchmark.ts`
- Plane hooks:
  - `os_gui/src/components/GraphPanel.tsx`
  - `os_gui/src/components/GlobePanel.tsx`
  - `os_gui/src/components/TimelineView.tsx`

## Benchmark 3: Inference Engine Response Time

Purpose: measure steady-state Prolog query latency against the benchmark dataset.

### Protocol

1. Build or load the benchmark dataset report.
2. Load the corresponding entities and relationships into the Prolog machine.
3. Use the current canonical fact vocabulary, not an outdated ad hoc one.
4. Keep the Prolog machine alive across trials.
5. Measure query latency with `Instant`.

### Query Classes

- Direct lookup
- Transitive closure
- Aggregation via `findall`

### Outputs

- `docs/thesis/results/prolog_latency.csv`
- `docs/thesis/results/prolog_summary.json`

CSV columns:

```text
query_class,source_ulid,trial,latency_us,binding_count
```

## Supplementary Metric: Memory Profiling

Purpose: sample RSS for the Rust host and renderer during sustained ingestion.

### Outputs

- `docs/thesis/results/memory_profile.csv`

CSV columns:

```text
timestamp_ms,rust_rss_kb,chromium_rss_kb,entities_ingested
```

## CLI Surface

The benchmark crate exposes:

```text
spatial-os-bench generate-dataset [--seed 42]
spatial-os-bench eventbus [--trials 30] [--warmup 3]
spatial-os-bench prolog [--trials 30] [--warmup 3] [--seed 42]
spatial-os-bench memory [--duration 60]
spatial-os-bench frontend
spatial-os-bench run-all [--trials 30] [--warmup 3] [--seed 42]
```

The GUI sync benchmark is launched interactively through `Ctrl+Shift+B`.

## Acceptance Criteria

- `cargo check --workspace` passes in the project dev environment.
- `generate-dataset` runs successfully and produces a 600-entity report.
- Headless benchmarks run without panics on the development machine.
- GUI benchmark results clearly distinguish warm-up, measured, and timeout rows.
- Output files are written under `docs/thesis/results/`.
- The benchmark behavior matches the current thesis chapter descriptions, not older ontology drafts.
