import type { Metadata } from "next";

import { CURRENT_AGREEMENT } from "@/lib/legal-copy";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <>
      <div className="page-hero">
        <p className="eyebrow">Legal</p>
        <h1>Terms of Service</h1>
        <p className="lede">The rules and conditions that apply when you create an account or use MyTurn.</p>
        <p className="meta-line">Version {CURRENT_AGREEMENT.version} · Effective July 17, 2026</p>
      </div>
      <div className="legal-document">
        {CURRENT_AGREEMENT.sections.map((section) => (
          <section className="legal-card" key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
    </>
  );
}
