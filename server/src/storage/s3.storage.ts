import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "../config";
import { NotFoundError } from "../common/errors";
import { assertSafeObjectKey } from "./object-keys";
import type { StorageProvider } from "./storage.types";

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly config: Config) {
    this.client = new S3Client({
      region: config.MINIO_REGION,
      endpoint: config.MINIO_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.MINIO_ACCESS_KEY,
        secretAccessKey: config.MINIO_SECRET_KEY,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.MINIO_BUCKET }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.MINIO_BUCKET }));
    }
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeObjectKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.MINIO_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async download(key: string): Promise<Readable> {
    assertSafeObjectKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.MINIO_BUCKET, Key: key }),
    );
    if (!response.Body) {
      throw new NotFoundError();
    }
    return response.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    assertSafeObjectKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.MINIO_BUCKET, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    assertSafeObjectKey(key);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.MINIO_BUCKET, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
