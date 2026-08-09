import { Activity, Cpu, Database, Radio, Server, ShieldCheck, SlidersHorizontal, Timer, TriangleAlert, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader, EmptyState } from "@/app/admin/_components/admin-shell";
import { updateTranscoderSupervisorConfig } from "@/app/admin/actions";
import { getTranscoderSupervisorOverview } from "@/lib/admin-data";
import { formatDate } from "@/lib/admin-format";

export const dynamic = "force-dynamic";

const defaults = {
  enabled: true, maxHourlyPrice: 1.5, verifiedOnly: true, datacenterOnly: true,
  requireFullMachine: false, allowedGpuModels: [] as string[], minimumGpuRamMb: 16000,
  minimumCpuCores: 4, minimumRamMb: 16000, minimumReliability: 0.98,
  minimumDownloadMbps: 200, minimumUploadMbps: 100, diskGb: 20, offerSearchLimit: 100,
  maxWorkers: 1, jobsPerWorker: 1, queueDepthPerNewWorker: 1, idleTimeoutSeconds: 300,
  idleAction: "DESTROY", startupTimeoutSeconds: 600, healthPollSeconds: 5,
  maxInstanceFailures: 3, maxMissionAttempts: 3, vastTemplateHash: "",
  workerLogRetentionDays: 30,
};

function NumberField({ label, name, value, step = "1", hint }: { label: string; name: string; value: string | number; step?: string; hint?: string }) {
  return <label><span>{label}</span><input className="admin-form-input" name={name} type="number" step={step} defaultValue={String(value)} required />{hint ? <small>{hint}</small> : null}</label>;
}

function MetricCard({ label, value, note, tone, icon }: { label: string; value: string | number; note: string; tone?: string; icon: ReactNode }) {
  return <article className={`transcoder-metric ${tone || ""}`}><header>{icon}<span>{label}</span></header><strong>{value}</strong><small>{note}</small></article>;
}

function StateTag({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("healthy") || normalized.includes("succeed") || normalized.includes("completed") || normalized === "running"
    ? "good"
    : normalized.includes("fail") || normalized.includes("fatal") || normalized.includes("unhealthy") || normalized.includes("replac")
      ? "danger"
      : normalized.includes("queue") || normalized.includes("start") || normalized.includes("provision") || normalized.includes("dispatch") || normalized.includes("process")
        ? "active"
        : "neutral";
  return <span className={`transcoder-state transcoder-state-${tone}`}>{value.replaceAll("_", " ")}</span>;
}

export default async function TranscoderPage({ searchParams }: { searchParams: Promise<{ updated?: string; error?: string; logLevel?: string; logJob?: string; logInstance?: string; logFrom?: string; logTo?: string; logPage?: string }> }) {
  const params = await searchParams;
  const data = await getTranscoderSupervisorOverview({
    level: params.logLevel,
    jobId: params.logJob,
    instanceId: params.logInstance,
    from: params.logFrom,
    to: params.logTo,
    page: Number(params.logPage) || 0,
  });
  const { config, instances, missions, events, counts, completed24h, failed24h, workerLogs, workerLogFilteredCount, workerLogPage, workerLogs24h, workerErrors24h, supervisorHealth } = data;
  const policy = config ?? defaults;
  const total24h = completed24h + failed24h;
  const successRate = total24h ? `${((completed24h / total24h) * 100).toFixed(1)}%` : "—";
  const runningWorkers = instances.filter((item) => item.state === "RUNNING").length;
  const healthyWorkers = instances.filter((item) => item.healthStatus === "HEALTHY" && item.state === "RUNNING").length;
  const statusTitle = supervisorHealth.status === "healthy" ? "Supervisor connected" : supervisorHealth.status === "degraded" ? "Supervisor needs attention" : supervisorHealth.status === "unconfigured" ? "Supervisor not configured" : "Supervisor unreachable";
  const logPageHref = (page: number) => {
    const query = new URLSearchParams();
    const preserved: Record<string, string | undefined> = { logLevel: params.logLevel, logJob: params.logJob, logInstance: params.logInstance, logFrom: params.logFrom, logTo: params.logTo };
    for (const [key, value] of Object.entries(preserved)) if (value) query.set(key, value);
    query.set("logPage", String(page));
    return `/admin/transcoder?${query.toString()}`;
  };

  return <>
    <PageHeader
      eyebrow="Vast.ai orchestration"
      title="Transcoder control plane"
      description="Fleet health, mission flow, capacity rules, and durable worker diagnostics in one operational view."
      action={<nav className="transcoder-jump-nav" aria-label="Transcoder sections"><a href="#fleet">Fleet</a><a href="#missions">Missions</a><a href="#logs">Logs</a><a href="#policy">Policy</a></nav>}
    />

    {params.updated ? <div className="version-policy-success" role="status">Policy saved. The supervisor will use it on its next reconciliation cycle.</div> : null}
    {params.error ? <div className="admin-form-alert" role="alert">A Vast template hash is required before orchestration can be enabled.</div> : null}

    <section className={`transcoder-connection transcoder-connection-${supervisorHealth.status}`} aria-labelledby="supervisor-status-title">
      <div className="transcoder-connection-main">
        <span className="transcoder-connection-icon"><Radio aria-hidden="true" /></span>
        <div>
          <p>Control-plane connection</p>
          <h2 id="supervisor-status-title">{statusTitle}</h2>
          <span>{supervisorHealth.detail}</span>
          <code>{supervisorHealth.endpoint ?? "TRANSCODER_SUPERVISOR_URL is not set"}</code>
        </div>
      </div>
      <dl className="transcoder-connection-facts">
        <div><dt>API status</dt><dd><i className={`status-dot status-${supervisorHealth.status}`} />{supervisorHealth.httpStatus ? `HTTP ${supervisorHealth.httpStatus}` : supervisorHealth.status}</dd></div>
        <div><dt>Latency</dt><dd>{supervisorHealth.latencyMs !== undefined ? `${supervisorHealth.latencyMs} ms` : "—"}</dd></div>
        <div><dt>Database</dt><dd><Database aria-hidden="true" />{supervisorHealth.database ?? "Unknown"}</dd></div>
        <div><dt>Policy</dt><dd>{supervisorHealth.policyConfigured === undefined ? "Unknown" : supervisorHealth.policyConfigured ? "Configured" : "Missing"}</dd></div>
      </dl>
      <aside className={`transcoder-orchestration-switch ${policy.enabled ? "is-enabled" : "is-paused"}`}>
        <span>{policy.enabled ? "Enabled" : "Paused"}</span>
        <strong>Orchestration</strong>
        <p>{policy.enabled ? "New missions may rent capacity and dispatch work." : "Missions remain durable; no new work will be dispatched."}</p>
        <small>Checked {formatDate(supervisorHealth.checkedAt)}</small>
      </aside>
    </section>

    <section className="transcoder-metrics" aria-label="Transcoder operating metrics">
      <MetricCard label="Queued missions" value={counts.QUEUED ?? 0} note="Waiting for capacity" tone={(counts.QUEUED ?? 0) > 0 ? "metric-active" : ""} icon={<Workflow aria-hidden="true" />} />
      <MetricCard label="Healthy workers" value={`${healthyWorkers}/${runningWorkers}`} note={`${instances.filter((item) => !item.terminatedAt).length} managed records`} tone={runningWorkers > healthyWorkers ? "metric-warning" : ""} icon={<Server aria-hidden="true" />} />
      <MetricCard label="Completed · 24h" value={completed24h.toLocaleString()} note={`${total24h.toLocaleString()} terminal missions`} icon={<Activity aria-hidden="true" />} />
      <MetricCard label="Success rate · 24h" value={successRate} note={total24h ? "Completed versus permanent failures" : "No terminal missions yet"} icon={<ShieldCheck aria-hidden="true" />} />
      <MetricCard label="Worker errors · 24h" value={workerErrors24h.toLocaleString()} note={`${workerLogs24h.toLocaleString()} total worker logs`} tone={workerErrors24h ? "metric-danger" : ""} icon={<TriangleAlert aria-hidden="true" />} />
      <MetricCard label="Idle policy" value={`${policy.idleTimeoutSeconds}s`} note={`${policy.idleAction.toLowerCase()} inactive workers`} icon={<Timer aria-hidden="true" />} />
    </section>

    <div className="transcoder-data-grid">
      <section className="admin-panel transcoder-data-panel" id="fleet">
        <header className="transcoder-section-title"><div><p>Managed capacity</p><h2>Fleet</h2></div><span>{runningWorkers} running · {instances.length} recorded</span></header>
        {instances.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Vast ID</th><th>Lifecycle</th><th>Health</th><th>GPU</th><th>Machine</th><th>Rate</th><th>Jobs</th><th>Heartbeat</th></tr></thead><tbody>{instances.map((item) => <tr key={item.id}><td><code>{item.vastInstanceId}</code></td><td><StateTag value={item.state} /></td><td><StateTag value={item.healthStatus} /></td><td>{item.gpuName ?? "—"}</td><td>{item.fullMachine ? "Full" : "Shared"}</td><td>{item.hourlyPrice ? `$${item.hourlyPrice}/h` : "—"}</td><td>{item.successfulJobs} ok · {item.failedJobs} failed</td><td>{item.lastHeartbeatAt ? formatDate(item.lastHeartbeatAt) : "—"}</td></tr>)}</tbody></table></div> : <EmptyState>No instances have been provisioned. The first queued mission will start capacity when orchestration is enabled.</EmptyState>}
      </section>

      <section className="admin-panel transcoder-data-panel" id="missions">
        <header className="transcoder-section-title"><div><p>Durable work queue</p><h2>Recent missions</h2></div><span>{missions.length} shown</span></header>
        {missions.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Mission</th><th>Type</th><th>Status</th><th>Attempts</th><th>Last error</th><th>Registered</th></tr></thead><tbody>{missions.map((item) => <tr key={item.id}><td><code>{item.externalId}</code></td><td>{item.entityType}</td><td><StateTag value={item.status} /></td><td>{item.attempts}</td><td className="transcoder-error-cell">{item.lastErrorCode ?? item.lastErrorMessage ?? "—"}</td><td>{formatDate(item.registeredAt)}</td></tr>)}</tbody></table></div> : <EmptyState>No missions have been registered.</EmptyState>}
      </section>
    </div>

    <section className="admin-panel transcoder-log-panel" id="logs">
      <header className="transcoder-section-title"><div><p>Durable worker output</p><h2>Transcoder logs</h2></div><span>{workerLogFilteredCount.toLocaleString()} matching · {policy.workerLogRetentionDays === 0 ? "retained indefinitely" : `${policy.workerLogRetentionDays} day retention`}</span></header>
      <form className="admin-toolbar transcoder-log-toolbar" method="get">
        <select name="logLevel" defaultValue={params.logLevel || "all"} aria-label="Worker log severity"><option value="all">All levels</option><option value="info">Info</option><option value="warn">Warnings</option><option value="error">Errors</option><option value="fatal">Fatal</option><option value="debug">Debug</option><option value="http">HTTP</option></select>
        <input name="logJob" defaultValue={params.logJob || ""} placeholder="Job ID" aria-label="Job ID" />
        <input name="logInstance" defaultValue={params.logInstance || ""} placeholder="Vast instance ID" aria-label="Vast instance ID" />
        <label><span>From · UTC</span><input name="logFrom" type="datetime-local" defaultValue={params.logFrom || ""} aria-label="Logs from, UTC" /></label>
        <label><span>Until · UTC</span><input name="logTo" type="datetime-local" defaultValue={params.logTo || ""} aria-label="Logs until, UTC" /></label>
        <button type="submit">Apply filters</button>
        {(params.logLevel || params.logJob || params.logInstance || params.logFrom || params.logTo) ? <a href="/admin/transcoder#logs">Clear</a> : null}
      </form>
      {workerLogs.length ? <div className="admin-table-wrap"><table className="admin-table transcoder-log-table"><thead><tr><th>Level</th><th>Message</th><th>Job</th><th>Instance</th><th>Context</th><th>Occurred</th></tr></thead><tbody>{workerLogs.map((item) => <tr key={item.id}><td><StateTag value={item.level} /></td><td className="transcoder-message-cell">{item.message}</td><td><code>{item.jobId ?? "—"}</code></td><td>{item.vastInstanceId ?? item.instanceLabel ?? "—"}</td><td>{item.context ? <details className="transcoder-context"><summary>Inspect</summary><pre>{JSON.stringify(item.context, null, 2)}</pre></details> : "—"}</td><td>{formatDate(item.occurredAt)}</td></tr>)}</tbody></table></div> : <EmptyState>No worker logs match these filters.</EmptyState>}
      {workerLogFilteredCount > 250 ? <nav className="transcoder-log-pagination" aria-label="Worker log pages">{workerLogPage > 0 ? <a href={logPageHref(workerLogPage - 1)}>Previous</a> : <span /> }<small>Page {workerLogPage + 1} of {Math.ceil(workerLogFilteredCount / 250)}</small>{(workerLogPage + 1) * 250 < workerLogFilteredCount ? <a href={logPageHref(workerLogPage + 1)}>Next</a> : <span />}</nav> : null}
    </section>

    <details className="admin-panel transcoder-policy" id="policy" open>
      <summary><span><SlidersHorizontal aria-hidden="true" /><span><small>Provisioning and scaling</small><strong>Worker policy</strong></span></span><span>Version {config?.policyVersion ?? "not configured"} · click to collapse</span></summary>
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
              <NumberField label="Maximum hourly price" name="maxHourlyPrice" value={Number(policy.maxHourlyPrice)} step="0.01" hint="USD per worker" />
              <NumberField label="Minimum reliability" name="minimumReliability" value={policy.minimumReliability} step="0.001" hint="0.98 = 98%" />
              <NumberField label="Minimum download" name="minimumDownloadMbps" value={policy.minimumDownloadMbps} step="0.1" hint="Mbps" />
              <NumberField label="Minimum upload" name="minimumUploadMbps" value={policy.minimumUploadMbps} step="0.1" hint="Mbps" />
              <NumberField label="Offer search limit" name="offerSearchLimit" value={policy.offerSearchLimit} hint="Candidates per search" />
            </div>
          </fieldset>

          <fieldset>
            <legend><SettingsIcon /><span>Capacity and recovery</span></legend>
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
              <NumberField label="Worker log retention" name="workerLogRetentionDays" value={policy.workerLogRetentionDays} hint="Days; 0 keeps indefinitely" />
            </div>
          </fieldset>
        </div>
        <footer><p>Changes are durable and picked up on the supervisor’s next reconciliation cycle. Full-machine classification requires full CPU, RAM, GPU allocation, and a non-VM host signal.</p><button type="submit">Save worker policy</button></footer>
      </form>
    </details>

    <section className="admin-panel transcoder-event-panel" id="events">
      <header className="transcoder-section-title"><div><p>Structured diagnostics</p><h2>Supervisor events</h2></div><span>{events.length} most recent</span></header>
      {events.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Severity</th><th>Code</th><th>Message</th><th>Context</th><th>Time</th></tr></thead><tbody>{events.map((item) => <tr key={String(item.id)}><td><StateTag value={item.severity} /></td><td><code>{item.code}</code></td><td className="transcoder-message-cell">{item.message}</td><td>{item.context ? <details className="transcoder-context"><summary>Inspect</summary><pre>{JSON.stringify(item.context, null, 2)}</pre></details> : "—"}</td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState>No supervisor events have been recorded.</EmptyState>}
    </section>
  </>;
}

function SettingsIcon() {
  return <SlidersHorizontal aria-hidden="true" />;
}
