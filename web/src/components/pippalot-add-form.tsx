import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { addToPippalot } from "@/lib/api";

type SubmissionStatus = {
  kind: "success" | "duplicate" | "error";
  message: string;
};

export function PippalotAddForm() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SubmissionStatus | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || busy) return;

    setBusy(true);
    setStatus(null);
    try {
      const result = await addToPippalot(url);
      if (result.outcome === "duplicate") {
        setStatus({ kind: "duplicate", message: "This video is already saved in Pippalot." });
        return;
      }
      setUrl("");
      setStatus({ kind: "success", message: "Added to Pippalot." });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Adding to Pippalot failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  const invalid = status?.kind === "error";

  return (
    <form onSubmit={handleSubmit}>
      <Card className="gap-0 py-0 sm:grid sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
        <CardHeader className="px-4 pt-4 sm:py-4 sm:pr-0">
          <CardTitle>
            <FieldLabel htmlFor="pippalot-youtube-link">Add to Pippalot</FieldLabel>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <FieldGroup className="gap-3">
            <Field data-invalid={invalid ? true : undefined}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="pippalot-youtube-link"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setStatus(null);
                  }}
                  inputMode="url"
                  autoComplete="off"
                  placeholder="YouTube URL"
                  aria-invalid={invalid ? true : undefined}
                  disabled={busy}
                />
                <Button type="submit" disabled={busy || !url.trim()}>
                  {busy ? "Adding…" : "Add"}
                </Button>
              </div>
              {invalid ? <FieldError>{status?.message}</FieldError> : null}
              {status && !invalid ? <FieldDescription role="status">{status.message}</FieldDescription> : null}
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </form>
  );
}
