import { RequestMethod, type INestApplication } from "@nestjs/common";
import type { CustomOrigin } from "@nestjs/common/interfaces/external/cors-options.interface";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { requestIdMiddleware } from "./common/request-id";
import { securityHeaders } from "./common/security-headers";
import { isAllowedCorsOrigin, loadConfig } from "./config";

export async function createApp(): Promise<INestApplication> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === "test" ? false : ["log", "error", "warn"],
  });
  app.enableCors({
    origin: ((origin, callback) => {
      callback(null, isAllowedCorsOrigin(origin, config));
    }) satisfies CustomOrigin,
    credentials: true,
  });
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(securityHeaders);
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "ready", method: RequestMethod.GET },
    ],
  });
  return app;
}
