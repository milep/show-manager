import { describe, expect, it } from "vitest";
import { createPlaylistItemId } from "../web/src/lib/playlist-item-id";

describe("createPlaylistItemId", () => {
  it("uses randomUUID when available", () => {
    const id = createPlaylistItemId({
      randomUUID: () => "uuid-1",
      getRandomValues: ((array: Uint8Array) => array) as Crypto["getRandomValues"],
    });

    expect(id).toBe("uuid-1");
  });

  it("falls back to getRandomValues on insecure HTTP origins", () => {
    const id = createPlaylistItemId({
      randomUUID: undefined as unknown as Crypto["randomUUID"],
      getRandomValues: ((array: Uint8Array) => {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = index;
        }
        return array;
      }) as Crypto["getRandomValues"],
    });

    expect(id).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("falls back without Web Crypto", () => {
    expect(createPlaylistItemId(null)).toMatch(/^playlist-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
  });
});
