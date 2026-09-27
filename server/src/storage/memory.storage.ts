import { Readable } from "node:stream";
import { NotFoundError } from "../common/errors";
import { assertSafeObjectKey } from "./object-keys";
import type { StorageProvider } from "./storage.types";

export class MemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeObjectKey(key);
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async download(key: string): Promise<Readable> {
    assertSafeObjectKey(key);
    const object = this.objects.get(key);
    if (!object) {
      throw new NotFoundError();
    }
    return Readable.from(object.body);
  }

  async delete(key: string): Promise<void> {
    assertSafeObjectKey(key);
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    assertSafeObjectKey(key);
    return this.objects.has(key);
  }
}
