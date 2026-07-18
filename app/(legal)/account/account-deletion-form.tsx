"use client";

import { FormEvent, useState } from "react";

type Stage = "request" | "confirm" | "complete";

async function responseError(response: Response, fallback: string) {
  const result = await response.json().catch(() => ({}));
  return typeof result?.error === "string" ? result.error : fallback;
}

export function AccountDeletionForm() {
  const [stage, setStage] = useState<Stage>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account-deletion/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error(await responseError(response, "The verification code could not be sent."));
      setStage("confirm");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The verification code could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, confirmation }),
      });
      if (!response.ok) throw new Error(await responseError(response, "The account could not be deleted."));
      setStage("complete");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The account could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "complete") {
    return (
      <section className="legal-card deletion-form-card">
        <p className="status success">Your MyTurn account and associated active production data were deleted.</p>
      </section>
    );
  }

  return (
    <section className="legal-card deletion-form-card">
      <div className="step-indicator" aria-label={`Step ${stage === "request" ? 1 : 2} of 2`}>
        <span className="active">1</span><i /><span className={stage === "confirm" ? "active" : ""}>2</span>
      </div>
      {stage === "request" ? (
        <form className="form-grid" onSubmit={requestCode}>
          <h2>Verify your email</h2>
          <p>Enter the email connected to MyTurn. If an account exists, a six-digit code will be sent to it and will expire after one hour.</p>
          <div className="field">
            <label htmlFor="deletion-email">Account email</label>
            <input id="deletion-email" type="email" autoComplete="email" required maxLength={320} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          {error && <p className="status error" role="alert">{error}</p>}
          <button className="button" disabled={busy} type="submit">{busy ? "Sending…" : "Send verification code"}</button>
        </form>
      ) : (
        <form className="form-grid" onSubmit={deleteAccount}>
          <h2>Confirm permanent deletion</h2>
          <p>Enter the code sent to <strong>{email}</strong>. Then type <strong>DELETE</strong> exactly to confirm that this cannot be undone.</p>
          <div className="field">
            <label htmlFor="deletion-code">Six-digit code</label>
            <input id="deletion-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="field">
            <label htmlFor="deletion-confirmation">Type DELETE</label>
            <input id="deletion-confirmation" required placeholder="DELETE" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </div>
          {error && <p className="status error" role="alert">{error}</p>}
          <button className="button danger-button" disabled={busy || confirmation !== "DELETE" || code.length !== 6} type="submit">{busy ? "Deleting…" : "Permanently delete account"}</button>
        </form>
      )}
    </section>
  );
}
