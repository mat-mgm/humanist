#!/usr/bin/env sh
# Drive the GUI Frontend-Sync benchmark.
# Run inside `nix develop` from the repository root.
#
# This is interactive: it prepares the headless dataset, launches the Tauri
# GUI in dev mode, waits for you to trigger the bench from inside the app,
# then derives the per-plane summary JSON.

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BIN=./target/release/humanist-bench
RESULTS=docs/thesis/results
CSV="$RESULTS/frontend_sync_lag.csv"

hr() { printf '\n────────────────────────────────────────────────────────────\n%s\n────────────────────────────────────────────────────────────\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1" >&2; exit 1; }
note() { printf '  • %s\n' "$1"; }

pause() {
    printf '\n[press ENTER to continue] '
    # shellcheck disable=SC2034
    read -r _
}

# ── 1. Pre-flight ─────────────────────────────────────────────────────────────
hr "1. Pre-flight"
command -v cargo >/dev/null 2>&1 || fail "cargo not on PATH (are you inside nix develop?)"
command -v npm   >/dev/null 2>&1 || fail "npm not on PATH (are you inside nix develop?)"

if [ ! -x "$BIN" ]; then
    note "release binary missing — building"
    cargo build -p benchmarks --release
fi
ok "release binary present: $BIN"

if [ ! -d os_gui/node_modules ]; then
    note "os_gui node_modules missing — installing"
    npm --prefix os_gui install
fi
ok "frontend dependencies present"

# ── 2. Seed the dataset so the GUI shows a populated graph ────────────────────
hr "2. Seed the benchmark dataset"
"$BIN" generate-dataset --scale 1
ok "dataset_report.json refreshed at scale=1 (600 entities)"

# Snapshot existing CSV so we can detect a fresh run later.
PREV_MTIME=0
if [ -f "$CSV" ]; then
    PREV_MTIME=$(stat -c '%Y' "$CSV" 2>/dev/null || stat -f '%m' "$CSV" 2>/dev/null || echo 0)
fi

# ── 3. Launch the GUI ─────────────────────────────────────────────────────────
hr "3. Launch the GUI (Tauri dev)"
note "starting 'npm --prefix os_gui run tauri dev' in the background"
note "first launch may take 1–2 minutes while Cargo compiles os_gui"

LOG=/tmp/humanist-tauri-dev.log
: >"$LOG"
( npm --prefix os_gui run tauri dev >"$LOG" 2>&1 ) &
GUI_PID=$!
trap 'kill $GUI_PID 2>/dev/null || true' EXIT INT TERM

note "Tauri dev PID: $GUI_PID  (log: $LOG)"

# ── 4. Manual steps inside the GUI ────────────────────────────────────────────
hr "4. Manual steps inside the GUI"
cat <<'EOF'
  When the Tauri window opens, perform these steps in order:

    1. Wait until the graph, globe, and timeline have all rendered at least
       once (pan the globe a little so Cesium warms up its tile cache).

    2. Arrange the panels so all three planes are visible at the same time:
         • activity bar = default shell (NOT the tiling layout)
         • primary canvas top split  = Globe   (Cesium)
         • primary canvas bottom tab = Timeline
         • right panel               = Graph   (D3)

    3. Click on an empty area of the canvas so the keybind handler has focus
       (clicking inside a text field will swallow the shortcut).

    4. Press   Ctrl + Shift + B   to start the suite.

    5. Do NOT interact with the window during the run. The bench performs
       3 warm-up + 30 measured trials × 3 planes = 99 measurements.
       A popup says "Benchmark Suite Finished!" when done.
EOF
pause

# ── 5. Wait for the CSV to be produced / updated ──────────────────────────────
hr "5. Waiting for $CSV to be written"
note "polling every 2s; press Ctrl-C to abort"

WAITED=0
while :; do
    if [ -f "$CSV" ]; then
        CUR_MTIME=$(stat -c '%Y' "$CSV" 2>/dev/null || stat -f '%m' "$CSV" 2>/dev/null || echo 0)
        if [ "$CUR_MTIME" != "$PREV_MTIME" ] && [ -s "$CSV" ]; then
            ok "CSV updated ($(wc -l <"$CSV") lines)"
            break
        fi
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $((WAITED % 30)) -eq 0 ]; then
        note "still waiting (${WAITED}s elapsed) — Ctrl+Shift+B inside the GUI?"
    fi
done

# ── 6. Derive per-plane summary ───────────────────────────────────────────────
hr "6. Derive per-plane summary"
"$BIN" analyze
test -s "$RESULTS/frontend_sync_summary.json" \
    || fail "frontend_sync_summary.json was not produced — check the CSV format"
ok "frontend_sync_summary.json written"

if command -v jq >/dev/null 2>&1; then
    echo
    echo "  Per-plane medians:"
    jq -r '.[] | "    \(.plane): n=\(.measured) median=\(.stats.median)ms p95=\(.stats.p95)ms timeouts=\(.timeouts)"' \
        "$RESULTS/frontend_sync_summary.json"
fi

# ── 7. Shut the GUI down cleanly ──────────────────────────────────────────────
hr "7. Shutting down the GUI"
kill "$GUI_PID" 2>/dev/null || true
wait "$GUI_PID" 2>/dev/null || true
ok "Tauri dev stopped"

hr "DONE"
echo "Raw CSV:    $CSV"
echo "Summary:    $RESULTS/frontend_sync_summary.json"
echo "Tauri log:  $LOG"
