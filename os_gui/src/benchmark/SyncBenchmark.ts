import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface BenchmarkUpdate {
  ulid: string;
  t_start: number; // microseconds from backend
}

class SyncBenchmarkManager {
  private activeTrial: number = -1;
  private currentUlid: string | null = null;
  private startTime: number = 0;
  private resultsCollected: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor() {
    this.setupListener();
  }

  private async setupListener() {
    await listen<BenchmarkUpdate>('benchmark-start', (event) => {
      this.currentUlid = event.payload.ulid;
      this.startTime = event.payload.t_start;
      this.resultsCollected.clear();
      console.log(`[BENCH] Trial ${this.activeTrial} started for ULID ${this.currentUlid}`);
    });
  }

  /**
   * Start the 30-trial benchmark sequence.
   */
  public async startSuite() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[BENCH] Starting 30-trial Sync Benchmark...');

    for (let i = 0; i < 30; i++) {
      this.activeTrial = i;
      this.resultsCollected.clear();
      
      const res = await invoke<BenchmarkUpdate>('benchmark_create_entity');
      this.currentUlid = res.ulid;
      this.startTime = res.t_start;
      
      console.log(`[BENCH] Trial ${i} started for ULID ${this.currentUlid}`);
      
      // Wait for all planes to report OR timeout (2s)
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.resultsCollected.size >= 3) {
            clearInterval(check);
            resolve(true);
          }
        }, 50);
        setTimeout(() => { clearInterval(check); resolve(false); }, 2000);
      });

      console.log(`[BENCH] Trial ${i} complete.`);
      // Short breather between trials
      await new Promise(r => setTimeout(r, 200));
    }

    this.isRunning = false;
    this.activeTrial = -1;
    console.log('[BENCH] Benchmark suite finished.');
    alert('Benchmark Suite Finished! Results in docs/thesis/results/frontend_sync_lag.csv');
  }

  /**
   * Components call this when they detect a render of the benchmark ULID.
   */
  public async reportRender(plane: string, ulid: string) {
    if (!this.isRunning || ulid !== this.currentUlid || this.resultsCollected.has(plane)) {
      return;
    }

    // Capture high-res current time in microseconds
    // performance.now() is ms since page load, so we need to offset it to match SystemTime
    // or just calculate the delta since t_start was received.
    // Actually, the simplest is (Date.now() * 1000) - t_start.
    const nowUs = Date.now() * 1000;
    const latencyUs = nowUs - this.startTime;
    const latencyMs = latencyUs / 1000.0;

    this.resultsCollected.add(plane);
    
    try {
      await invoke('benchmark_report_timing', {
        plane,
        trial: this.activeTrial,
        latencyMs
      });
      console.log(`[BENCH] ${plane} rendered. Latency: ${latencyMs.toFixed(2)}ms`);
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
