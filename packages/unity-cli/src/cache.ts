import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * TTL cache for Unity CLI answers, in memory *and* on disk.
 *
 * Two different lifetimes need this. The MCP server is long-lived, so an in-process map is
 * enough; `uvibe` is a fresh process per invocation, and some CLI calls are genuinely slow
 * (`unity doctor` measured at ~13s because it verifies the account session over the network).
 * The disk layer keeps a second `uvibe doctor` instant.
 */

interface Entry<T> {
  at: number;
  value: T;
}

const memory = new Map<string, Entry<unknown>>();

function cacheFile(projectPath?: string): string {
  return projectPath
    ? path.join(projectPath, ".unity-vibe", "cache", "unity-cli.json")
    : path.join(os.tmpdir(), "uvibe-unity-cli-cache.json");
}

async function readDisk(projectPath: string | undefined, key: string): Promise<Entry<unknown> | null> {
  try {
    const raw = await fs.readFile(cacheFile(projectPath), "utf8");
    const parsed = JSON.parse(raw) as Record<string, Entry<unknown>>;
    return parsed[key] ?? null;
  } catch {
    return null;
  }
}

async function writeDisk(projectPath: string | undefined, key: string, entry: Entry<unknown>): Promise<void> {
  const file = cacheFile(projectPath);
  try {
    let all: Record<string, Entry<unknown>> = {};
    try {
      all = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, Entry<unknown>>;
    } catch {
      // First write, or a corrupt cache we're about to replace.
    }
    all[key] = entry;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(all), "utf8");
  } catch {
    // A cache that can't be written is not an error — the caller already has its answer.
  }
}

export interface CacheSpec {
  key: string;
  ttlMs: number;
  projectPath?: string;
  /** Skip the lookup and refresh the entry. */
  force?: boolean;
}

/**
 * Returns the cached value when it is younger than `ttlMs`, otherwise runs `produce`. Only
 * successful results are cached — `shouldCache` decides, so a transient CLI failure is not
 * remembered for an hour.
 */
export async function cached<T>(
  spec: CacheSpec,
  produce: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true
): Promise<{ value: T; fromCache: boolean; ageMs: number }> {
  const now = Date.now();
  if (!spec.force) {
    const hit = memory.get(spec.key) ?? (await readDisk(spec.projectPath, spec.key));
    if (hit && now - hit.at < spec.ttlMs) {
      memory.set(spec.key, hit);
      return { value: hit.value as T, fromCache: true, ageMs: now - hit.at };
    }
  }
  const value = await produce();
  if (shouldCache(value)) {
    const entry: Entry<T> = { at: Date.now(), value };
    memory.set(spec.key, entry);
    void writeDisk(spec.projectPath, spec.key, entry);
  }
  return { value, fromCache: false, ageMs: 0 };
}

/**
 * Drop every memoized answer, in memory and on disk. The disk half matters: without it a
 * `--refresh` (or a test that changes what the CLI would report) keeps reading a stale entry
 * written by an earlier process.
 */
export function clearUnityCliCache(projectPath?: string): void {
  memory.clear();
  for (const file of new Set([cacheFile(undefined), cacheFile(projectPath)])) {
    try {
      rmSync(file, { force: true });
    } catch {
      // Nothing cached, or a cache we may not delete — either way there is nothing to do.
    }
  }
}
