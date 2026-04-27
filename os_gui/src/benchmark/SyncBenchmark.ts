import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useOsStore } from '../store';

export interface BenchmarkUpdate {
  suite_id: string;
  ulid: string;
  trial: number;
  measured: boolean;
  t_commit_us: number;
}

interface BenchmarkCreateArgs extends Record<string, unknown> {
  suiteId: string;
  trial: number;
  measured: boolean;
}

class SyncBenchmarkManager {
  private readonly warmupTrials = 3;
  private readonly measuredTrials = 30;
  private readonly expectedPlanes = ['D3 Graph', 'Cesium Globe', 'Timeline'];
  private readonly trialTimeoutMs = 3_000;

  private suiteId: string | null = null;
  private activeTrial: number = -1;
  private currentUlid: string | null = null;
  private currentMeasured: boolean = false;
  private startTimeUs: number = 0;
  private resultsCollected: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor() {
    this.setupListener();
  }

  private async setupListener() {
    await listen<BenchmarkUpdate>('benchmark-start', (event) => {
      this.suiteId = event.payload.suite_id;
      this.currentUlid = event.payload.ulid;
      this.activeTrial = event.payload.trial;
      this.currentMeasured = event.payload.measured;
      this.startTimeUs = event.payload.t_commit_us;
      this.resultsCollected.clear();
      console.log(
        `[BENCH] Trial ${this.activeTrial} (${this.currentMeasured ? 'measured' : 'warmup'}) started for ULID ${this.currentUlid}`,
      );
    });
  }

  private nowEpochUs() {
    return Math.round((performance.timeOrigin + performance.now()) * 1000);
  }

  private async prepareUi() {
    const store = useOsStore.getState();
    store.setTilingModeEnabled(false);
    store.setActiveActivity('causal');
    store.setSidePanelOpen(true);
    store.setRightPanelId('graph');
    window.dispatchEvent(new CustomEvent('humanist:benchmark-prepare'));

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  /**
   * Start the benchmark sequence with 3 warm-up trials followed by 30 measured trials.
   */
  public async startSuite() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.suiteId = globalThis.crypto.randomUUID();
    this.currentUlid = null;
    this.currentMeasured = false;
    this.resultsCollected.clear();
    console.log('[BENCH] Starting frontend sync benchmark...');

    try {
      await this.prepareUi();
      await invoke('benchmark_reset_results', {
        suiteId: this.suiteId,
        totalTrials: this.warmupTrials + this.measuredTrials,
        warmup: this.warmupTrials,
      });

      for (let i = 0; i < this.warmupTrials + this.measuredTrials; i++) {
        this.activeTrial = i;
        this.currentMeasured = i >= this.warmupTrials;
        this.resultsCollected.clear();

        const createArgs: BenchmarkCreateArgs = {
          suiteId: this.suiteId ?? globalThis.crypto.randomUUID(),
          trial: this.activeTrial,
          measured: this.currentMeasured,
        };
        const res = await invoke<BenchmarkUpdate>('benchmark_create_entity', createArgs);
        this.suiteId = res.suite_id;
        this.currentUlid = res.ulid;
        this.startTimeUs = res.t_commit_us;

        console.log(
          `[BENCH] Trial ${i} (${this.currentMeasured ? 'measured' : 'warmup'}) started for ULID ${this.currentUlid}`,
        );

        const completed = await new Promise<boolean>((resolve) => {
          const check = setInterval(() => {
            if (this.resultsCollected.size >= this.expectedPlanes.length) {
              clearInterval(check);
              resolve(true);
            }
          }, 50);

          setTimeout(() => {
            clearInterval(check);
            resolve(false);
          }, this.trialTimeoutMs);
        });

        if (!completed && this.currentUlid && this.suiteId) {
          const missing = this.expectedPlanes.filter(plane => !this.resultsCollected.has(plane));
          for (const plane of missing) {
            await invoke('benchmark_report_timing', {
              suiteId: this.suiteId,
              plane,
              trial: this.activeTrial,
              measured: this.currentMeasured,
              ulid: this.currentUlid,
              status: 'timeout',
              latencyMs: null,
            });
          }
          console.warn(`[BENCH] Trial ${i} timed out. Missing planes: ${missing.join(', ')}`);
        }

        console.log(`[BENCH] Trial ${i} complete.`);
        await new Promise(r => setTimeout(r, 350));
      }

      console.log('[BENCH] Benchmark suite finished.');
      alert('Benchmark Suite Finished! Results in docs/thesis/results/frontend_sync_lag.csv');
    } finally {
      this.isRunning = false;
      this.activeTrial = -1;
    }
  }

  /**
   * Components call this when they detect a render of the benchmark ULID.
   */
  public async reportRender(plane: string, ulid: string) {
    if (
      !this.isRunning ||
      !this.suiteId ||
      ulid !== this.currentUlid ||
      this.resultsCollected.has(plane)
    ) {
      return;
    }

    const nowUs = this.nowEpochUs();
    const latencyUs = nowUs - this.startTimeUs;
    const latencyMs = latencyUs / 1000.0;

    this.resultsCollected.add(plane);

    try {
      await invoke('benchmark_report_timing', {
        suiteId: this.suiteId,
        plane,
        trial: this.activeTrial,
        measured: this.currentMeasured,
        ulid,
        status: 'ok',
        latencyMs,
      });
      console.log(
        `[BENCH] ${plane} rendered. Latency: ${latencyMs.toFixed(2)}ms (${this.currentMeasured ? 'measured' : 'warmup'})`,
      );
    } catch (err) {
      console.error(`[BENCH] Failed to report timing for ${plane}:`, err);
    }
  }

  public isBenchmarking() {
    return this.isRunning;
  }

  public getCurrentUlid() {
    return this.currentUlid;
  }
}

export const syncBenchmark = new SyncBenchmarkManager();
