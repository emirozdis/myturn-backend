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

function field(label: string, name: string, value: string | number, step = "1") {
  return <label><span>{label}</span><input className="admin-form-input" name={name} type="number" step={step} defaultValue={String(value)} required /></label>;
}

export default async function TranscoderPage({ searchParams }: { searchParams: Promise<{ updated?: string; error?: string; logLevel?: string; logJob?: string; logInstance?: string; logFrom?: string; logTo?: string; logPage?: string }> }) {
  const params = await searchParams;
  const { config, instances, missions, events, counts, completed24h, failed24h, workerLogs, workerLogFilteredCount, workerLogPage, workerLogs24h, workerErrors24h } = await getTranscoderSupervisorOverview({ level: params.logLevel, jobId: params.logJob, instanceId: params.logInstance, from: params.logFrom, to: params.logTo, page: Number(params.logPage) || 0 });
  const policy = config ?? defaults;
  const total24h = completed24h + failed24h;
  const successRate = total24h ? `${((completed24h / total24h) * 100).toFixed(1)}%` : "—";
  const logPageHref = (page: number) => {
    const query = new URLSearchParams();
    const preserved: Record<string, string | undefined> = { logLevel: params.logLevel, logJob: params.logJob, logInstance: params.logInstance, logFrom: params.logFrom, logTo: params.logTo };
    for (const [key, value] of Object.entries(preserved)) if (value) query.set(key, value);
    query.set("logPage", String(page));
    return `/admin/transcoder?${query.toString()}`;
  };

  return <>
    <PageHeader eyebrow="Vast.ai orchestration" title="Transcoder control plane" description="Configure ordinary Vast instances, watch missions and workers, and inspect every orchestration decision." />
    {params.updated ? <div className="version-policy-success">Policy saved. The supervisor will use it on its next reconciliation cycle.</div> : null}
    {params.error ? <div className="admin-form-alert">A Vast template hash is required before orchestration can be enabled.</div> : null}

    <section className="transcoder-metrics">
      <article className="admin-panel"><span>Queued</span><strong>{counts.QUEUED ?? 0}</strong></article>
      <article className="admin-panel"><span>Active workers</span><strong>{instances.filter((item) => !item.terminatedAt).length}</strong></article>
      <article className="admin-panel"><span>Completed · 24h</span><strong>{completed24h}</strong></article>
      <article className="admin-panel"><span>Success rate · 24h</span><strong>{successRate}</strong></article>
      <article className="admin-panel"><span>Permanent failures · 24h</span><strong>{failed24h}</strong></article>
      <article className="admin-panel"><span>Worker logs · 24h</span><strong>{workerLogs24h}</strong></article>
      <article className="admin-panel"><span>Worker errors · 24h</span><strong>{workerErrors24h}</strong></article>
    </section>

    <section className="admin-panel transcoder-policy">
      <header><div><p>Provisioning and scaling</p><h2>Worker policy</h2></div><small>Policy version {config?.policyVersion ?? "not configured"}</small></header>
      <form action={updateTranscoderSupervisorConfig}>
        <div className="transcoder-checks">
          <label><input name="enabled" type="checkbox" defaultChecked={policy.enabled} />Enable orchestration</label>
          <label><input name="verifiedOnly" type="checkbox" defaultChecked={policy.verifiedOnly} />Verified hosts only</label>
          <label><input name="datacenterOnly" type="checkbox" defaultChecked={policy.datacenterOnly} />Datacenter hosts only</label>
          <label><input name="requireFullMachine" type="checkbox" defaultChecked={policy.requireFullMachine} />Full machine only</label>
        </div>
        <div className="transcoder-fields">
          <label className="transcoder-wide"><span>Vast template hash</span><input className="admin-form-input" name="vastTemplateHash" defaultValue={policy.vastTemplateHash} required /></label>
          <label className="transcoder-wide"><span>Allowed GPU models (comma separated, blank means any)</span><input className="admin-form-input" name="allowedGpuModels" defaultValue={policy.allowedGpuModels.join(", ")} /></label>
          {field("Maximum $ / hour", "maxHourlyPrice", Number(policy.maxHourlyPrice), "0.01")}
          {field("Minimum GPU RAM (MB)", "minimumGpuRamMb", policy.minimumGpuRamMb)}
          {field("Minimum CPU cores", "minimumCpuCores", policy.minimumCpuCores)}
          {field("Minimum system RAM (MB)", "minimumRamMb", policy.minimumRamMb)}
          {field("Minimum reliability", "minimumReliability", policy.minimumReliability, "0.001")}
          {field("Minimum download Mbps", "minimumDownloadMbps", policy.minimumDownloadMbps, "0.1")}
          {field("Minimum upload Mbps", "minimumUploadMbps", policy.minimumUploadMbps, "0.1")}
          {field("Disk size (GB)", "diskGb", policy.diskGb)}
          {field("Offer search limit", "offerSearchLimit", policy.offerSearchLimit)}
          {field("Maximum workers", "maxWorkers", policy.maxWorkers)}
          {field("Concurrent jobs per worker", "jobsPerWorker", policy.jobsPerWorker)}
          {field("Queued jobs required per new worker", "queueDepthPerNewWorker", policy.queueDepthPerNewWorker)}
          {field("Idle timeout (seconds)", "idleTimeoutSeconds", policy.idleTimeoutSeconds)}
          <label><span>Idle action</span><select className="admin-form-input" name="idleAction" defaultValue={policy.idleAction}><option value="DESTROY">Destroy</option><option value="STOP">Stop</option></select></label>
          {field("Startup timeout (seconds)", "startupTimeoutSeconds", policy.startupTimeoutSeconds)}
          {field("Health poll interval (seconds)", "healthPollSeconds", policy.healthPollSeconds)}
          {field("Failures before worker replacement", "maxInstanceFailures", policy.maxInstanceFailures)}
          {field("Attempts per mission", "maxMissionAttempts", policy.maxMissionAttempts)}
          {field("Worker log retention days (0 = indefinitely)", "workerLogRetentionDays", policy.workerLogRetentionDays)}
        </div>
        <footer><p>Full machine requires both allocated CPU and allocated RAM to match the host totals. GPU fraction and VM signals are also retained as classification evidence.</p><button type="submit">Save worker policy</button></footer>
      </form>
    </section>

    <section className="admin-panel table-panel">
      <div className="transcoder-section-title"><div><p>Durable worker output</p><h2>Transcoder logs</h2></div><small>{workerLogFilteredCount} matching · {policy.workerLogRetentionDays === 0 ? "retained indefinitely" : `retained ${policy.workerLogRetentionDays} days`}</small></div>
      <form className="admin-toolbar" method="get">
        <select name="logLevel" defaultValue={params.logLevel || "all"} aria-label="Worker log severity"><option value="all">All levels</option><option value="info">Info</option><option value="warn">Warnings</option><option value="error">Errors</option><option value="fatal">Fatal</option><option value="debug">Debug</option><option value="http">HTTP</option></select>
        <input name="logJob" defaultValue={params.logJob || ""} placeholder="Job ID" aria-label="Job ID" />
        <input name="logInstance" defaultValue={params.logInstance || ""} placeholder="Vast instance ID" aria-label="Vast instance ID" />
        <input name="logFrom" type="datetime-local" defaultValue={params.logFrom || ""} aria-label="Logs from, UTC" title="From time in UTC" />
        <input name="logTo" type="datetime-local" defaultValue={params.logTo || ""} aria-label="Logs until, UTC" title="Until time in UTC" />
        <button type="submit">Apply filters</button>
      </form>
      {workerLogs.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Level</th><th>Message</th><th>Job</th><th>Instance</th><th>Context</th><th>Occurred</th></tr></thead><tbody>{workerLogs.map((item) => <tr key={item.id}><td>{item.level}</td><td>{item.message}</td><td><code>{item.jobId ?? "—"}</code></td><td>{item.vastInstanceId ?? item.instanceLabel ?? "—"}</td><td><pre>{item.context ? JSON.stringify(item.context, null, 2) : "—"}</pre></td><td>{formatDate(item.occurredAt)}</td></tr>)}</tbody></table></div> : <EmptyState>No worker logs match these filters.</EmptyState>}
      {workerLogFilteredCount > 250 ? <nav className="transcoder-log-pagination" aria-label="Worker log pages">{workerLogPage > 0 ? <a href={logPageHref(workerLogPage - 1)}>Previous</a> : <span /> }<small>Page {workerLogPage + 1} of {Math.ceil(workerLogFilteredCount / 250)}</small>{(workerLogPage + 1) * 250 < workerLogFilteredCount ? <a href={logPageHref(workerLogPage + 1)}>Next</a> : <span />}</nav> : null}
    </section>

    <section className="admin-panel table-panel">
      <div className="transcoder-section-title"><div><p>Fleet</p><h2>Instances</h2></div><small>{instances.length} recorded</small></div>
      {instances.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Vast ID</th><th>State</th><th>Health</th><th>GPU</th><th>Full machine</th><th>Rate</th><th>Jobs</th><th>Heartbeat</th></tr></thead><tbody>{instances.map((item) => <tr key={item.id}><td>{item.vastInstanceId}</td><td>{item.state}</td><td>{item.healthStatus}</td><td>{item.gpuName ?? "—"}</td><td>{item.fullMachine ? "Yes" : "No"}</td><td>{item.hourlyPrice ? `$${item.hourlyPrice}/h` : "—"}</td><td>{item.successfulJobs} ok / {item.failedJobs} failed</td><td>{item.lastHeartbeatAt ? formatDate(item.lastHeartbeatAt) : "—"}</td></tr>)}</tbody></table></div> : <EmptyState>No instances have been provisioned.</EmptyState>}
    </section>

    <section className="admin-panel table-panel">
      <div className="transcoder-section-title"><div><p>Work queue</p><h2>Recent missions</h2></div><small>{missions.length} shown</small></div>
      {missions.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Mission</th><th>Type</th><th>Status</th><th>Attempts</th><th>Error</th><th>Registered</th></tr></thead><tbody>{missions.map((item) => <tr key={item.id}><td><code>{item.externalId}</code></td><td>{item.entityType}</td><td>{item.status}</td><td>{item.attempts}</td><td>{item.lastErrorCode ?? item.lastErrorMessage ?? "—"}</td><td>{formatDate(item.registeredAt)}</td></tr>)}</tbody></table></div> : <EmptyState>No missions registered.</EmptyState>}
    </section>

    <section className="admin-panel table-panel">
      <div className="transcoder-section-title"><div><p>Structured diagnostics</p><h2>Supervisor events</h2></div><small>{events.length} shown</small></div>
      {events.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Severity</th><th>Code</th><th>Message</th><th>Context</th><th>Time</th></tr></thead><tbody>{events.map((item) => <tr key={String(item.id)}><td>{item.severity}</td><td><code>{item.code}</code></td><td>{item.message}</td><td><pre>{item.context ? JSON.stringify(item.context, null, 2) : "—"}</pre></td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState>No supervisor events.</EmptyState>}
    </section>
  </>;
}
