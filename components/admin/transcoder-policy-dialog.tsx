"use client";

import { Cpu, Pencil, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useFormStatus } from "react-dom";
import { updateTranscoderSupervisorConfig } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export type TranscoderPolicyValue = {
  enabled: boolean;
  maxHourlyPrice: number;
  verifiedOnly: boolean;
  datacenterOnly: boolean;
  requireFullMachine: boolean;
  allowedGpuModels: string[];
  minimumGpuRamMb: number;
  minimumCpuCores: number;
  minimumRamMb: number;
  minimumReliability: number;
  minimumDownloadMbps: number;
  minimumUploadMbps: number;
  diskGb: number;
  offerSearchLimit: number;
  maxWorkers: number;
  jobsPerWorker: number;
  queueDepthPerNewWorker: number;
  idleTimeoutSeconds: number;
  idleAction: string;
  startupTimeoutSeconds: number;
  healthPollSeconds: number;
  maxInstanceFailures: number;
  maxMissionAttempts: number;
  missionTimeoutSeconds: number;
  vastTemplateHash: string;
  workerLogRetentionDays: number;
  policyVersion?: number;
};

function NumberField({ label, name, value, step = "1", hint }: { label: string; name: string; value: string | number; step?: string; hint?: string }) {
  return <label><span>{label}</span><input className="admin-form-input" name={name} type="number" step={step} defaultValue={String(value)} required />{hint ? <small>{hint}</small> : null}</label>;
}

function SavePolicyButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving policy…" : "Save worker policy"}</Button>;
}

function SummaryItem({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd>{note ? <small>{note}</small> : null}</div>;
}

export function TranscoderPolicyDialog({ policy }: { policy: TranscoderPolicyValue }) {
  const gpuSummary = policy.allowedGpuModels.length ? `${policy.allowedGpuModels.length} allowed models` : "Any GPU model";

  return (
    <section className="admin-panel transcoder-policy-summary" id="policy">
      <header className="transcoder-section-title">
        <div><p>Provisioning and scaling</p><h2>Worker policy</h2></div>
        <div className="transcoder-policy-heading-actions">
          <span>Version {policy.policyVersion ?? "not configured"}</span>
          <Dialog>
            <DialogTrigger asChild><Button type="button" variant="outline" size="sm"><Pencil aria-hidden="true" />Edit policy</Button></DialogTrigger>
            <DialogContent className="transcoder-policy-dialog sm:max-w-[1120px]">
              <DialogHeader>
                <DialogTitle>Edit worker policy</DialogTitle>
                <DialogDescription>Changes are durable and will be used by the supervisor on its next reconciliation cycle.</DialogDescription>
              </DialogHeader>
              <form action={updateTranscoderSupervisorConfig}>
                <div className="transcoder-checks">
                  <label><input name="enabled" type="checkbox" defaultChecked={policy.enabled} /><span><strong>Enable orchestration</strong><small>Allows worker startup and dispatch</small></span></label>
                  <label><input name="verifiedOnly" type="checkbox" defaultChecked={policy.verifiedOnly} /><span><strong>Verified hosts</strong><small>Require Vast verification</small></span></label>
                  <label><input name="datacenterOnly" type="checkbox" defaultChecked={policy.datacenterOnly} /><span><strong>Datacenter only</strong><small>Exclude residential hosts</small></span></label>
                  <label><input name="requireFullMachine" type="checkbox" defaultChecked={policy.requireFullMachine} /><span><strong>Full machine only</strong><small>Require full CPU and RAM allocation</small></span></label>
                </div>
                <div className="transcoder-policy-groups">
                  <fieldset>
                    <legend><Cpu aria-hidden="true" /><span>Template and hardware</span></legend>
                    <div className="transcoder-fields">
                      <label className="transcoder-wide"><span>Vast template hash</span><input className="admin-form-input" name="vastTemplateHash" defaultValue={policy.vastTemplateHash} required /><small>Hash ID for the private myturn-transcoder template</small></label>
                      <label className="transcoder-wide"><span>Allowed GPU models</span><input className="admin-form-input" name="allowedGpuModels" defaultValue={policy.allowedGpuModels.join(", ")} placeholder="Blank allows any model" /><small>Comma separated; names must match Vast exactly</small></label>
                      <NumberField label="Minimum GPU RAM" name="minimumGpuRamMb" value={policy.minimumGpuRamMb} hint="MB per GPU" />
                      <NumberField label="Minimum CPU cores" name="minimumCpuCores" value={policy.minimumCpuCores} />
                      <NumberField label="Minimum system RAM" name="minimumRamMb" value={policy.minimumRamMb} hint="MB allocated" />
                      <NumberField label="Disk size" name="diskGb" value={policy.diskGb} hint="GB per worker" />
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend><ShieldCheck aria-hidden="true" /><span>Offer quality and budget</span></legend>
                    <div className="transcoder-fields">
                      <NumberField label="Maximum hourly price" name="maxHourlyPrice" value={policy.maxHourlyPrice} step="0.01" hint="USD per worker" />
                      <NumberField label="Minimum reliability" name="minimumReliability" value={policy.minimumReliability} step="0.001" hint="0.98 = 98%" />
                      <NumberField label="Minimum download" name="minimumDownloadMbps" value={policy.minimumDownloadMbps} step="0.1" hint="Mbps" />
                      <NumberField label="Minimum upload" name="minimumUploadMbps" value={policy.minimumUploadMbps} step="0.1" hint="Mbps" />
                      <NumberField label="Offer search limit" name="offerSearchLimit" value={policy.offerSearchLimit} hint="Candidates per search" />
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend><SlidersHorizontal aria-hidden="true" /><span>Capacity and recovery</span></legend>
                    <div className="transcoder-fields">
                      <NumberField label="Maximum workers" name="maxWorkers" value={policy.maxWorkers} />
                      <NumberField label="Jobs per worker" name="jobsPerWorker" value={policy.jobsPerWorker} />
                      <NumberField label="Queue depth per new worker" name="queueDepthPerNewWorker" value={policy.queueDepthPerNewWorker} />
                      <NumberField label="Idle timeout" name="idleTimeoutSeconds" value={policy.idleTimeoutSeconds} hint="Seconds" />
                      <label><span>Idle action</span><select className="admin-form-input" name="idleAction" defaultValue={policy.idleAction}><option value="DESTROY">Destroy instance</option><option value="STOP">Stop instance</option></select><small>Applied after the idle timeout</small></label>
                      <NumberField label="Startup timeout" name="startupTimeoutSeconds" value={policy.startupTimeoutSeconds} hint="Seconds before replacement" />
                      <NumberField label="Health poll interval" name="healthPollSeconds" value={policy.healthPollSeconds} hint="Seconds" />
                      <NumberField label="Failures before replacement" name="maxInstanceFailures" value={policy.maxInstanceFailures} />
                      <NumberField label="Attempts per mission" name="maxMissionAttempts" value={policy.maxMissionAttempts} />
                      <NumberField label="Mission runtime timeout" name="missionTimeoutSeconds" value={policy.missionTimeoutSeconds} hint="Seconds before worker replacement" />
                      <NumberField label="Worker log retention" name="workerLogRetentionDays" value={policy.workerLogRetentionDays} hint="Days; 0 keeps indefinitely" />
                    </div>
                  </fieldset>
                </div>
                <DialogFooter className="transcoder-policy-dialog-footer">
                  <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                  <SavePolicyButton />
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <div className="transcoder-policy-overview">
        <dl><h3>State</h3><SummaryItem label="Orchestration" value={policy.enabled ? "Enabled" : "Paused"} note={`${policy.verifiedOnly ? "Verified" : "Any"} · ${policy.datacenterOnly ? "Datacenter" : "Any location"}`} /><SummaryItem label="Template" value={policy.vastTemplateHash ? `${policy.vastTemplateHash.slice(0, 12)}…` : "Not configured"} /></dl>
        <dl><h3>Hardware</h3><SummaryItem label="GPU selection" value={gpuSummary} note={`${Math.round(policy.minimumGpuRamMb / 1000)} GB minimum VRAM`} /><SummaryItem label="Host resources" value={`${policy.minimumCpuCores} CPU · ${Math.round(policy.minimumRamMb / 1000)} GB RAM`} note={policy.requireFullMachine ? "Full machine required" : "Shared machines allowed"} /></dl>
        <dl><h3>Capacity</h3><SummaryItem label="Workers and jobs" value={`${policy.maxWorkers} workers · ${policy.jobsPerWorker} jobs each`} note={`Scale at ${policy.queueDepthPerNewWorker} queued`} /><SummaryItem label="Idle behavior" value={`${policy.idleAction.toLowerCase()} after ${policy.idleTimeoutSeconds}s`} /></dl>
        <dl><h3>Limits and recovery</h3><SummaryItem label="Maximum price" value={`$${policy.maxHourlyPrice.toFixed(2)} / hour`} note={`${(policy.minimumReliability * 100).toFixed(1)}% minimum reliability`} /><SummaryItem label="Timeouts" value={`${policy.startupTimeoutSeconds}s startup · ${policy.missionTimeoutSeconds}s mission`} note={`${policy.maxMissionAttempts} mission attempts`} /></dl>
      </div>
    </section>
  );
}
