import { createApp, createAppServices } from "./app.js";
import { loadConfig } from "./config.js";
import { ensureDataRoot } from "./services/data-root.js";

async function main() {
  const config = loadConfig();
  const paths = await ensureDataRoot(config.dataRoot);
  const services = createAppServices(config, paths);
  const app = createApp(services);

  app.listen(config.port, config.host, () => {
    console.log(`show-manager listening on http://${config.host}:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
