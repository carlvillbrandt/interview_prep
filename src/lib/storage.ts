import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { InterviewRecordSchema, type InterviewRecord } from "@/lib/schemas";

/* ------------------------------------------------------------------ */
/* Interfaces — swap the file implementations for Postgres later.      */
/* ------------------------------------------------------------------ */

export interface ResultStore {
  get(conversationId: string): Promise<InterviewRecord | null>;
  put(record: InterviewRecord): Promise<void>;
  /** Read-modify-write; serialised per conversation id within this process. */
  update(
    conversationId: string,
    fn: (current: InterviewRecord) => InterviewRecord,
  ): Promise<InterviewRecord | null>;
}

export const ProvisionEntrySchema = z.object({
  hash: z.string(),
  palId: z.string(),
  objectivesId: z.string(),
  guardrailIds: z.array(z.string()),
  documentIds: z.array(z.string()).default([]),
  faceId: z.string(),
  provisionedAt: z.string(),
});
export type ProvisionEntry = z.infer<typeof ProvisionEntrySchema>;

const ProvisionCacheFileSchema = z.object({
  version: z.literal(1),
  /** Auto-selected stock face, reused across companies. */
  defaultFaceId: z.string().optional(),
  companies: z.record(z.string(), ProvisionEntrySchema),
});
type ProvisionCacheFile = z.infer<typeof ProvisionCacheFileSchema>;

export interface ProvisionCacheStore {
  get(key: string): Promise<ProvisionEntry | null>;
  set(key: string, entry: ProvisionEntry): Promise<void>;
  getDefaultFaceId(): Promise<string | null>;
  setDefaultFaceId(faceId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function dataDir(): string {
  return process.env.PREPROOM_DATA_DIR
    ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.PREPROOM_DATA_DIR)
    : path.join(process.cwd(), "data");
}

/** Atomic write: temp file + rename, so a crash never leaves half a JSON file. */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Per-key promise chain so concurrent updates in one process don't clobber each other. */
class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

/* ------------------------------------------------------------------ */
/* File implementations                                                */
/* ------------------------------------------------------------------ */

export class FileResultStore implements ResultStore {
  private mutex = new KeyedMutex();
  constructor(private readonly dir = path.join(dataDir(), "results")) {}

  private file(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid conversation id");
    return path.join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<InterviewRecord | null> {
    const raw = await readJson(this.file(id));
    if (raw === null) return null;
    return InterviewRecordSchema.parse(raw);
  }

  async put(record: InterviewRecord): Promise<void> {
    const valid = InterviewRecordSchema.parse(record);
    await this.mutex.run(valid.conversationId, () => writeJsonAtomic(this.file(valid.conversationId), valid));
  }

  async update(
    id: string,
    fn: (current: InterviewRecord) => InterviewRecord,
  ): Promise<InterviewRecord | null> {
    return this.mutex.run(id, async () => {
      const current = await this.get(id);
      if (!current) return null;
      const next = InterviewRecordSchema.parse(fn(current));
      await writeJsonAtomic(this.file(id), next);
      return next;
    });
  }
}

export class FileProvisionCacheStore implements ProvisionCacheStore {
  private mutex = new KeyedMutex();
  constructor(private readonly file = path.join(dataDir(), "tavus-cache.json")) {}

  private async read(): Promise<ProvisionCacheFile> {
    const raw = await readJson(this.file);
    if (raw === null) return { version: 1, companies: {} };
    const parsed = ProvisionCacheFileSchema.safeParse(raw);
    // A corrupt or outdated cache only costs a re-provision; never crash on it.
    return parsed.success ? parsed.data : { version: 1, companies: {} };
  }

  private mutate(fn: (c: ProvisionCacheFile) => void): Promise<void> {
    return this.mutex.run("cache", async () => {
      const cache = await this.read();
      fn(cache);
      await writeJsonAtomic(this.file, cache);
    });
  }

  async get(key: string): Promise<ProvisionEntry | null> {
    return (await this.read()).companies[key] ?? null;
  }
  set(key: string, entry: ProvisionEntry): Promise<void> {
    return this.mutate((c) => {
      c.companies[key] = ProvisionEntrySchema.parse(entry);
    });
  }
  async getDefaultFaceId(): Promise<string | null> {
    return (await this.read()).defaultFaceId ?? null;
  }
  setDefaultFaceId(faceId: string): Promise<void> {
    return this.mutate((c) => {
      c.defaultFaceId = faceId;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Singletons (survive dev hot reloads)                                */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as {
  __preproomResultStore?: ResultStore;
  __preproomProvisionCache?: ProvisionCacheStore;
};

export function resultStore(): ResultStore {
  return (g.__preproomResultStore ??= new FileResultStore());
}

export function provisionCache(): ProvisionCacheStore {
  return (g.__preproomProvisionCache ??= new FileProvisionCacheStore());
}
