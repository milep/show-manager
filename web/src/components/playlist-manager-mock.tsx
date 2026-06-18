import { useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialQueue = [
  { id: "mock-1", title: "Ocean drive sunset mix" },
  { id: "mock-2", title: "Board game night ambience" },
  { id: "mock-3", title: "Lo-fi kitchen station" },
];

type PlaylistManagerMockProps = {
  showBackLink: boolean;
};

export function PlaylistManagerMock({ showBackLink }: PlaylistManagerMockProps) {
  const [queue, setQueue] = useState(initialQueue);
  const [link, setLink] = useState("");
  const nextIdRef = useRef(initialQueue.length + 1);
  const nowPlaying = queue[0]?.title ?? "Nothing playing";
  const nextInQueue = queue.slice(1);

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = link.trim();
    if (!trimmed) {
      return;
    }
    const nextItem = { id: `mock-${nextIdRef.current}`, title: trimmed };
    nextIdRef.current += 1;
    setQueue((currentQueue) => [...currentQueue, nextItem]);
    setLink("");
  }

  function handleSkip() {
    setQueue((currentQueue) => currentQueue.slice(1));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Badge variant="secondary">Mock Chromecast playlist</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">Playlist Manager</h1>
          <p className="text-sm text-muted-foreground">Hello world mock for public QR navigation testing.</p>
        </div>
        {showBackLink ? (
          <Button asChild variant="outline">
            <a href="/">Show Manager</a>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Now playing</CardTitle>
          <CardDescription>This is separate from the raspberrypi display playlist.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border bg-background p-4">
            <div className="text-sm text-muted-foreground">Current item</div>
            <div className="mt-1 text-2xl font-semibold">{nowPlaying}</div>
          </div>
          <Button type="button" variant="secondary" onClick={handleSkip} disabled={queue.length === 0}>
            Skip to next
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add new video</CardTitle>
          <CardDescription>Paste a YouTube link or label.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleAdd}>
            <FieldGroup className="flex-1">
              <Field>
                <FieldLabel htmlFor="youtube-link">YouTube link</FieldLabel>
                <Input id="youtube-link" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://youtube.com/watch?v=..." />
              </Field>
            </FieldGroup>
            <Button className="self-end" type="submit">
              Add to queue
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Next in queue</CardTitle>
          <CardDescription>Mock items only.</CardDescription>
        </CardHeader>
        <CardContent>
          {nextInQueue.length ? (
            <ol className="flex list-decimal flex-col gap-2 pl-5">
              {nextInQueue.map((item) => (
                <li key={item.id} className="text-sm">
                  {item.title}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Queue is empty.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
