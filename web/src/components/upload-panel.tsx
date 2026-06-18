import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface UploadPanelProps {
  onUpload: (file: File) => Promise<void>;
}

export function UploadPanel({ onUpload }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose one file.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onUpload(file);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>Images and videos land on godet. Thumbnails generate locally.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="media-upload">Media file</FieldLabel>
              <Input id="media-upload" ref={inputRef} type="file" accept="image/*,video/*" aria-invalid={error ? true : undefined} />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="pt-4">
          <Button className="w-full sm:w-auto" type="submit" disabled={busy}>{busy ? "Uploading" : "Upload media"}</Button>
        </CardFooter>
      </form>
    </Card>
  );
}
