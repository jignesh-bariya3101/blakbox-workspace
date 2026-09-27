import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp } from "../src/create-app";

export async function startTestApp() {
  const app = await createApp();
  await app.init();
  return app;
}

export function api(app: INestApplication) {
  return request(app.getHttpServer());
}
