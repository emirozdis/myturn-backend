import type { Metadata } from "next";

import { AccountDeletionForm } from "./account-deletion-form";

export const metadata: Metadata = { title: "Delete account" };

export default function AccountPage() {
  return (
    <>
      <div className="page-hero">
        <p className="eyebrow">Privacy choice</p>
        <h1>Delete your MyTurn account</h1>
        <p className="lede">Verify the email connected to your account and permanently delete the account and associated MyTurn data.</p>
      </div>
      <div className="notice">
        <strong>Deletion is irreversible.</strong>
        <span>It removes your profile, group membership, social activity, managed media, feedback, and active MyTurn records. It does not cancel a subscription billed by Apple or Google.</span>
      </div>
      <AccountDeletionForm />
      <section className="legal-card secondary-card">
        <h2>Other ways to delete</h2>
        <p>You can delete your account in the MyTurn app under Settings → Delete Account. If the self-service flow is unavailable, email <a href="mailto:support@myturn.emirozdis.tr?subject=MyTurn%20account%20deletion">support@myturn.emirozdis.tr</a> from the address connected to your account.</p>
      </section>
    </>
  );
}
