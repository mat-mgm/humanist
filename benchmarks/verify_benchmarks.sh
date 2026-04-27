#!/usr/bin/env sh
# Verify the benchmark suite end-to-end.
# Run inside `nix develop` from the repository root.

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BIN=./target/release/humanist-bench
RESULTS=docs/thesis/results

hr() { printf '\n────────────────────────────────────────────────────────────\n%s\n────────────────────────────────────────────────────────────\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1" >&2; exit 1; }

require_jq() {
    command -v jq >/dev/null 2>&1 || fail "jq not on PATH (it should be in the nix dev shell)"
}

# ── 1. Workspace check ────────────────────────────────────────────────────────
hr "1. Workspace check"
cargo check --workspace
ok "cargo check --workspace passes"

# ── 2. Release build ──────────────────────────────────────────────────────────
hr "2. Release build of benchmarks"
cargo build -p benchmarks --release
test -x "$BIN" || fail "binary not produced at $BIN"
ok "release binary built: $BIN"

require_jq

# ── 3. Dataset generation, scale = 1 ──────────────────────────────────────────
hr "3. Dataset generation (scale=1 → 600 entities)"
"$BIN" generate-dataset --scale 1
ents=$(jq -r '.total_entities' "$RESULTS/dataset_report.json")
edges=$(jq -r '.total_edges' "$RESULTS/dataset_report.json")
traits=$(jq -r '.total_traits' "$RESULTS/dataset_report.json")
echo "  -> entities=$ents edges=$edges traits=$traits"
test "$ents" = "600" || fail "expected 600 entities, got $ents"
test "$edges" = "700" || fail "expected 700 edges, got $edges"
ok "scale=1 dataset shape correct"

# ── 4. Dataset generation, scale = 10 ─────────────────────────────────────────
hr "4. Dataset generation (scale=10 → 6,000 entities)"
"$BIN" generate-dataset --scale 10
ents=$(jq -r '.total_entities' "$RESULTS/dataset_report.json")
edges=$(jq -r '.total_edges' "$RESULTS/dataset_report.json")
echo "  -> entities=$ents edges=$edges"
test "$ents" = "6000" || fail "expected 6000 entities, got $ents"
test "$edges" = "7000" || fail "expected 7000 edges, got $edges"
ok "scale=10 dataset shape correct"

# Restore scale=1 dataset for downstream commands
"$BIN" generate-dataset --scale 1 >/dev/null
ok "restored scale=1 dataset for downstream tests"

# ── 5. Prolog rule-arity fix: transitive closure must yield bindings ──────────
hr "5. Prolog harness — rule fix verification"
"$BIN" prolog --trials 30 --warmup 3 --scale 1
counts=$(jq -r '.[].stats.count' "$RESULTS/prolog_summary.json" | sort -u)
echo "  -> per-class counts:"
echo "$counts" | sed 's/^/     /'
# 5 sources × 27 measured trials = 135 per class
expected_count=135
match=$(echo "$counts" | grep -c "^${expected_count}$" || true)
test "$match" -ge 1 || fail "expected count=$expected_count per query class, got: $counts"

# Confirm transitive_closure has non-zero bindings (the old rule never matched)
nonzero=$(awk -F, 'NR>1 && $1=="transitive_closure" && $5+0 > 0 {n++} END{print n+0}' \
            "$RESULTS/prolog_latency.csv")
echo "  -> transitive_closure rows with binding_count > 0: $nonzero"
test "$nonzero" -gt 0 || fail "transitive closure still returns empty bindings — rule arity may still be broken"
ok "Prolog harness now produces real bindings and full sample counts"

# ── 6. EventBus harness — count must reflect 27 measured trials × batch_size ──
hr "6. EventBus harness — sample-count verification"
"$BIN" eventbus --trials 30 --warmup 3
echo "  -> per-batch counts:"
jq -r '.[] | "     batch=\(.batch_size) count=\(.stats.count) median=\(.stats.median | floor)µs"' \
    "$RESULTS/eventbus_summary.json"
# 27 measured × {100, 500, 1000, 5000} = {2700, 13500, 27000, 135000}
for expected in 2700 13500 27000 135000; do
    match=$(jq --argjson n "$expected" '[.[].stats.count] | index($n)' "$RESULTS/eventbus_summary.json")
    test "$match" != "null" || fail "expected batch count=$expected missing from eventbus_summary.json"
done
ok "EventBus produces all four batch sizes with correct counts"

# ── 7. Memory bench — RSS must actually grow ──────────────────────────────────
hr "7. Memory profile — self-contained, RSS must grow"
"$BIN" memory --duration 30
init=$(jq -r '.rss_kb_initial' "$RESULTS/memory_profile_summary.json")
peak=$(jq -r '.rss_kb_peak' "$RESULTS/memory_profile_summary.json")
ents=$(jq -r '.actual_entities' "$RESULTS/memory_profile_summary.json")
delta=$((peak - init))
echo "  -> init=${init}KB peak=${peak}KB Δ=${delta}KB ingested=$ents"
test "$delta" -gt 0 || fail "RSS did not grow — memory bench still broken"
test "$ents" -gt 100 || fail "fewer than 100 entities ingested; load generator may be stalled"
ok "memory profile shows growth from in-process ingestion"

# ── 8. Prolog scaling sub-experiment — should show monotone-ish growth ────────
hr "8. Prolog scaling vs N"
"$BIN" prolog-scaling --trials 20 --warmup 3 --scales 1,4,16
echo "  -> transitive_closure median by scale:"
jq -r '.[] | "     scale=\(.scale) ents=\(.entities) median=\(.transitive_closure.median | floor)µs"' \
    "$RESULTS/prolog_scaling_summary.json"
ok "Prolog scaling JSON written"

# ── 9. EventBus saturation sub-experiment ─────────────────────────────────────
hr "9. EventBus fan-out saturation"
"$BIN" eventbus-saturation --trials 10 --warmup 3 --subscribers 1,4,16,64 --batch-size 200
echo "  -> median latency by subscriber count:"
jq -r '.[] | "     subs=\(.subscribers) median=\(.stats.median | floor)µs p99=\(.stats.p99 | floor)µs"' \
    "$RESULTS/eventbus_saturation_summary.json"
ok "saturation JSON written"

# ── 10. Analyzer over existing CSVs ───────────────────────────────────────────
hr "10. Analyzer (frontend + memory CSV summaries)"
"$BIN" analyze
test -s "$RESULTS/memory_profile_analysis.json" || fail "memory_profile_analysis.json missing or empty"
if [ -s "$RESULTS/frontend_sync_lag.csv" ]; then
    test -s "$RESULTS/frontend_sync_summary.json" || fail "frontend_sync_summary.json missing despite CSV present"
    echo "  -> frontend planes:"
    jq -r '.[] | "     \(.plane): n=\(.measured) median=\(.stats.median)ms timeouts=\(.timeouts)"' \
        "$RESULTS/frontend_sync_summary.json"
    ok "frontend summary derived"
else
    echo "  (no frontend_sync_lag.csv — run the GUI bench via Ctrl+Shift+B to populate it)"
fi
echo "  -> memory analysis:"
jq -r '"     samples=\(.samples) Δ=\(.rss_kb_delta)KB ents=\(.entities_observed) per_entity=\(.rss_kb_per_entity | tostring)KB"' \
    "$RESULTS/memory_profile_analysis.json"
ok "memory analysis derived"

# ── 11. Output inventory ──────────────────────────────────────────────────────
hr "11. Output inventory"
ls -1 "$RESULTS"

hr "ALL CHECKS PASSED"
echo "Results directory: $RESULTS"
