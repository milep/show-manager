import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <CardHeader>
        <CardTitle>Upload</CardTitle>
        <CardDescription>Images and videos land on godet. Thumbnails generate locally.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <Input ref={inputRef} type="file" accept="image/*,video/*" />
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          <Button className="w-full sm:w-auto" type="submit" disabled={busy}>{busy ? "Uploading" : "Upload media"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
