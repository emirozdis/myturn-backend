import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminLoginChallenge, getAdminSession, isAdminAuthConfigured } from "@/lib/admin-auth";
import { cancelAdminLogin, loginAdmin, resendAdminLoginCode, verifyAdminLoginCode } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  invalid: "The email or password is incorrect.",
  rate: "Too many attempts. Wait a few minutes and try again.",
  configuration: "Admin access is not configured on this environment.",
  code: "That verification code is incorrect or has expired.",
  delivery: "The verification email could not be sent. Check email delivery configuration and try again.",
  challenge: "Your verification session expired. Enter your credentials again.",
};

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, local.length - 2)))}@${domain}`;
}

export default async function AdminLoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string; step?: string; sent?: string }>;
}) {
  if (await getAdminSession()) redirect("/admin");
  const { error, step, sent } = await searchParams;
  const configured = isAdminAuthConfigured();
  const challenge = await getAdminLoginChallenge();
  if (step === "verify" && !challenge) redirect("/admin/login?error=challenge");
  const verificationStep = step === "verify" && Boolean(challenge);

  return (
    <main className="admin-login-page">
      <section className="admin-login-panel">
        <div className="admin-login-brand"><span>M</span><strong>MyTurn</strong></div>
        <div className="admin-login-copy">
          <p>Private administration</p>
          <h1>{verificationStep ? "Check your inbox." : "Good to see you again."}</h1>
          <span>{verificationStep
            ? `Enter the single-use code sent to ${maskEmail(challenge!.email)}. It expires in 10 minutes.`
            : "Sign in with the dedicated administrator credentials. Every login also requires a verification code sent by email."}</span>
        </div>

        <form action={verificationStep ? verifyAdminLoginCode : loginAdmin} className="admin-login-form">
          {error && messages[error] ? <div className="admin-form-alert" role="alert">{messages[error]}</div> : null}
          {sent === "1" ? <div className="admin-form-alert" role="status">A new verification code was sent.</div> : null}
          {!configured && !error ? <div className="admin-form-alert" role="alert">Admin credentials and transactional email delivery must be configured before sign-in is available.</div> : null}
          {verificationStep ? (
            <label>Verification code<input className="admin-code-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={!configured} autoFocus placeholder="000000" /></label>
          ) : <>
            <label>Email address<input name="email" type="email" autoComplete="username" required disabled={!configured} placeholder="admin@myturn.app" /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" required disabled={!configured} /></label>
          </>}
          <button type="submit" disabled={!configured}>{verificationStep ? "Verify and enter" : "Continue with email code"} <span>→</span></button>
        </form>

        {verificationStep ? (
          <div className="admin-login-secondary-actions">
            <form action={resendAdminLoginCode}><button type="submit">Send a new code</button></form>
            <form action={cancelAdminLogin}><button type="submit">Use different credentials</button></form>
          </div>
        ) : null}

        <footer><span>Protected with isolated credentials and email two-factor verification</span><Link href="/">Return to MyTurn</Link></footer>
      </section>
      <aside className="admin-login-aside" aria-hidden="true">
        <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
        <div className="login-status-card"><span><i /> Two-step protection</span><strong>One place for every signal.</strong><p>Dedicated admin credentials plus a single-use email code protect health, users, uploads, feedback, surveys, and errors.</p></div>
      </aside>
    </main>
  );
}
