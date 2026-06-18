import type { LibraryState } from "../../../shared/show-schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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
      <CardContent>
        {library.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No media yet</EmptyTitle>
              <EmptyDescription>Upload an image or video to start building the show.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="h-[65vh] pr-2 sm:h-[30rem] sm:pr-4">
            <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
              {library.items.map((item) => (
                <Card key={item.id} className="gap-3 overflow-hidden py-0">
                  <img src={item.thumbnailUrl} alt={item.originalFilename} className="aspect-video w-full object-cover" loading="lazy" />
                  <CardContent className="flex flex-col gap-2 px-3 sm:px-4">
                    <div className="truncate text-sm font-medium">{item.originalFilename}</div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{item.kind}</Badge>
                      {item.durationSeconds ? <Badge variant="secondary">{item.durationSeconds.toFixed(1)}s</Badge> : null}
                      {item.width && item.height ? <Badge variant="secondary">{item.width}×{item.height}</Badge> : null}
                    </div>
                  </CardContent>
                  <CardFooter className="px-3 pb-3 sm:px-4 sm:pb-4">
                    <Button className="w-full" variant="outline" onClick={() => onAdd(item.id)}>
                      Add to playlist
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
