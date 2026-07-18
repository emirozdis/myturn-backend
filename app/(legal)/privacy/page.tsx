import type { Metadata } from "next";

import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  SERVICE_PROVIDERS,
} from "@/lib/privacy-policy";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <>
      <div className="page-hero">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy Policy</h1>
        <p className="lede">How MyTurn collects, uses, protects, retains, and deletes personal information.</p>
        <p className="meta-line">Version {PRIVACY_POLICY_VERSION} · Effective {PRIVACY_POLICY_EFFECTIVE_DATE}</p>
      </div>
      <div className="legal-document">
        {PRIVACY_POLICY_SECTIONS.map((section) => (
          <section className="legal-card" id={section.id} key={section.id}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
          </section>
        ))}
        <section className="legal-card" id="providers">
          <h2>Current service providers</h2>
          <ul>
            {SERVICE_PROVIDERS.map(({ provider, purpose, data }) => (
              <li key={provider}><strong>{provider}:</strong> {purpose} Data involved: {data}</li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
