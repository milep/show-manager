import { z } from "zod";

export const MAX_UPLOAD_BYTES = 250_000_000;
export const RASP_ACTIVE_ROOT = "/home/pi/show-player";
export const RASP_RELEASES_TO_KEEP = 3;
export const PUBLIC_ACCESS_HEADER = "x-show-manager-access";
export const PUBLIC_ACCESS_VALUE = "public";
export const SESSION_COOKIE_NAME = "show_manager_session";
export const ADB_TV_TARGET = "192.168.68.104:5555";
export const YOUTUBE_TV_PACKAGE = "com.google.android.youtube.tv";

const DEFAULT_PUBLIC_BASE_URL = "https://show.miikaleppanen.com";

const configSchema = z.object({
  SHOW_MANAGER_HOST: z.string().ip().default("127.0.0.1"),
  SHOW_MANAGER_PORT: z.coerce.number().int().min(1).max(65535).default(4791),
  SHOW_MANAGER_DATA_ROOT: z.string().min(1).default("/home/devops/data/dev/show-manager"),
  SHOW_MANAGER_RASP_SSH_TARGET: z.string().min(1).default("rasp"),
  SHOW_MANAGER_PUBLIC_BASE_URL: z.string().url().default(DEFAULT_PUBLIC_BASE_URL),
  YOUTUBE_DATA_API_KEY: z.string().min(1).optional(),
});

export type ShowManagerConfig = {
  host: string;
  port: number;
  dataRoot: string;
  raspSshTarget: string;
  publicBaseUrl: string;
  youtubeDataApiKey: string | null;
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
    raspSshTarget: parsed.data.SHOW_MANAGER_RASP_SSH_TARGET,
    publicBaseUrl: parsed.data.SHOW_MANAGER_PUBLIC_BASE_URL,
    youtubeDataApiKey: parsed.data.YOUTUBE_DATA_API_KEY ?? null,
  };
}
