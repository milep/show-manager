import type { DraftShow, LibraryState } from "../../../shared/show-schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Playlist is empty</EmptyTitle>
              <EmptyDescription>Add media from the library to build the active show.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="flex flex-col gap-3 md:hidden">
              {items.map(({ playlistItem, media }, index) => (
                <Card key={playlistItem.id}>
                  <CardContent className="flex flex-col gap-3 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="text-xs text-muted-foreground">Item {index + 1}</div>
                        <div className="truncate font-medium">{media?.originalFilename ?? playlistItem.sourceMediaId}</div>
                        <div className="text-sm text-muted-foreground">{media?.kind ?? "missing"}</div>
                      </div>
                      <Button size="sm" variant="destructive" onClick={() => onRemove(index)}>
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={() => onMove(index, -1)} disabled={index === 0}>
                        Move up
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onMove(index, 1)} disabled={index === items.length - 1}>
                        Move down
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => onMove(index, -1)} disabled={index === 0}>
                            Up
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onMove(index, 1)} disabled={index === items.length - 1}>
                            Down
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => onRemove(index)}>
                            Remove
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
