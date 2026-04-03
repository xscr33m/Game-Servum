/**
 * Shared shutdown state — used to signal restart vs. clean shutdown.
 * Set from system routes, read during graceful shutdown in index.ts.
 */

let restartRequested = false;

export function setRestartFlag(): void {
  restartRequested = true;
}

export function isRestartRequested(): boolean {
  return restartRequested;
}
