import type { Metadata } from 'next';

import { LegalShell } from '../../(legal)/_components/legal-shell';

export const metadata: Metadata = {
  title: 'Join a group',
  description: 'Open a MyTurn group invitation in the MyTurn app.',
};

const INVITE_CODE = /^[A-Z0-9]{6}(?:-[A-Z0-9]{6})?$/;

export default async function GroupInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const params = await searchParams;
  const value = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = value?.trim().toUpperCase() || '';
  const validCode = INVITE_CODE.test(code) ? code : '';
  const appUrl = validCode
    ? `myturn://group/join?code=${encodeURIComponent(validCode)}`
    : 'myturn://';

  return (
    <LegalShell>
      <p className="eyebrow">Group invitation</p>
      <h1>Continue in MyTurn</h1>
      <p className="lede">
        Open this invitation in the MyTurn app to review and join the group.
      </p>
      <section className="legal-card invite-card">
        <h2>{validCode ? `Invite code ${validCode}` : 'Invalid invitation'}</h2>
        <p>
          {validCode
            ? 'If MyTurn is installed, the button below will take you directly to the group invitation.'
            : 'This invitation link is missing a valid group code.'}
        </p>
        {validCode ? <a className="button invite-open-button" href={appUrl}>Open MyTurn</a> : null}
      </section>
    </LegalShell>
  );
}
