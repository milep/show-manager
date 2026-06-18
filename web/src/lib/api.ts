import type { ApiStatus, DraftShow, LibraryState, QrDisplayStatus } from "../../../shared/show-schema";

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

  return (await response.json()) as T;
}

export function fetchStatus() {
  return expectJson<ApiStatus>("/api/status");
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
