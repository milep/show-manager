import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { ShowManagerConfig } from "../config.js";
import type { DataRootPaths } from "./data-root.js";

const SESSION_HOURS = 24;

const sessionSchema = z.object({
  id: z.string().min(1),
  hash: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

const authStateSchema = z.object({
  activeQr: z
    .object({
      tokenHash: z.string().min(1),
      publicUrl: z.string().url(),
      createdAt: z.string().datetime(),
    })
    .nullable(),
  sessions: z.array(sessionSchema),
});

export type AuthState = z.infer<typeof authStateSchema>;

const emptyState: AuthState = { activeQr: null, sessions: [] };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

const QR_TOKEN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

function randomQrToken(length = 12) {
  const bytes = randomBytes(length);
  let token = "";
  for (const byte of bytes) {
    token += QR_TOKEN_ALPHABET[byte % QR_TOKEN_ALPHABET.length];
  }
  return token;
}

function sessionExpiresAt(now = new Date()) {
  return new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
}

export class AuthService {
  private writeQueue = Promise.resolve();

  constructor(
    private readonly config: ShowManagerConfig,
    private readonly paths: DataRootPaths,
  ) {}

  private async loadState(): Promise<AuthState> {
    try {
      const raw = await readFile(this.paths.authStateFile, "utf8");
      const parsed = authStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? this.pruneExpired(parsed.data) : emptyState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyState;
      }
      throw error;
    }
  }

  private pruneExpired(state: AuthState, now = new Date()): AuthState {
    return {
      activeQr: state.activeQr,
      sessions: state.sessions.filter((session) => Date.parse(session.expiresAt) > now.getTime()),
    };
  }

  private async saveState(state: AuthState) {
    await writeFile(this.paths.authStateFile, `${JSON.stringify(this.pruneExpired(state), null, 2)}\n`, "utf8");
  }

  private async updateState<T>(mutate: (state: AuthState) => T | Promise<T>): Promise<T> {
    const run = async () => {
      const state = await this.loadState();
      const result = await mutate(state);
      await this.saveState(state);
      return result;
    };
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async getQrStatus() {
    const state = await this.loadState();
    return { active: state.activeQr !== null, publicUrl: state.activeQr?.publicUrl ?? null };
  }

  async enableQr() {
    return this.updateState((state) => {
      const token = randomQrToken();
      const publicUrl = `${this.config.publicBaseUrl.toUpperCase()}/Q/${token}`;
      state.activeQr = { tokenHash: sha256(token), publicUrl, createdAt: new Date().toISOString() };
      return { publicUrl };
    });
  }

  async disableQr() {
    await this.updateState((state) => {
      state.activeQr = null;
    });
  }

  async createSessionFromQrToken(token: string) {
    return this.updateState((state) => {
      const tokenHash = sha256(token);
      if (!state.activeQr || !safeEqual(tokenHash, state.activeQr.tokenHash)) {
        return null;
      }
      const sessionToken = randomToken(32);
      const session = {
        id: randomBytes(8).toString("hex"),
        hash: sha256(sessionToken),
        createdAt: new Date().toISOString(),
        expiresAt: sessionExpiresAt(),
      };
      state.sessions.push(session);
      return { token: sessionToken, expiresAt: session.expiresAt };
    });
  }

  async isValidSession(token: string | null | undefined) {
    if (!token) {
      return false;
    }
    const state = await this.loadState();
    const hash = sha256(token);
    return state.sessions.some((session) => safeEqual(hash, session.hash));
  }
}

export function parseCookie(header: string | undefined, name: string) {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}
