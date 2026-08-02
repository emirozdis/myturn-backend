import { PageHeader, EmptyState } from "@/app/admin/_components/admin-shell";
import { updateFeedbackStatus } from "@/app/admin/actions";
import { getFeedback } from "@/lib/admin-data";
import { formatDate } from "@/lib/admin-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DetailDialogCard, DetailGrid, DetailItem, DetailSection } from "@/components/admin/detail-dialog";

export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const status = ["all", "open", "in_progress", "resolved", "closed"].includes(params.status || "") ? params.status! : "all";
  const feedback = await getFeedback(status);

  return (
    <>
      <PageHeader eyebrow="User voice" title="Feedback inbox" description="Triage bug reports and ideas with the attached diagnostic context." />
      <section className="admin-panel table-panel">
        <form className="admin-toolbar" method="get"><select name="status" defaultValue={status} aria-label="Feedback status"><option value="all">All feedback</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><button type="submit">Apply filter</button><small>{feedback.length} result{feedback.length === 1 ? "" : "s"}</small></form>
        {feedback.length ? <div className="feedback-inbox">{feedback.map((item) => (
          <DetailDialogCard
            className="feedback-card"
            key={item.id}
            title={`${item.category.charAt(0).toUpperCase()}${item.category.slice(1)} feedback`}
            description={`Submitted by ${item.user.name} on ${formatDate(item.createdAt)}`}
            details={<>
              <div className="admin-detail-status-line"><Badge variant="outline">{item.category}</Badge><Badge variant="secondary">{item.status.replace("_", " ")}</Badge></div>
              <DetailSection title="Message"><p className="admin-detail-message">{item.message}</p></DetailSection>
              <Separator />
              <DetailSection title="Submission"><DetailGrid>
                <DetailItem label="Report ID">{item.id}</DetailItem><DetailItem label="User">{item.user.name}</DetailItem>
                <DetailItem label="Email">{item.user.email}</DetailItem><DetailItem label="Handle">{item.user.handle ? `@${item.user.handle}` : "—"}</DetailItem>
                <DetailItem label="Screen">{item.screen || "—"}</DetailItem><DetailItem label="App version">{item.appVersion || "—"}</DetailItem>
                <DetailItem label="Created">{formatDate(item.createdAt)}</DetailItem><DetailItem label="Updated">{formatDate(item.updatedAt)}</DetailItem>
                <DetailItem label="Attachments" wide>{[item.includedScreenshot && "Screenshot", item.includedLogs && "Logs", item.includedDeviceInfo && "Device information"].filter(Boolean).join(", ") || "None"}</DetailItem>
              </DetailGrid></DetailSection>
              {item.logs || item.deviceInfo ? <Separator /> : null}
              {item.logs ? <DetailSection title="Submitted logs"><pre className="admin-detail-code">{item.logs.slice(0, 12_000)}</pre></DetailSection> : null}
              {item.deviceInfo ? <DetailSection title="Device information"><pre className="admin-detail-code">{item.deviceInfo.slice(0, 6_000)}</pre></DetailSection> : null}
              <Separator />
              <DetailSection title="Triage"><form action={updateFeedbackStatus} className="admin-detail-action-form inline"><input type="hidden" name="feedbackId" value={item.id} /><select name="status" defaultValue={item.status} aria-label="Update feedback status"><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><Button type="submit">Update status</Button></form></DetailSection>
            </>}
          >
            <div className="feedback-card-top"><div><span className={`feedback-category category-${item.category}`}>{item.category}</span><span className={`feedback-status feedback-${item.status}`}>{item.status.replace("_", " ")}</span></div><time>{formatDate(item.createdAt)}</time></div>
            <p>{item.message}</p>
            <div className="feedback-author"><span>{item.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{item.user.name}</strong><small>{item.user.handle ? `@${item.user.handle}` : item.user.email}</small></div></div>
            <dl className="feedback-meta"><div><dt>Screen</dt><dd>{item.screen || "—"}</dd></div><div><dt>App version</dt><dd>{item.appVersion || "—"}</dd></div><div><dt>Attachments</dt><dd>{[item.includedScreenshot && "screenshot", item.includedLogs && "logs", item.includedDeviceInfo && "device"].filter(Boolean).join(", ") || "none"}</dd></div></dl>
            <span className="card-view-label">Open details →</span>
          </DetailDialogCard>
        ))}</div> : <EmptyState>No feedback matches this status.</EmptyState>}
      </section>
    </>
  );
}
