/**
 * A ReplayGuard enforces that a verified proof drives at most one execution.
 * `consume` returns true the first time a proof id is presented and false on
 * every later attempt, so a still-valid proof cannot be replayed against the
 * same action before it expires.
 *
 * The in-memory guard below fits a single process. For multi-instance or
 * horizontally scaled deployments, back this interface with a shared store
 * (for example Redis `SET key 1 NX PX <ttl>`) so single-use holds across every
 * node under load.
 */
export interface ReplayGuard {
  consume(proofId: string, expiresAt?: string): Promise<boolean>;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

export class InMemoryReplayGuard implements ReplayGuard {
  readonly #consumed = new Map<string, number>();
  #lastSweep = 0;

  async consume(proofId: string, expiresAt?: string): Promise<boolean> {
    const now = Date.now();

    // Periodically drop expired entries so memory stays bounded under sustained
    // traffic. An expired proof is already rejected during verification, so its
    // id no longer needs to be retained here.
    if (now - this.#lastSweep > SWEEP_INTERVAL_MS) {
      for (const [id, expiry] of this.#consumed) {
        if (expiry <= now) this.#consumed.delete(id);
      }
      this.#lastSweep = now;
    }

    if (this.#consumed.has(proofId)) return false;

    const parsed = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
    const expiry = Number.isNaN(parsed) ? now + ONE_DAY_MS : parsed;
    this.#consumed.set(proofId, expiry);
    return true;
  }
}
