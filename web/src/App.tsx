import { useEffect, useRef, useState } from "react";
import { defaultDraftShow, type ApiStatus, type DraftShow, type LibraryState, type QrDisplayStatus } from "../../shared/show-schema";
import { MediaLibrary } from "@/components/media-library";
import { PlaylistEditor } from "@/components/playlist-editor";
import { ShowSettingsForm } from "@/components/show-settings-form";
import { StatusCard } from "@/components/status-card";
import { UploadPanel } from "@/components/upload-panel";
import { applyShow, fetchLibrary, fetchQrDisplay, fetchShow, fetchStatus, saveShow, setQrDisplay, uploadFile } from "@/lib/api";
import { createPlaylistItemId } from "@/lib/playlist-item-id";

const emptyLibrary: LibraryState = { items: [] };

type MobileSection = "controls" | "playlist" | "library";

export default function App() {
  const [library, setLibrary] = useState<LibraryState>(emptyLibrary);
  const [draft, setDraft] = useState<DraftShow>(defaultDraftShow);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [qrDisplay, updateQrDisplay] = useState<QrDisplayStatus | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>("playlist");
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void refreshAll();
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  async function refreshAll() {
    const [nextLibrary, nextShow, nextStatus, nextQrDisplay] = await Promise.all([fetchLibrary(), fetchShow(), fetchStatus(), fetchQrDisplay()]);
    setLibrary(nextLibrary);
    setDraft(nextShow.draft);
    setStatus(nextStatus);
    updateQrDisplay(nextQrDisplay);
  }

  function queueSave(nextDraft: DraftShow) {
    setDraft(nextDraft);
    setSaveState("saving");
    setSaveError(null);
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void persistDraft(nextDraft);
    }, 250);
  }

  async function persistDraft(nextDraft: DraftShow) {
    try {
      const saved = await saveShow(nextDraft);
      const nextStatus = await fetchStatus();
      setDraft(saved.draft);
      setStatus(nextStatus);
      setSaveState("idle");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Save failed.");
    }
  }

  async function handleUpload(file: File) {
    await uploadFile(file);
    await refreshAll();
  }

  function handleAdd(mediaId: string) {
    queueSave({
      ...draft,
      playlist: [
        ...draft.playlist,
        { id: createPlaylistItemId(), sourceMediaId: mediaId },
      ],
    });
  }

  function handleMove(index: number, delta: number) {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= draft.playlist.length) {
      return;
    }
    const nextPlaylist = [...draft.playlist];
    const [moved] = nextPlaylist.splice(index, 1);
    if (!moved) {
      return;
    }
    nextPlaylist.splice(targetIndex, 0, moved);
    queueSave({ ...draft, playlist: nextPlaylist });
  }

  function handleRemove(index: number) {
    queueSave({
      ...draft,
      playlist: draft.playlist.filter((_, candidateIndex) => candidateIndex !== index),
    });
  }

  async function handleApply() {
    const nextStatus = await applyShow();
    setStatus(nextStatus);
  }

  async function handleToggleQrDisplay() {
    setQrBusy(true);
    setQrError(null);
    try {
      const nextQrDisplay = await setQrDisplay(!(qrDisplay?.active ?? false));
      updateQrDisplay(nextQrDisplay);
      const nextStatus = await fetchStatus();
      setStatus(nextStatus);
    } catch (error) {
      setQrError(error instanceof Error ? error.message : "QR update failed.");
    } finally {
      setQrBusy(false);
    }
  }

  const playlistCount = draft.playlist.length;
  const libraryCount = library.items.length;

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-8">
      <StatusCard status={status} saveState={saveState} saveError={saveError} qrDisplay={qrDisplay} qrBusy={qrBusy} qrError={qrError} onApply={handleApply} onToggleQrDisplay={handleToggleQrDisplay} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Playlist items</div>
          <div className="text-2xl font-semibold">{playlistCount}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Library items</div>
          <div className="text-2xl font-semibold">{libraryCount}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Image duration</div>
          <div className="text-2xl font-semibold">{draft.settings.imageDurationSeconds}s</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Video loops</div>
          <div className="text-2xl font-semibold">{draft.settings.videoLoopCount}×</div>
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-3 border-y bg-background/95 px-3 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 lg:hidden">
        <div className="grid grid-cols-3 gap-2">
          <button
            className={`rounded-md border px-3 py-2 text-sm font-medium ${mobileSection === "controls" ? "bg-primary text-primary-foreground" : "bg-card"}`}
            onClick={() => setMobileSection("controls")}
            type="button"
          >
            Controls
          </button>
          <button
            className={`rounded-md border px-3 py-2 text-sm font-medium ${mobileSection === "playlist" ? "bg-primary text-primary-foreground" : "bg-card"}`}
            onClick={() => setMobileSection("playlist")}
            type="button"
          >
            Playlist
          </button>
          <button
            className={`rounded-md border px-3 py-2 text-sm font-medium ${mobileSection === "library" ? "bg-primary text-primary-foreground" : "bg-card"}`}
            onClick={() => setMobileSection("library")}
            type="button"
          >
            Library
          </button>
        </div>
      </div>

      <div className="hidden gap-6 xl:grid xl:grid-cols-[20rem_1fr]">
        <div className="space-y-6">
          <UploadPanel onUpload={handleUpload} />
          <ShowSettingsForm settings={draft.settings} onChange={(settings) => queueSave({ ...draft, settings })} />
        </div>
        <div className="space-y-6">
          <PlaylistEditor draft={draft} library={library} onMove={handleMove} onRemove={handleRemove} />
          <MediaLibrary library={library} onAdd={handleAdd} />
        </div>
      </div>

      <div className="space-y-4 xl:hidden">
        {mobileSection === "controls" ? (
          <div className="space-y-4">
            <UploadPanel onUpload={handleUpload} />
            <ShowSettingsForm settings={draft.settings} onChange={(settings) => queueSave({ ...draft, settings })} />
          </div>
        ) : null}
        {mobileSection === "playlist" ? <PlaylistEditor draft={draft} library={library} onMove={handleMove} onRemove={handleRemove} /> : null}
        {mobileSection === "library" ? <MediaLibrary library={library} onAdd={handleAdd} /> : null}
      </div>
    </main>
  );
}
