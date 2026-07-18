"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Support", "/support"],
  ["Account deletion", "/account"],
] as const;

export function LegalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="legal-site">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="MyTurn home">
          <span>
            <strong>MyTurn</strong>
            <small>Legal &amp; Support</small>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Legal and support">
          {links.map(([label, href]) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="page-main">{children}</main>
      <footer className="site-footer">
        <div>
          <strong>MyTurn</strong>
          <span>Operated by Mehmet Emir Özdiş, an individual independent developer in İzmir, Türkiye.</span>
        </div>
        <a href="mailto:support@myturn.emirozdis.tr">support@myturn.emirozdis.tr</a>
      </footer>
    </div>
  );
}
