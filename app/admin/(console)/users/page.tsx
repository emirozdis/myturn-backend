import { PageHeader, EmptyState } from "@/app/admin/_components/admin-shell";
import { getUsers } from "@/lib/admin-data";
import { formatDate, relativeTime } from "@/lib/admin-format";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DetailDialogRow, DetailGrid, DetailItem, DetailSection } from "@/components/admin/detail-dialog";
import { AccountActionDialog } from "@/components/admin/account-action-dialog";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const query = params.q || "";
  const status = ["all", "active", "suspended"].includes(params.status || "") ? params.status! : "all";
  const users = await getUsers(query, status);

  return (
    <>
      <PageHeader eyebrow="Access & accounts" title="Users" description="Search app accounts, review activity, and manage access through confirmed administrative controls." />
      <section className="admin-panel table-panel">
        <form className="admin-toolbar" method="get">
          <label className="admin-search"><span>⌕</span><input name="q" defaultValue={query} placeholder="Search name, email, or handle" /></label>
          <select name="status" defaultValue={status} aria-label="Account status"><option value="all">All accounts</option><option value="active">Active</option><option value="suspended">Frozen</option></select>
          <button type="submit">Apply filters</button>
          <small>{users.length} result{users.length === 1 ? "" : "s"}</small>
        </form>
        {users.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table users-table">
              <thead><tr><th>User</th><th>Status</th><th>Groups</th><th>Vlogs</th><th>Last active</th><th>Joined</th><th><span className="sr-only">Manage</span></th></tr></thead>
              <tbody>{users.map((user) => (
                <DetailDialogRow
                  key={user.id}
                  title={user.name}
                  description={user.email}
                  details={<>
                    <div className="admin-detail-status-line"><Badge variant={user.isSuspended ? "outline" : "default"}>{user.isSuspended ? "Frozen" : "Active"}</Badge><span>App user account</span></div>
                    <DetailSection title="Account">
                      <DetailGrid>
                        <DetailItem label="User ID">{user.id}</DetailItem><DetailItem label="Firebase UID">{user.firebaseUid}</DetailItem>
                        <DetailItem label="Email">{user.email}</DetailItem><DetailItem label="Handle">{user.handle ? `@${user.handle}` : "—"}</DetailItem>
                        <DetailItem label="Locale">{user.locale.toUpperCase()}</DetailItem><DetailItem label="Joined">{formatDate(user.createdAt)}</DetailItem>
                        <DetailItem label="Last active">{user.groupMembers[0]?.lastActiveAt ? formatDate(user.groupMembers[0].lastActiveAt) : "No activity"}</DetailItem><DetailItem label="Location">{user.location || "—"}</DetailItem>
                        <DetailItem label="Bio" wide>{user.bio || "—"}</DetailItem>
                      </DetailGrid>
                    </DetailSection>
                    <Separator />
                    <DetailSection title="Activity">
                      <div className="admin-detail-stat-grid"><div><strong>{user._count.clips}</strong><span>Vlogs</span></div><div><strong>{user._count.groupMembers}</strong><span>Groups</span></div><div><strong>{user._count.feedbackReports}</strong><span>Feedback reports</span></div><div><strong>{user.boostCredits}</strong><span>Boost credits</span></div></div>
                    </DetailSection>
                    <Separator />
                    <DetailSection title="Account controls">
                      {user.isSuspended && user.suspensionReason ? <p className="admin-detail-note">Frozen because: {user.suspensionReason}</p> : <p className="admin-detail-note">These secondary controls affect authentication or permanently remove the account. Every action requires a separate confirmation.</p>}
                      <div className="admin-account-actions">
                        <AccountActionDialog operation={user.isSuspended ? "unfreeze" : "freeze"} userId={user.id} userName={user.name} userEmail={user.email} />
                        <AccountActionDialog operation="revoke_sessions" userId={user.id} userName={user.name} userEmail={user.email} />
                        <AccountActionDialog operation="delete" userId={user.id} userName={user.name} userEmail={user.email} />
                      </div>
                    </DetailSection>
                  </>}
                >
                  <td><div className="user-cell"><span>{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.handle ? `@${user.handle}` : user.email}</small></div></div></td>
                  <td><span className={`account-status ${user.isSuspended ? "is-suspended" : "is-active"}`}><i />{user.isSuspended ? "Frozen" : "Active"}</span></td>
                  <td>{user._count.groupMembers}</td><td>{user._count.clips}</td>
                  <td>{user.groupMembers[0]?.lastActiveAt ? relativeTime(user.groupMembers[0].lastActiveAt) : "No activity"}</td>
                  <td>{formatDate(user.createdAt, false)}</td>
                  <td><span className="row-view-label">View</span></td>
                </DetailDialogRow>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState>No users match these filters.</EmptyState>}
      </section>
      <p className="table-footnote">Showing up to 100 newest matching accounts. Freezing is enforced by the backend and revokes active Firebase sessions.</p>
    </>
  );
}
