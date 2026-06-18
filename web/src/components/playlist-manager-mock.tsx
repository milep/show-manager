import { PauseIcon, PlayIcon, SearchIcon, SkipForwardIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { YoutubeQueueSnapshot, YoutubeSearchResult } from "../../../shared/show-schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { addYoutubeQueueItem, addYoutubeQueueItemNext, fetchYoutubeQueue, fetchYoutubeSearchSuggestions, pauseYoutubePlayback, playYoutubePlayback, searchYoutube, skipYoutubeQueue } from "@/lib/api";
import { cn } from "@/lib/utils";

type PlaylistManagerMockProps = {
  showBackLink: boolean;
};

type BusyAction = "search" | "add" | "next" | "pause" | "play" | "skip" | null;

function itemTitle(item: YoutubeSearchResult) {
  return [item.artists[0], item.title].filter(Boolean).join(" - ");
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function relevanceScore(item: YoutubeSearchResult, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const artist = (item.artists[0] ?? "").toLocaleLowerCase();
  const title = item.title.toLocaleLowerCase();
  if (!normalizedQuery) return 6;
  if (artist === normalizedQuery) return 0;
  if (artist.startsWith(normalizedQuery)) return 1;
  if (artist.includes(normalizedQuery)) return 2;
  if (title === normalizedQuery) return 3;
  if (title.startsWith(normalizedQuery)) return 4;
  if (title.includes(normalizedQuery)) return 5;
  return 6;
}

function compareSearchResults(query: string) {
  return (left: YoutubeSearchResult, right: YoutubeSearchResult) => {
    const relevanceCompare = relevanceScore(left, query) - relevanceScore(right, query);
    if (relevanceCompare !== 0) return relevanceCompare;
    if (left.kind !== right.kind) {
      return left.kind === "video" ? -1 : 1;
    }
    const artistCompare = compareText(left.artists[0] ?? "", right.artists[0] ?? "");
    if (artistCompare !== 0) return artistCompare;
    return compareText(left.title, right.title);
  };
}

function firstThumbnail(item: YoutubeSearchResult) {
  return item.thumbnails[0] ?? null;
}

function queueTitle(item: YoutubeQueueSnapshot["queue"]["items"][number]) {
  return [item.artist ?? item.channel, item.title ?? item.videoId].filter(Boolean).join(" - ");
}

export function PlaylistManagerMock({ showBackLink }: PlaylistManagerMockProps) {
  const [snapshot, setSnapshot] = useState<YoutubeQueueSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [results, setResults] = useState<YoutubeSearchResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const suggestionsTokenRef = useRef(0);

  useEffect(() => {
    void refreshQueue();
    const interval = window.setInterval(() => void refreshQueue(false), 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!suggestionsOpen || trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    const token = suggestionsTokenRef.current + 1;
    suggestionsTokenRef.current = token;
    const timer = window.setTimeout(() => {
      void loadSuggestions(trimmed, token);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, suggestionsOpen]);

  const selectedResults = useMemo(() => results.filter((item) => selectedIds.has(item.videoId)), [results, selectedIds]);
  const nowPlaying = snapshot?.queue.items.find((item) => item.id === snapshot.queue.currentItemId) ?? null;
  const upcomingItems = snapshot?.queue.items.filter((item) => item.id !== snapshot.queue.currentItemId) ?? [];
  const isPaused = snapshot?.playback.state === "paused";
  const isPlaying = snapshot?.playback.state === "playing" || snapshot?.playback.state === "buffering";

  async function refreshQueue(showErrors = true) {
    try {
      setSnapshot(await fetchYoutubeQueue());
      if (showErrors) setError(null);
    } catch (caught) {
      if (showErrors) setError(caught instanceof Error ? caught.message : "Queue refresh failed.");
    }
  }

  async function loadSuggestions(value: string, token: number) {
    try {
      const response = await fetchYoutubeSearchSuggestions(value);
      if (suggestionsOpen && suggestionsTokenRef.current === token) setSuggestions(response.suggestions.slice(0, 6));
    } catch {
      setSuggestions([]);
    }
  }

  async function performSearch(value = query) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusyAction("search");
    setError(null);
    try {
      suggestionsTokenRef.current += 1;
      setSuggestionsOpen(false);
      setSuggestions([]);
      const response = await searchYoutube(trimmed);
      setResults([...response.results].sort(compareSearchResults(trimmed)));
      setSelectedIds(new Set());
      setQuery(trimmed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setBusyAction(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void performSearch();
  }

  function toggleSelected(videoId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  }

  async function addItems(items: YoutubeSearchResult[], placement: "end" | "next") {
    if (!items.length) return;
    setBusyAction(placement === "next" ? "next" : "add");
    setError(null);
    try {
      let nextSnapshot: YoutubeQueueSnapshot | null = null;
      for (const item of items) {
        nextSnapshot = placement === "next" ? await addYoutubeQueueItemNext(item) : await addYoutubeQueueItem(item);
      }
      if (nextSnapshot) setSnapshot(nextSnapshot);
      setSelectedIds(new Set());
      clearSearchAndFocus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Add failed.");
    } finally {
      setBusyAction(null);
    }
  }

  function clearSearchAndFocus() {
    setQuery("");
    suggestionsTokenRef.current += 1;
    setSuggestions([]);
    setSuggestionsOpen(false);
    setResults([]);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  async function runControl(action: Exclude<BusyAction, "search" | "add" | "next" | null>) {
    setBusyAction(action);
    setError(null);
    try {
      if (action === "pause") setSnapshot(await pauseYoutubePlayback());
      if (action === "play") setSnapshot(await playYoutubePlayback());
      if (action === "skip") setSnapshot(await skipYoutubeQueue());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Playback control failed.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-3 pb-28 pt-4 sm:px-4 sm:pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Badge variant="secondary">Party playlist</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">Playlist Manager</h1>
          <p className="text-sm text-muted-foreground">Search YouTube Music and add songs or videos.</p>
        </div>
        {showBackLink ? (
          <Button asChild variant="outline">
            <a href="/">Show Manager</a>
          </Button>
        ) : null}
      </div>

      {error ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>Suggestions autocomplete text. Search results are playable.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="youtube-search">YouTube search</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    ref={searchInputRef}
                    id="youtube-search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSuggestionsOpen(true);
                    }}
                    onFocus={() => setSuggestionsOpen(true)}
                    placeholder="Search songs or videos"
                    autoComplete="off"
                  />
                  <Button type="submit" disabled={busyAction === "search"}>
                    <SearchIcon data-icon="inline-start" />
                    Search
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </form>
          {suggestions.length ? (
            <div className="flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <Button key={suggestion} type="button" variant="outline" className="justify-start" onClick={() => void performSearch(suggestion)}>
                  {suggestion}
                </Button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
          <CardDescription>Select multiple items to add them to the end.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {selectedResults.length ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="text-sm text-muted-foreground">{selectedResults.length} selected</div>
              <div className="flex gap-2">
                <Button type="button" className="flex-1" onClick={() => void addItems(selectedResults, "end")} disabled={busyAction === "add"}>
                  Add selected to end
                </Button>
                {selectedResults.length === 1 ? (
                  <Button type="button" className="flex-1" variant="secondary" onClick={() => void addItems(selectedResults, "next")} disabled={busyAction === "next"}>
                    Play selected next
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {results.length ? (
            <div className="flex flex-col gap-2">
              {results.map((item) => {
                const checked = selectedIds.has(item.videoId);
                const thumb = firstThumbnail(item);
                return (
                  <div key={`${item.kind}-${item.videoId}`} className={cn("flex gap-2 rounded-lg border p-2", checked && "bg-muted/50")}>
                    <div className="flex pt-2">
                      <Checkbox checked={checked} onCheckedChange={() => toggleSelected(item.videoId)} aria-label={`Select ${item.title}`} />
                    </div>
                    {thumb ? <img src={thumb} alt="" className="size-12 rounded object-cover" /> : null}
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <button type="button" className="flex min-w-0 flex-col gap-1 text-left" onClick={() => void addItems([item], "end")}>
                        <div className="flex items-center gap-2">
                          <Badge variant={item.kind === "song" ? "default" : "secondary"}>{item.kind === "song" ? "Song" : "Video"}</Badge>
                          {item.duration ? <span className="text-xs text-muted-foreground">{item.duration}</span> : null}
                        </div>
                        <div className="truncate text-sm font-medium">{itemTitle(item)}</div>
                        {item.album ? <div className="truncate text-xs text-muted-foreground">{item.album}</div> : null}
                      </button>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" className="h-8" onClick={() => void addItems([item], "end")} disabled={busyAction === "add"}>
                          Add
                        </Button>
                        <Button type="button" size="sm" className="h-8" variant="secondary" onClick={() => void addItems([item], "next")} disabled={busyAction === "next"}>
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No search results yet</EmptyTitle>
                <EmptyDescription>Search for a song or video to add it.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Now playing</CardTitle>
          <CardDescription>{snapshot?.playback.state ?? "unknown"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="rounded-lg border bg-background p-4">
            <div className="text-sm text-muted-foreground">Current item</div>
            <div className="mt-1 text-xl font-semibold">{nowPlaying ? queueTitle(nowPlaying) : snapshot?.playback.title ?? "Nothing from party list"}</div>
            {snapshot?.playback.subtitle ? <div className="mt-1 text-sm text-muted-foreground">{snapshot.playback.subtitle}</div> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming</CardTitle>
          <CardDescription>{upcomingItems.length} item{upcomingItems.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingItems.length ? (
            <ol className="flex list-decimal flex-col gap-2 pl-5">
              {upcomingItems.map((item) => (
                <li key={item.id} className="text-sm">
                  <div className="font-medium">{queueTitle(item)}</div>
                  {item.album ? <div className="text-xs text-muted-foreground">{item.album}</div> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Queue is empty.</p>
          )}
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{isPlaying ? "Playing" : isPaused ? "Paused" : "Ready"}</span>
            <span>{snapshot?.playback.title ?? "No playback"}</span>
          </div>
          <Separator />
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="secondary" onClick={() => void runControl("play")} disabled={busyAction === "play"}>
              <PlayIcon data-icon="inline-start" />
              Play
            </Button>
            <Button type="button" variant="secondary" onClick={() => void runControl("pause")} disabled={busyAction === "pause"}>
              <PauseIcon data-icon="inline-start" />
              Pause
            </Button>
            <Button type="button" variant="secondary" onClick={() => void runControl("skip")} disabled={busyAction === "skip"}>
              <SkipForwardIcon data-icon="inline-start" />
              Skip
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
