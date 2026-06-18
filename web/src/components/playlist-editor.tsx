import type { DraftShow, LibraryState } from "../../../shared/show-schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PlaylistEditorProps {
  draft: DraftShow;
  library: LibraryState;
  onMove: (index: number, delta: number) => void;
  onRemove: (index: number) => void;
}

export function PlaylistEditor({ draft, library, onMove, onRemove }: PlaylistEditorProps) {
  const items = draft.playlist.map((item) => ({
    playlistItem: item,
    media: library.items.find((candidate) => candidate.id === item.sourceMediaId) ?? null,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Playlist</CardTitle>
        <CardDescription>Fixed order playback. Videos repeat during apply.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 md:hidden">
          {items.map(({ playlistItem, media }, index) => (
            <div key={playlistItem.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="text-xs text-muted-foreground">Item {index + 1}</div>
                  <div className="truncate font-medium">{media?.originalFilename ?? playlistItem.sourceMediaId}</div>
                  <div className="text-sm text-muted-foreground">{media?.kind ?? "missing"}</div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => onRemove(index)}>
                  Remove
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => onMove(index, -1)} disabled={index === 0}>
                  Move up
                </Button>
                <Button size="sm" variant="outline" onClick={() => onMove(index, 1)} disabled={index === items.length - 1}>
                  Move down
                </Button>
              </div>
            </div>
          ))}
          {items.length === 0 ? <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Playlist is empty.</div> : null}
        </div>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Media</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(({ playlistItem, media }, index) => (
                <TableRow key={playlistItem.id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>{media?.originalFilename ?? playlistItem.sourceMediaId}</TableCell>
                  <TableCell>{media?.kind ?? "missing"}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => onMove(index, -1)} disabled={index === 0}>
                      Up
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onMove(index, 1)} disabled={index === items.length - 1}>
                      Down
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => onRemove(index)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">Playlist is empty.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
