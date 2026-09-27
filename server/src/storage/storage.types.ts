import type { Readable } from "node:stream";

export interface StorageProvider {
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
