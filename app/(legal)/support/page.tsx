import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <>
      <div className="page-hero">
        <p className="eyebrow">Support</p>
        <h1>How can we help?</h1>
        <p className="lede">Support for accounts, uploads, notifications, purchases, privacy requests, and safety concerns.</p>
      </div>
      <div className="support-grid">
        <section className="legal-card support-card">
          <span className="card-number">01</span>
          <h2>Contact MyTurn</h2>
          <p>Email <a href="mailto:support@myturn.emirozdis.tr">support@myturn.emirozdis.tr</a>.</p>
          <p>Operator: Mehmet Emir Özdiş<br />Contact location: İzmir, Türkiye</p>
        </section>
        <section className="legal-card support-card">
          <span className="card-number">02</span>
          <h2>Account and privacy</h2>
          <p>Use the <Link href="/account">account-deletion page</Link> to delete an account without reinstalling the app. For another privacy request, email support from the address connected to your account.</p>
        </section>
        <section className="legal-card support-card">
          <span className="card-number">03</span>
          <h2>Subscriptions</h2>
          <p>Deleting MyTurn does not cancel billing handled by Apple or Google. Cancel through your App Store or Google Play account first.</p>
        </section>
      </div>
    </>
  );
}
