import type { ApiStatus, QrDisplayStatus } from "../../../shared/show-schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusCardProps {
  status: ApiStatus | null;
  saveState: "idle" | "saving" | "error";
  saveError: string | null;
  qrDisplay: QrDisplayStatus | null;
  qrBusy: boolean;
  qrError: string | null;
  onApply: () => void;
  onToggleQrDisplay: () => void;
}

export function StatusCard({ status, saveState, saveError, qrDisplay, qrBusy, qrError, onApply, onToggleQrDisplay }: StatusCardProps) {
  const remoteState = status?.remoteStatus.state ?? "unknown";

  return (
    <Card>
      <CardHeader className="grid-cols-1 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1">
          <CardTitle>Show Manager</CardTitle>
          <CardDescription>Single draft. Trusted tailnet. Public QR sessions.</CardDescription>
        </div>
        <CardAction className="col-auto row-auto w-full justify-self-auto sm:w-auto sm:justify-self-end">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button className="w-full sm:w-auto" variant={qrDisplay?.active ? "secondary" : "outline"} onClick={onToggleQrDisplay} disabled={qrBusy}>
              {qrBusy ? "Updating QR" : qrDisplay?.active ? "Hide login QR" : "Show login QR"}
            </Button>
            <Button className="w-full sm:w-auto" onClick={onApply} disabled={!status || status.applyInProgress}>
              {status?.applyInProgress ? "Applying" : "Apply to raspberrypi"}
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={saveState === "error" ? "destructive" : saveState === "saving" ? "secondary" : "default"}>
            {saveState === "saving" ? "Saving" : saveState === "error" ? "Save failed" : "Saved"}
          </Badge>
          <Badge variant={status?.isDirty ? "secondary" : "outline"}>{status?.isDirty ? "Unapplied" : "Applied"}</Badge>
          <Badge variant={remoteState === "running" ? "default" : remoteState === "error" ? "destructive" : "outline"}>
            Remote {remoteState}
          </Badge>
          {status?.applyInProgress ? <Badge variant="secondary">Apply running</Badge> : null}
          {qrDisplay?.active ? <Badge variant="secondary">QR login shown</Badge> : null}
        </div>
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <div>Draft hash: {status?.draftHash ?? "-"}</div>
          <div>Last applied hash: {status?.lastApplied?.draftHash ?? "-"}</div>
          <div>Last apply: {status?.lastApplied?.appliedAt ?? "-"}</div>
          <div>Release: {status?.remoteStatus.activeReleaseId ?? "-"}</div>
        </div>
        {qrDisplay?.active && qrDisplay.publicUrl ? (
          <Alert>
            <AlertTitle>Guest login QR is visible</AlertTitle>
            <AlertDescription className="break-all">{qrDisplay.publicUrl}</AlertDescription>
          </Alert>
        ) : null}
        {qrError ? (
          <Alert variant="destructive">
            <AlertTitle>QR error</AlertTitle>
            <AlertDescription>{qrError}</AlertDescription>
          </Alert>
        ) : null}
        {saveError ? (
          <Alert variant="destructive">
            <AlertTitle>Save failed</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
        {status?.lastApplied?.stderr ? (
          <Alert variant="destructive">
            <AlertTitle>Last apply error</AlertTitle>
            <AlertDescription>{status.lastApplied.stderr}</AlertDescription>
          </Alert>
        ) : null}
        <div className="text-xs text-muted-foreground lg:hidden">Use the section switcher below for controls, playlist, or library.</div>
      </CardContent>
    </Card>
  );
}
