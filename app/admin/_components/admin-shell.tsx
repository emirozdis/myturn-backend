import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminSession } from "@/lib/admin-auth";
import { logoutAdmin } from "@/app/admin/actions";

const navigation = [
  { href: "/admin", label: "Overview", mark: "01" },
  { href: "/admin/users", label: "Users", mark: "02" },
  { href: "/admin/incidents", label: "Logs & errors", mark: "03" },
  { href: "/admin/feedback", label: "Feedback", mark: "04" },
  { href: "/admin/surveys", label: "Surveys", mark: "05" },
  { href: "/admin/versions", label: "App versions", mark: "06" },
  { href: "/admin/audit", label: "Audit trail", mark: "07" },
];

export function AdminShell({ session, children }: { session: AdminSession; children: ReactNode }) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark">M</span>
          <span><strong>MyTurn</strong><small>Control center</small></span>
        </div>

        <nav className="admin-nav" aria-label="Admin navigation">
          <p>Workspace</p>
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>
              <span>{item.mark}</span>{item.label}
            </Link>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-identity">
            <span>{session.email.slice(0, 1).toUpperCase()}</span>
            <div><strong>Administrator</strong><small>{session.email}</small></div>
          </div>
          <form action={logoutAdmin}><button type="submit">Sign out</button></form>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <div><span className="live-dot" />Secure admin session</div>
          <div className="environment-chip">{process.env.LOG_ENVIRONMENT || process.env.NODE_ENV || "development"}</div>
        </header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="admin-page-header">
      <div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="admin-empty">{children}</div>;
}
