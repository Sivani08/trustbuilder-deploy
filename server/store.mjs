import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor({ directory, seed }) {
    this.directory = directory;
    this.file = path.join(directory, "trustbuilder.json");
    this.temporary = path.join(directory, "trustbuilder.tmp.json");
    this.seed = seed;
    this.queue = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try {
      await readFile(this.file, "utf8");
    } catch {
      await this.write(this.seed());
    }
    return this;
  }

  async read() {
    const raw = await readFile(this.file, "utf8");
    const data = JSON.parse(raw);
    return structuredClone(data);
  }

  async write(data) {
    const operation = async () => {
      const serialized = JSON.stringify(data, null, 2);
      await writeFile(this.temporary, serialized, { encoding: "utf8", mode: 0o600 });
      await rename(this.temporary, this.file);
      return structuredClone(data);
    };
    this.queue = this.queue.then(operation, operation);
    return this.queue;
  }

  async transaction(mutator) {
    const operation = async () => {
      const current = await this.read();
      const result = await mutator(current);
      const next = result?.data || current;
      const serialized = JSON.stringify(next, null, 2);
      await writeFile(this.temporary, serialized, { encoding: "utf8", mode: 0o600 });
      await rename(this.temporary, this.file);
      return result?.result;
    };
    this.queue = this.queue.then(operation, operation);
    return this.queue;
  }
}

