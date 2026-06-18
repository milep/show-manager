import type { ShowSettings } from "../../../shared/show-schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ShowSettingsFormProps {
  settings: ShowSettings;
  onChange: (settings: ShowSettings) => void;
}

export function ShowSettingsForm({ settings, onChange }: ShowSettingsFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Global controls for image duration and video loop count.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="image-duration">Image duration seconds</Label>
          <Input
            id="image-duration"
            type="number"
            inputMode="numeric"
            min={1}
            value={settings.imageDurationSeconds}
            onChange={(event) =>
              onChange({
                ...settings,
                imageDurationSeconds: Number(event.target.value),
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="video-loop-count">Video loop count</Label>
          <Input
            id="video-loop-count"
            type="number"
            inputMode="numeric"
            min={1}
            value={settings.videoLoopCount}
            onChange={(event) =>
              onChange({
                ...settings,
                videoLoopCount: Number(event.target.value),
              })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
