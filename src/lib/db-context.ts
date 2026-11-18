import { AsyncLocalStorage } from "node:async_hooks";

export type DbScope = "live" | "demo";

const storage = new AsyncLocalStorage<{ scope: DbScope }>();

/** Bind the rest of this request to live or demo SQLite. */
export function enterDbScope(scope: DbScope) {
  storage.enterWith({ scope });
}

export function currentDbScope(): DbScope {
  return storage.getStore()?.scope || "live";
}

export function runWithDbScope<T>(scope: DbScope, fn: () => T): T {
  return storage.run({ scope }, fn);
}
