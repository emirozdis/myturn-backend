import Link from "next/link";
import { getAdminOverview } from "@/lib/admin-data";
import { formatBytes, relativeTime } from "@/lib/admin-format";
import { PageHeader } from "@/app/admin/_components/admin-shell";

export const dynamic = "force-dynamic";

function MetricCard({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`metric-card ${tone || ""}`}><p>{label}</p><strong>{value}</strong><span>{note}</span></article>;
}

function BarChart({ data, accent = false }: { data: { label: string; count: number }[]; accent?: boolean }) {
  const maximum = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className={`bar-chart ${accent ? "bar-chart-accent" : ""}`} aria-label="Seven day activity chart">
      {data.map((item) => (
        <div className="bar-column" key={item.label}>
          <span className="bar-value">{item.count}</span>
          <div className="bar-track"><i style={{ height: `${Math.max(7, item.count / maximum * 100)}%` }} /></div>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const data = await getAdminOverview();
  const { metrics } = data;
  const healthyServices = data.services.filter((service) => service.status === "healthy").length;

  return (
    <>
      <PageHeader
        eyebrow="Live operations"
        title="Control center"
        description={`A current view of MyTurn. Refreshed ${relativeTime(data.generatedAt)}.`}
        action={<Link className="admin-primary-link" href="/admin/incidents">Review incidents <span>→</span></Link>}
      />

      <section className="metric-grid" aria-label="Key metrics">
        <MetricCard label="Total users" value={metrics.totalUsers.toLocaleString()} note={`${metrics.activeUsers.toLocaleString()} active in 30 days`} />
        <MetricCard label="Total storage" value={metrics.storage.available ? formatBytes(metrics.storage.bytes) : "Unavailable"} note={metrics.storage.available ? `${metrics.storage.objects.toLocaleString()} stored objects` : "Could not reach object storage"} />
        <MetricCard label="Vlogs uploaded" value={metrics.totalVlogs.toLocaleString()} note={`${metrics.vlogsToday.toLocaleString()} uploaded today`} />
        <MetricCard label="Open feedback" value={metrics.openFeedback.toLocaleString()} note="Open and in progress" tone={metrics.openFeedback ? "metric-attention" : ""} />
        <MetricCard label="Errors · 24h" value={metrics.errors24h.toLocaleString()} note="Server and client incidents" tone={metrics.errors24h ? "metric-danger" : ""} />
        <MetricCard label="Service health" value={`${healthyServices}/${data.services.length}`} note="Services reporting healthy" tone={healthyServices < data.services.length ? "metric-attention" : "metric-good"} />
      </section>

      <div className="admin-content-grid">
        <section className="admin-panel chart-panel">
          <div className="panel-heading"><div><p>Growth signal</p><h2>New users</h2></div><span>Last 7 days</span></div>
          <BarChart data={data.growth} />
        </section>
        <section className="admin-panel chart-panel">
          <div className="panel-heading"><div><p>Creation signal</p><h2>Vlog uploads</h2></div><span>Last 7 days</span></div>
          <BarChart data={data.uploads} accent />
        </section>
      </div>

      <div className="admin-content-grid admin-content-grid-wide">
        <section className="admin-panel">
          <div className="panel-heading"><div><p>Infrastructure</p><h2>Service health</h2></div><span>{healthyServices === data.services.length ? "All nominal" : "Needs attention"}</span></div>
          <div className="service-list">
            {data.services.map((service) => (
              <div className="service-row" key={service.name}>
                <i className={`status-dot status-${service.status}`} />
                <div><strong>{service.name}</strong><span>{service.detail}</span></div>
                <small>{service.latencyMs !== undefined ? `${service.latencyMs} ms` : service.status}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-panel">
          <div className="panel-heading"><div><p>Most recent</p><h2>Errors & warnings</h2></div><Link href="/admin/incidents">View all</Link></div>
          <div className="incident-list">
            {data.recentIncidents.length ? data.recentIncidents.map((incident) => (
              <Link href="/admin/incidents" className="incident-row" key={incident.id}>
                <span className={`severity-tag severity-${incident.level}`}>{incident.level}</span>
                <div><strong>{incident.event}</strong><small>{incident.errorMessage || incident.code || incident.route || "Operational event"}</small></div>
                <time>{relativeTime(incident.createdAt)}</time>
              </Link>
            )) : <div className="admin-empty compact">No recent incidents.</div>}
          </div>
        </section>
      </div>

      <div className="admin-content-grid admin-content-grid-wide">
        <section className="admin-panel">
          <div className="panel-heading"><div><p>User voice</p><h2>Latest feedback</h2></div><Link href="/admin/feedback">Open inbox</Link></div>
          <div className="feedback-mini-list">
            {data.recentFeedback.length ? data.recentFeedback.map((item) => (
              <div key={item.id}><span className={`feedback-category category-${item.category}`}>{item.category}</span><div><strong>{item.message}</strong><small>{item.user.name} · {relativeTime(item.createdAt)}</small></div></div>
            )) : <div className="admin-empty compact">No feedback has been submitted.</div>}
          </div>
        </section>
        <section className="admin-panel snapshot-panel">
          <div className="panel-heading"><div><p>Research</p><h2>Survey snapshot</h2></div><Link href="/admin/surveys">View surveys</Link></div>
          <div className="snapshot-numbers"><div><strong>{metrics.activeSurveys}</strong><span>Active surveys</span></div><div><strong>{metrics.surveyResponses.toLocaleString()}</strong><span>Total responses</span></div><div><strong>{metrics.suspendedUsers}</strong><span>Suspended users</span></div></div>
        </section>
      </div>
    </>
  );
}
