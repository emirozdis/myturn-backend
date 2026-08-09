import { PageHeader, EmptyState } from "@/app/admin/_components/admin-shell";
import { getIncidents } from "@/lib/admin-data";
import { formatDate } from "@/lib/admin-format";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DetailDialogRow, DetailGrid, DetailItem, DetailSection } from "@/components/admin/detail-dialog";
import { LogPagination, LogPageSizeSelect } from "@/components/admin/log-pagination";

export const dynamic = "force-dynamic";

export default async function AdminIncidentsPage({ searchParams }: { searchParams: Promise<{ level?: string; source?: string; page?: string; pageSize?: string }> }) {
  const params = await searchParams;
  const level = ["all", "warn", "error", "fatal"].includes(params.level || "") ? params.level! : "all";
  const source = ["all", "server", "client"].includes(params.source || "") ? params.source! : "all";
  const { items: incidents, total, page, pageSize } = await getIncidents(level, source, { page: Number(params.page), pageSize: Number(params.pageSize) });
  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams({ level, source, page: String(nextPage), pageSize: String(pageSize) });
    return `/admin/incidents?${query.toString()}`;
  };

  return (
    <>
      <PageHeader eyebrow="Observability" title="Logs & errors" description="Inspect persisted server and client incidents with request and release context." />
      <section className="admin-panel table-panel">
        <form className="admin-toolbar" method="get"><select name="level" defaultValue={level} aria-label="Severity"><option value="all">All severities</option><option value="warn">Warnings</option><option value="error">Errors</option><option value="fatal">Fatal</option></select><select name="source" defaultValue={source} aria-label="Source"><option value="all">All sources</option><option value="server">Server</option><option value="client">Client</option></select><LogPageSizeSelect name="pageSize" value={pageSize} /><button type="submit">Apply filters</button><small>{total.toLocaleString()} matching incidents</small></form>
        {incidents.length ? <div className="admin-table-wrap"><table className="admin-table incident-table"><thead><tr><th>Severity</th><th>Event</th><th>Source</th><th>Route</th><th>Status</th><th>Time</th><th><span className="sr-only">View</span></th></tr></thead><tbody>{incidents.map((incident) => (
          <DetailDialogRow
            key={incident.id}
            title={incident.event}
            description={incident.errorMessage || incident.code || "Operational incident"}
            details={<>
              <div className="admin-detail-status-line"><Badge variant="outline">{incident.level}</Badge><span>{incident.source} · {formatDate(incident.createdAt)}</span></div>
              <DetailSection title="Request context"><DetailGrid>
                <DetailItem label="Incident ID">{incident.id}</DetailItem><DetailItem label="Code">{incident.code || "—"}</DetailItem>
                <DetailItem label="Route">{`${incident.method || ""} ${incident.route || "—"}`.trim()}</DetailItem><DetailItem label="HTTP status">{incident.status || "—"}</DetailItem>
                <DetailItem label="Request ID">{incident.requestId || incident.clientRequestId || "—"}</DetailItem><DetailItem label="Operation ID">{incident.operationId || "—"}</DetailItem>
                <DetailItem label="User ID">{incident.userId || incident.reportedUserId || "—"}</DetailItem><DetailItem label="Group ID">{incident.groupId || "—"}</DetailItem>
                <DetailItem label="Clip ID">{incident.clipId || "—"}</DetailItem><DetailItem label="Duration">{incident.durationMs !== null ? `${incident.durationMs} ms` : "—"}</DetailItem>
                <DetailItem label="Environment">{incident.environment}</DetailItem><DetailItem label="Release">{incident.release}</DetailItem>
              </DetailGrid></DetailSection>
              {incident.stack || incident.context ? <Separator /> : null}
              {incident.stack ? <DetailSection title="Stack trace"><pre className="admin-detail-code">{incident.stack.slice(0, 20_000)}</pre></DetailSection> : null}
              {incident.context ? <DetailSection title="Structured context"><pre className="admin-detail-code">{JSON.stringify(incident.context, null, 2).slice(0, 12_000)}</pre></DetailSection> : null}
            </>}
          >
            <td><span className={`severity-tag severity-${incident.level}`}>{incident.level}</span></td>
            <td><div className="table-primary-cell"><strong>{incident.event}</strong><small>{incident.errorMessage || incident.code || "Operational incident"}</small></div></td>
            <td>{incident.source}</td><td>{incident.route || "—"}</td><td>{incident.status || "—"}</td><td>{formatDate(incident.createdAt)}</td><td><span className="row-view-label">View</span></td>
          </DetailDialogRow>
        ))}</tbody></table></div> : <EmptyState>No incidents match these filters.</EmptyState>}
        <LogPagination label="Incident log" total={total} page={page} pageSize={pageSize} hrefForPage={pageHref} />
      </section>
    </>
  );
}
