import type { LibraryState } from "../../../shared/show-schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MediaLibraryProps {
  library: LibraryState;
  onAdd: (mediaId: string) => void;
}

export function MediaLibrary({ library, onAdd }: MediaLibraryProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Library</CardTitle>
        <CardDescription>Uploaded media. Thumbnail-first selection. No deletion in v1.</CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
        <ScrollArea className="h-[65vh] pr-2 sm:h-[30rem] sm:pr-4">
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
            {library.items.map((item) => (
              <div key={item.id} className="space-y-3 rounded-lg border p-3 sm:p-4">
                <img src={item.thumbnailUrl} alt={item.originalFilename} className="aspect-video w-full rounded-md object-cover" loading="lazy" />
                <div className="space-y-1">
                  <div className="truncate text-sm font-medium">{item.originalFilename}</div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{item.kind}</Badge>
                    {item.durationSeconds ? <Badge variant="secondary">{item.durationSeconds.toFixed(1)}s</Badge> : null}
                    {item.width && item.height ? <Badge variant="secondary">{item.width}×{item.height}</Badge> : null}
                  </div>
                </div>
                <Button className="w-full" variant="outline" onClick={() => onAdd(item.id)}>
                  Add to playlist
                </Button>
              </div>
            ))}
            {library.items.length === 0 ? <div className="text-sm text-muted-foreground">No media yet.</div> : null}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
