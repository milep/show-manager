import type { AccessMode, ApiStatus, DraftShow, LibraryState, PippalotAddResponse, QrDisplayStatus, YoutubeQueueSnapshot, YoutubeSearchResponse, YoutubeSearchResult, YoutubeSearchSuggestionsResponse } from "../../../shared/show-schema";

export type ShowManagerSnapshot = {
  library: LibraryState;
  show: { draft: DraftShow; draftHash: string; isDirty: boolean };
  status: ApiStatus;
  qrDisplay: QrDisplayStatus;
};

async function expectJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Ignore parse failure.
    }
    throw new Error(message);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Expected JSON response from API.");
  }
}

export function fetchStatus() {
  return expectJson<ApiStatus>("/api/status");
}

export function fetchAccessMode() {
  return expectJson<AccessMode>("/api/auth/access");
}

export function fetchLibrary() {
  return expectJson<LibraryState>("/api/library");
}

export function fetchShow() {
  return expectJson<{ draft: DraftShow; draftHash: string; isDirty: boolean }>("/api/show");
}

export function fetchQrDisplay() {
  return expectJson<QrDisplayStatus>("/api/auth/qr-display");
}

export async function fetchShowManagerSnapshot(): Promise<ShowManagerSnapshot> {
  const [library, show, status, qrDisplay] = await Promise.all([fetchLibrary(), fetchShow(), fetchStatus(), fetchQrDisplay()]);
  return { library, show, status, qrDisplay };
}

export function setQrDisplay(active: boolean) {
  return expectJson<QrDisplayStatus>("/api/auth/qr-display", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ active }),
  });
}

export function saveShow(draft: DraftShow) {
  return expectJson<{ draft: DraftShow; draftHash: string; isDirty: boolean }>("/api/show", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(draft),
  });
}

export function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return expectJson<{ item: LibraryState["items"][number] }>("/api/library/upload", {
    method: "POST",
    body: formData,
  });
}

export function applyShow() {
  return expectJson<ApiStatus>("/api/show/apply", {
    method: "POST",
  });
}

export function toggleTvPower() {
  return expectJson<{ ok: true }>("/api/tv/power-toggle", {
    method: "POST",
  });
}

export function fetchYoutubeQueue() {
  return expectJson<YoutubeQueueSnapshot>("/api/youtube-queue");
}

export function searchYoutube(query: string) {
  return expectJson<YoutubeSearchResponse>(`/api/youtube/search?q=${encodeURIComponent(query)}`);
}

export function fetchYoutubeSearchSuggestions(query: string) {
  return expectJson<YoutubeSearchSuggestionsResponse>(`/api/youtube/search-suggestions?q=${encodeURIComponent(query)}`);
}

export function addYoutubeQueueItem(item: YoutubeSearchResult) {
  return expectJson<YoutubeQueueSnapshot>("/api/youtube-queue/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
}

export function addYoutubeQueueItemNext(item: YoutubeSearchResult) {
  return expectJson<YoutubeQueueSnapshot>("/api/youtube-queue/items/next", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
}

export function removeYoutubeQueueItem(id: string) {
  return expectJson<YoutubeQueueSnapshot>(`/api/youtube-queue/items/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function moveYoutubeQueueItem(id: string, direction: "up" | "down") {
  return expectJson<YoutubeQueueSnapshot>(`/api/youtube-queue/items/${encodeURIComponent(id)}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ direction }),
  });
}

export function skipYoutubeQueue() {
  return expectJson<YoutubeQueueSnapshot>("/api/youtube-queue/skip", { method: "POST" });
}

export function pauseYoutubePlayback() {
  return expectJson<YoutubeQueueSnapshot>("/api/youtube-playback/pause", { method: "POST" });
}

export function playYoutubePlayback() {
  return expectJson<YoutubeQueueSnapshot>("/api/youtube-playback/play", { method: "POST" });
}

export function startYoutubeRadio() {
  return expectJson<{ queued: number }>("/api/youtube-queue/radio", { method: "POST" });
}

export function addToPippalot(url: string) {
  return expectJson<PippalotAddResponse>("/api/youtube/playlists/pippalot/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function startPippalot() {
  return expectJson<{ queued: number }>("/api/youtube-queue/pippalot", { method: "POST" });
}

export function clearYoutubeQueue() {
  return expectJson<YoutubeQueueSnapshot>("/api/youtube-queue/clear", { method: "POST" });
}
