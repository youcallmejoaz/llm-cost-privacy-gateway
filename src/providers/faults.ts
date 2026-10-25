import type { ProviderId } from '../types.js';

export type FaultMode = 'none' | 'error' | 'timeout';

/** Lets the demo (and tests) simulate a provider outage without touching real vendors. */
export class FaultController {
  private modes = new Map<ProviderId, FaultMode>();

  set(provider: ProviderId, mode: FaultMode): void {
    this.modes.set(provider, mode);
  }

  get(provider: ProviderId): FaultMode {
    return this.modes.get(provider) ?? 'none';
  }

  all(): Record<string, FaultMode> {
    return Object.fromEntries(this.modes);
  }

  clear(): void {
    this.modes.clear();
  }
}
