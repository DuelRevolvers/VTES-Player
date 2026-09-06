/**
 * Seeded RNG (mulberry32). All engine randomness flows through this so a
 * (seed, command log) pair reproduces a game exactly (design §7). The
 * current position lives in GameState.rngState.
 */

export function rngNext(state: { rngState: number }): number {
  let t = (state.rngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function rngInt(state: { rngState: number }, n: number): number {
  return Math.floor(rngNext(state) * n);
}
