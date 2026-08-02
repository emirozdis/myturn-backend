"use client";

import * as React from "react";
import { ArrowLeftIcon, ShieldAlertIcon, SlidersHorizontalIcon } from "lucide-react";

import { updateAppVersionRequirement, type VersionRequirementActionState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type VersionRequirementValue = {
  minimumVersion: string;
  minimumBuildNumber: number;
  updateUrl: string;
};

const emptyRequirement: VersionRequirementValue = {
  minimumVersion: "1.0.0",
  minimumBuildNumber: 1,
  updateUrl: "",
};

export function VersionRequirementDialog({
  platform,
  releaseChannel,
  requirement,
}: {
  platform: "ios" | "android";
  releaseChannel: "development" | "preview" | "production";
  requirement: VersionRequirementValue | null;
}) {
  const initial = requirement ?? emptyRequirement;
  const [open, setOpen] = React.useState(false);
  const [reviewing, setReviewing] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [minimumVersion, setMinimumVersion] = React.useState(initial.minimumVersion);
  const [minimumBuildNumber, setMinimumBuildNumber] = React.useState(String(initial.minimumBuildNumber));
  const [updateUrl, setUpdateUrl] = React.useState(initial.updateUrl);
  const [state, formAction, pending] = React.useActionState<VersionRequirementActionState, FormData>(
    updateAppVersionRequirement,
    {},
  );

  const platformLabel = platform === "ios" ? "iOS" : "Android";
  const policyLabel = `${platformLabel} · ${releaseChannel}`;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setReviewing(false);
      setAcknowledged(false);
      setMinimumVersion(initial.minimumVersion);
      setMinimumBuildNumber(String(initial.minimumBuildNumber));
      setUpdateUrl(initial.updateUrl);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm"><SlidersHorizontalIcon />Edit policy</Button>
      </DialogTrigger>
      <DialogContent className="version-policy-dialog sm:max-w-[580px]">
        <DialogHeader>
          <div className="admin-confirm-icon"><SlidersHorizontalIcon /></div>
          <DialogTitle>{reviewing ? "Confirm version requirement" : `Edit ${policyLabel}`}</DialogTitle>
          <DialogDescription>{reviewing
            ? "Review the launch requirement carefully. Saving immediately changes the response returned to this client audience."
            : "Clients below either minimum will be required to update when they next perform the launch check."}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="version-policy-form">
          <input type="hidden" name="platform" value={platform} />
          <input type="hidden" name="releaseChannel" value={releaseChannel} />
          <input type="hidden" name="minimumVersion" value={minimumVersion} />
          <input type="hidden" name="minimumBuildNumber" value={minimumBuildNumber} />
          <input type="hidden" name="updateUrl" value={updateUrl} />
          <input type="hidden" name="confirmation" value={reviewing && acknowledged ? "CONFIRM" : ""} />

          {state.error ? <div className="admin-form-alert" role="alert">{state.error}</div> : null}

          {reviewing ? (
            <div className="version-policy-review">
              <div className="version-policy-warning"><ShieldAlertIcon /><p><strong>{releaseChannel === "production" ? "Production launch wall" : "Client launch wall"}</strong><span>Any client below version {minimumVersion} or build {minimumBuildNumber} will receive an update-required response.</span></p></div>
              <dl>
                <div><dt>Audience</dt><dd>{policyLabel}</dd></div>
                <div><dt>Minimum version</dt><dd>{initial.minimumVersion} → {minimumVersion}</dd></div>
                <div><dt>Minimum build</dt><dd>{initial.minimumBuildNumber} → {minimumBuildNumber}</dd></div>
                <div><dt>Update URL</dt><dd>{updateUrl}</dd></div>
              </dl>
              <label className="admin-confirm-check">
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>I understand that this can prevent older app builds from proceeding past launch.</span>
              </label>
            </div>
          ) : (
            <div className="version-policy-fields">
              <label><span>Minimum app version</span><input value={minimumVersion} onChange={(event) => setMinimumVersion(event.target.value)} placeholder="1.4.0" required /></label>
              <label><span>Minimum native build</span><input type="number" min={0} max={2147483647} step={1} value={minimumBuildNumber} onChange={(event) => setMinimumBuildNumber(event.target.value)} required /></label>
              <label className="version-policy-wide"><span>HTTPS update URL</span><input type="url" value={updateUrl} onChange={(event) => setUpdateUrl(event.target.value)} placeholder={platform === "ios" ? "https://apps.apple.com/app/id…" : "https://play.google.com/store/apps/details?id=…"} required /></label>
              <p className="admin-detail-note version-policy-wide">The semantic version and native build are both enforced. A client must satisfy both values.</p>
            </div>
          )}

          <DialogFooter className="version-policy-footer">
            {reviewing ? <Button type="button" variant="outline" onClick={() => { setReviewing(false); setAcknowledged(false); }}><ArrowLeftIcon />Back</Button> : <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>}
            {reviewing
              ? <Button type="submit" disabled={!acknowledged || pending}>{pending ? "Saving…" : "Confirm and save"}</Button>
              : <Button type="button" onClick={() => setReviewing(true)} disabled={!minimumVersion.trim() || !minimumBuildNumber.trim() || !updateUrl.trim()}>Review change</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
