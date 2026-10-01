import { createApp, createAppServices } from "./app.js";
import { loadConfig } from "./config.js";
import { ensureDataRoot } from "./services/data-root.js";
import { PresenterInput } from "./services/presenter-input.js";

async function main() {
  const config = loadConfig();
  const paths = await ensureDataRoot(config.dataRoot);
  const services = createAppServices(config, paths);
  const app = createApp(services);
  services.youtubeQueueScheduler.start();
  const presenter = new PresenterInput(config.raspSshTarget, services.youtubeQueueScheduler);
  presenter.start();

  const server = app.listen(config.port, config.host, () => {
    console.log(`show-manager listening on http://${config.host}:${config.port}`);
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const drained = services.youtubeQueueScheduler.stop();
    server.close(() => { process.exitCode = 0; });
    void Promise.all([presenter.stop(), drained]).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
