import "reflect-metadata";
import { loadConfig } from "./config";
import { createApp } from "./create-app";

async function bootstrap() {
  const config = loadConfig();
  const app = await createApp();
  await app.listen(config.PORT, config.HOST);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
