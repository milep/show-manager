import { PauseIcon, PlayIcon, SearchIcon, SkipForwardIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { YoutubeQueueSnapshot, YoutubeSearchResult } from "../../../shared/show-schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { addYoutubeQueueItem, addYoutubeQueueItemNext, fetchYoutubeQueue, fetchYoutubeSearchSuggestions, pauseYoutubePlayback, playYoutubePlayback, searchYoutube, skipYoutubeQueue } from "@/lib/api";
import { cn } from "@/lib/utils";

type PlaylistManagerMockProps = {
  showBackLink: boolean;
};

type BusyAction = "search" | "add" | "next" | "pause" | "play" | "skip" | null;

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function searchTokens(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

function allTokensMatch(tokens: string[], value: string) {
  const normalized = normalizeSearchText(value);
  return tokens.length > 0 && tokens.every((token) => normalized.includes(token));
}

function hyphenTitleParts(title: string) {
  const parts = title.split(/\s[-–—]\s/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { artist: parts[0] ?? "", title: parts.slice(1).join(" - ") };
}

function officialScore(item: YoutubeSearchResult) {
  return /\bofficial\b/i.test(item.title) ? -0.5 : 0;
}

function relevanceScore(item: YoutubeSearchResult, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = searchTokens(query);
  const artist = item.artists[0] ?? "";
  const title = item.title;
  const parsed = hyphenTitleParts(title);
  if (!normalizedQuery) return 6;
  if (parsed && allTokensMatch(tokens, `${parsed.artist} ${parsed.title}`)) return 0 + officialScore(item);
  if (allTokensMatch(tokens, title)) return 1 + officialScore(item);
  if (allTokensMatch(tokens, `${artist} ${title}`)) return 2 + officialScore(item);
  const normalizedArtist = normalizeSearchText(artist);
  const normalizedTitle = normalizeSearchText(title);
  if (normalizedArtist === normalizedQuery) return 3;
  if (normalizedArtist.startsWith(normalizedQuery)) return 4;
  if (normalizedArtist.includes(normalizedQuery)) return 5;
  if (normalizedTitle === normalizedQuery) return 6 + officialScore(item);
  if (normalizedTitle.startsWith(normalizedQuery)) return 7 + officialScore(item);
  if (normalizedTitle.includes(normalizedQuery)) return 8 + officialScore(item);
  return 9;
}

function compareSearchResults(query: string) {
  return (left: YoutubeSearchResult, right: YoutubeSearchResult) => {
    if (left.kind !== right.kind) {
      return left.kind === "video" ? -1 : 1;
    }
    if (left.confirmed !== right.confirmed) {
      return left.confirmed ? -1 : 1;
    }
    const relevanceCompare = relevanceScore(left, query) - relevanceScore(right, query);
    if (relevanceCompare !== 0) return relevanceCompare;
    const officialCompare = officialScore(left) - officialScore(right);
    if (officialCompare !== 0) return officialCompare;
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
      {showBackLink ? (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <a href="/">Show Manager</a>
          </Button>
        </div>
      ) : null}

      {error ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
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

      {(selectedResults.length || results.length) ? (
        <Card>
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
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
                          <Badge variant={item.kind === "video" ? "default" : "secondary"}>{item.confirmed ? "Confirmed" : item.kind === "video" ? "Video" : "Song"}</Badge>
                          {item.duration ? <span className="text-xs text-muted-foreground">{item.duration}</span> : null}
                        </div>
                        <div className="line-clamp-3 break-words text-sm font-medium leading-snug">{item.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{item.artists[0]}</div>
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
          ) : null}
        </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">Now playing</div>
          <div className="mt-1 text-xl font-semibold">{nowPlaying ? queueTitle(nowPlaying) : snapshot?.playback.title ?? "Nothing playing"}</div>
          {snapshot?.playback.subtitle ? <div className="mt-1 text-sm text-muted-foreground">{snapshot.playback.subtitle}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 text-sm text-muted-foreground">Upcoming</div>
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
        <div className="mx-auto max-w-3xl">
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
