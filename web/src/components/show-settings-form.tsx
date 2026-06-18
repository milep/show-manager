import type { ShowSettings } from "../../../shared/show-schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
      <CardContent>
        <FieldGroup className="sm:grid sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="image-duration">Image duration seconds</FieldLabel>
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
          </Field>
          <Field>
            <FieldLabel htmlFor="video-loop-count">Video loop count</FieldLabel>
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
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
