import { useEffect, useRef, useState } from "react";
import type { DraftShow } from "../../../shared/show-schema";
import { MediaLibrary } from "@/components/media-library";
import { PlaylistEditor } from "@/components/playlist-editor";
import { ShowSettingsForm } from "@/components/show-settings-form";
import { StatusCard } from "@/components/status-card";
import { UploadPanel } from "@/components/upload-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { applyShow, fetchShowManagerSnapshot, fetchStatus, saveShow, setQrDisplay, type ShowManagerSnapshot, uploadFile } from "@/lib/api";
import { createPlaylistItemId } from "@/lib/playlist-item-id";

type MobileSection = "controls" | "playlist" | "library";

type ShowManagerAppProps = {
  initialSnapshot: ShowManagerSnapshot;
};

export function ShowManagerApp({ initialSnapshot }: ShowManagerAppProps) {
  const [library, setLibrary] = useState(initialSnapshot.library);
  const [draft, setDraft] = useState<DraftShow>(initialSnapshot.show.draft);
  const [status, setStatus] = useState(initialSnapshot.status);
  const [qrDisplay, updateQrDisplay] = useState(initialSnapshot.qrDisplay);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>("playlist");
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function applySnapshot(snapshot: ShowManagerSnapshot) {
    setLibrary(snapshot.library);
    setDraft(snapshot.show.draft);
    setStatus(snapshot.status);
    updateQrDisplay(snapshot.qrDisplay);
  }

  async function refreshAll() {
    applySnapshot(await fetchShowManagerSnapshot());
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
      const nextQrDisplay = await setQrDisplay(!qrDisplay.active);
      updateQrDisplay(nextQrDisplay);
      const nextStatus = await fetchStatus();
      setStatus(nextStatus);
    } catch (error) {
      setQrError(error instanceof Error ? error.message : "QR update failed.");
    } finally {
      setQrBusy(false);
    }
  }

  function updateMobileSection(value: string) {
    if (value) {
      setMobileSection(value as MobileSection);
    }
  }

  const stats = [
    { label: "Playlist items", value: draft.playlist.length },
    { label: "Library items", value: library.items.length },
    { label: "Image duration", value: `${draft.settings.imageDurationSeconds}s` },
    { label: "Video loops", value: `${draft.settings.videoLoopCount}×` },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Show Manager</h1>
          <p className="text-sm text-muted-foreground">Raspberry Pi display playlist.</p>
        </div>
        <Button asChild variant="outline">
          <a href="/playlist-manager">Playlist Manager</a>
        </Button>
      </div>

      <StatusCard status={status} saveState={saveState} saveError={saveError} qrDisplay={qrDisplay} qrBusy={qrBusy} qrError={qrError} onApply={handleApply} onToggleQrDisplay={handleToggleQrDisplay} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex flex-col gap-1 p-3">
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-2xl font-semibold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="sticky top-0 z-10 -mx-3 border-y bg-background/95 px-3 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 lg:hidden">
        <ToggleGroup className="grid w-full grid-cols-3" type="single" value={mobileSection} onValueChange={updateMobileSection} variant="outline">
          <ToggleGroupItem value="controls">Controls</ToggleGroupItem>
          <ToggleGroupItem value="playlist">Playlist</ToggleGroupItem>
          <ToggleGroupItem value="library">Library</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="hidden gap-6 xl:grid xl:grid-cols-[20rem_1fr]">
        <div className="flex flex-col gap-6">
          <UploadPanel onUpload={handleUpload} />
          <ShowSettingsForm settings={draft.settings} onChange={(settings) => queueSave({ ...draft, settings })} />
        </div>
        <div className="flex flex-col gap-6">
          <PlaylistEditor draft={draft} library={library} onMove={handleMove} onRemove={handleRemove} />
          <MediaLibrary library={library} onAdd={handleAdd} />
        </div>
      </div>

      <div className="flex flex-col gap-4 xl:hidden">
        {mobileSection === "controls" ? (
          <div className="flex flex-col gap-4">
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
