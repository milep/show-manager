import { z } from "zod";

const configSchema = z.object({
  SHOW_MANAGER_HOST: z.string().ip().default("127.0.0.1"),
  SHOW_MANAGER_PORT: z.coerce.number().int().min(1).max(65535).default(4791),
  SHOW_MANAGER_DATA_ROOT: z.string().min(1).default("/home/devops/data/dev/show-manager"),
  SHOW_MANAGER_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(250_000_000),
  SHOW_MANAGER_RASP_SSH_TARGET: z.string().min(1).default("rasp"),
  SHOW_MANAGER_RASP_ACTIVE_ROOT: z.string().min(1).default("/home/pi/show-player"),
  SHOW_MANAGER_RASP_RELEASES_TO_KEEP: z.coerce.number().int().min(1).max(20).default(3),
  SHOW_MANAGER_PUBLIC_BASE_URL: z.string().url().default("https://show.miikaleppanen.com"),
  SHOW_MANAGER_PUBLIC_ACCESS_HEADER: z.string().min(1).default("x-show-manager-access"),
  SHOW_MANAGER_PUBLIC_ACCESS_VALUE: z.string().min(1).default("public"),
  SHOW_MANAGER_SESSION_COOKIE_NAME: z.string().min(1).default("show_manager_session"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ShowManagerConfig = {
  host: string;
  port: number;
  dataRoot: string;
  maxUploadBytes: number;
  raspSshTarget: string;
  raspActiveRoot: string;
  raspReleasesToKeep: number;
  publicBaseUrl: string;
  publicAccessHeader: string;
  publicAccessValue: string;
  sessionCookieName: string;
  nodeEnv: "development" | "test" | "production";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShowManagerConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid config. ${issues}`);
  }

  return {
    host: parsed.data.SHOW_MANAGER_HOST,
    port: parsed.data.SHOW_MANAGER_PORT,
    dataRoot: parsed.data.SHOW_MANAGER_DATA_ROOT,
    maxUploadBytes: parsed.data.SHOW_MANAGER_MAX_UPLOAD_BYTES,
    raspSshTarget: parsed.data.SHOW_MANAGER_RASP_SSH_TARGET,
    raspActiveRoot: parsed.data.SHOW_MANAGER_RASP_ACTIVE_ROOT,
    raspReleasesToKeep: parsed.data.SHOW_MANAGER_RASP_RELEASES_TO_KEEP,
    publicBaseUrl: parsed.data.SHOW_MANAGER_PUBLIC_BASE_URL,
    publicAccessHeader: parsed.data.SHOW_MANAGER_PUBLIC_ACCESS_HEADER.toLowerCase(),
    publicAccessValue: parsed.data.SHOW_MANAGER_PUBLIC_ACCESS_VALUE,
    sessionCookieName: parsed.data.SHOW_MANAGER_SESSION_COOKIE_NAME,
    nodeEnv: parsed.data.NODE_ENV,
  };
}
