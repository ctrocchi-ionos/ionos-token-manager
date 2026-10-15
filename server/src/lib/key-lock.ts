const tails = new Map<string, Promise<unknown>>();

/**
 * Run `fn` only after every earlier call with the same key has finished.
 * The app is one Node process, so this is enough to keep two operations on the same token
 * (regenerate, revoke, the expiry sweep) from interleaving across their IONOS calls.
 */
export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.catch(() => undefined); // a failed call must not block the next one
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
