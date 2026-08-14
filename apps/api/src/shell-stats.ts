import type { ShellStatsEvent, ShellStatsSnapshot } from "@lpbot/api-contract";

export interface ShellStatsContext {
  userId: string;
}

export interface ShellStatsSubscriptionContext extends ShellStatsContext {
  afterSequence: number;
  signal: AbortSignal;
}

export interface ShellStatsProvider {
  getSnapshot(context: ShellStatsContext): Promise<ShellStatsSnapshot>;
  subscribe(context: ShellStatsSubscriptionContext): AsyncIterable<ShellStatsEvent>;
}

export class UnavailableShellStatsProvider implements ShellStatsProvider {
  async getSnapshot(): Promise<ShellStatsSnapshot> {
    return {
      observedAt: new Date(0).toISOString(),
      sequence: 0,
      stats: {
        fps: null,
        gas: { baseGwei: null, ethereumGwei: null },
        online: null,
        pingMs: null,
        recommendedPools: null,
        taskCounts: { paused: null, running: null, stopped: null },
      },
    };
  }

  async *subscribe(): AsyncIterable<ShellStatsEvent> {
    return;
  }
}
