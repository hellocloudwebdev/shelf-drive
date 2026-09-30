// Browser stand-in for @tauri-apps/plugin-store, used only by the Vite dev
// server (see the resolve.alias wiring in vite.config.ts). The UI workspace is
// edited outside the Tauri shell, so store persistence is redirected to
// localStorage to keep settings functional in the browser.

type StoreOptions = {
  autoSave?: boolean | number;
};

class BrowserStore {
  private namespace: string;

  constructor(path: string, _options?: StoreOptions) {
    this.namespace = `shelf-drive-ui:store:${path}`;
  }

  private readAll(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem(this.namespace) ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private writeAll(data: Record<string, unknown>): void {
    localStorage.setItem(this.namespace, JSON.stringify(data));
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.readAll()[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const data = this.readAll();
    data[key] = value;
    this.writeAll(data);
  }

  async delete(key: string): Promise<void> {
    const data = this.readAll();
    delete data[key];
    this.writeAll(data);
  }

  async save(): Promise<void> {
    // Writes are committed immediately; nothing to flush.
  }

  async entries(): Promise<[string, unknown][]> {
    return Object.entries(this.readAll());
  }

  async keys(): Promise<string[]> {
    return Object.keys(this.readAll());
  }

  async values(): Promise<unknown[]> {
    return Object.values(this.readAll());
  }

  async reset(): Promise<void> {
    localStorage.removeItem(this.namespace);
  }
}

export async function load(path: string, options?: StoreOptions): Promise<BrowserStore> {
  return new BrowserStore(path, options);
}

export { BrowserStore as Store };
