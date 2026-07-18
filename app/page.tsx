import Link from "next/link";
import { LegalShell } from "./(legal)/_components/legal-shell";

export default function HomePage() {
  return (
    <LegalShell>
      <p className="eyebrow">Official resources</p>
      <h1>MyTurn</h1>
      <p className="lede">Privacy, legal, account-management, and support information for the MyTurn mobile app.</p>
      <section className="legal-card">
        <h2>Get help or manage your data</h2>
        <ul>
          <li><Link href="/privacy">Read the Privacy Policy</Link></li>
          <li><Link href="/terms">Read the Terms of Service</Link></li>
          <li><Link href="/support">Contact support</Link></li>
          <li><Link href="/account">Delete your MyTurn account</Link></li>
        </ul>
      </section>
    </LegalShell>
  );
}
