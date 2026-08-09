import { PageHeader, EmptyState } from "@/app/admin/_components/admin-shell";
import { getAuditLogs } from "@/lib/admin-data";
import { formatDate } from "@/lib/admin-format";
import { Badge } from "@/components/ui/badge";
import { DetailDialogRow, DetailGrid, DetailItem, DetailSection } from "@/components/admin/detail-dialog";
import { LogPagination, LogPageSizeSelect } from "@/components/admin/log-pagination";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ page?: string; pageSize?: string }> }) {
  const params = await searchParams;
  const { items: logs, total, page, pageSize } = await getAuditLogs({ page: Number(params.page), pageSize: Number(params.pageSize) });
  const pageHref = (nextPage: number) => `/admin/audit?${new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize) }).toString()}`;
  return (
    <>
      <PageHeader eyebrow="Security" title="Audit trail" description="A tamper-resistant record of sign-ins and every action taken in the admin area." />
      <section className="admin-panel table-panel">
        <form className="admin-toolbar" method="get"><LogPageSizeSelect name="pageSize" value={pageSize} /><button type="submit">Update view</button><small>{total.toLocaleString()} audit events</small></form>
        {logs.length ? <div className="admin-table-wrap"><table className="admin-table audit-table"><thead><tr><th>Action</th><th>Administrator</th><th>Target</th><th>IP address</th><th>Time</th><th><span className="sr-only">View</span></th></tr></thead><tbody>{logs.map((log) => <DetailDialogRow
          key={log.id}
          title={log.action}
          description={`Recorded ${formatDate(log.createdAt)}`}
          details={<>
            <div className="admin-detail-status-line"><Badge variant="outline">Audit event</Badge><span>{log.actorEmail}</span></div>
            <DetailSection title="Event"><DetailGrid>
              <DetailItem label="Audit ID">{log.id}</DetailItem><DetailItem label="Action">{log.action}</DetailItem>
              <DetailItem label="Administrator">{log.actorEmail}</DetailItem><DetailItem label="IP address">{log.ipAddress || "—"}</DetailItem>
              <DetailItem label="Target type">{log.targetType || "—"}</DetailItem><DetailItem label="Target ID">{log.targetId || "—"}</DetailItem>
              <DetailItem label="Created">{formatDate(log.createdAt)}</DetailItem>
            </DetailGrid></DetailSection>
            {log.details ? <DetailSection title="Recorded details"><pre className="admin-detail-code">{JSON.stringify(log.details, null, 2)}</pre></DetailSection> : null}
          </>}
        ><td><code>{log.action}</code></td><td>{log.actorEmail}</td><td>{log.targetType ? `${log.targetType} · ${log.targetId || "—"}` : "—"}</td><td>{log.ipAddress || "—"}</td><td>{formatDate(log.createdAt)}</td><td><span className="row-view-label">View</span></td></DetailDialogRow>)}</tbody></table></div> : <EmptyState>No administrator actions have been recorded yet.</EmptyState>}
        <LogPagination label="Audit trail" total={total} page={page} pageSize={pageSize} hrefForPage={pageHref} />
      </section>
    </>
  );
}
