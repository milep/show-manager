type BrowserCrypto = Pick<Crypto, "getRandomValues" | "randomUUID">;

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function randomBase36(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(36).padStart(7, "0");
}

export function createPlaylistItemId(cryptoSource: BrowserCrypto | null | undefined = globalThis.crypto): string {
  if (typeof cryptoSource?.randomUUID === "function") {
    return cryptoSource.randomUUID();
  }

  if (typeof cryptoSource?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    return formatUuid(bytes);
  }

  return `playlist-${Date.now().toString(36)}-${randomBase36()}-${randomBase36()}`;
}
