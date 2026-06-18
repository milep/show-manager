import { useEffect, useState } from "react";
import type { AccessMode } from "../../shared/show-schema";
import { PlaylistManagerMock } from "@/components/playlist-manager-mock";
import { ShowManagerApp } from "@/components/show-manager-app";
import { Card, CardContent } from "@/components/ui/card";
import { fetchAccessMode, fetchShowManagerSnapshot, type ShowManagerSnapshot } from "@/lib/api";

const playlistManagerPath = "/playlist-manager";

export default function App() {
  const [routePath, setRoutePath] = useState(window.location.pathname);
  const [accessMode, setAccessMode] = useState<AccessMode | null>(null);
  const [showSnapshot, setShowSnapshot] = useState<ShowManagerSnapshot | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    try {
      const nextAccessMode = await fetchAccessMode();
      const nextRoutePath = nextAccessMode.access === "public" ? playlistManagerPath : window.location.pathname;
      if (nextRoutePath !== window.location.pathname) {
        window.history.replaceState(null, "", nextRoutePath);
      }
      if (nextAccessMode.access === "trusted" && nextRoutePath !== playlistManagerPath) {
        setShowSnapshot(await fetchShowManagerSnapshot());
      }
      setRoutePath(nextRoutePath);
      setAccessMode(nextAccessMode);
      setStartupError(null);
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : "Startup failed.");
    }
  }

  const showPlaylistManager = routePath === playlistManagerPath;

  if (!accessMode) {
    return <StartupStatus message={startupError ? "Startup failed." : "Loading access mode…"} detail={startupError} />;
  }

  if (showPlaylistManager || accessMode.access === "public") {
    return <PlaylistManagerMock showBackLink={accessMode.access === "trusted"} />;
  }

  if (!showSnapshot) {
    return <StartupStatus message="Loading show manager…" />;
  }

  return <ShowManagerApp initialSnapshot={showSnapshot} />;
}

type StartupStatusProps = {
  message: string;
  detail?: string | null;
};

function StartupStatus({ message, detail }: StartupStatusProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-8">
      <Card>
        <CardContent className="flex flex-col gap-2 p-6 text-sm text-muted-foreground">
          <div>{message}</div>
          {detail ? <div>{detail}</div> : null}
        </CardContent>
      </Card>
    </main>
  );
}
