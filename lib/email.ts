import { BrevoClient } from "@getbrevo/brevo";

const apiKey = process.env.BREVO_API_KEY;
const senderEmail = process.env.BREVO_SENDER_EMAIL;
const senderName = process.env.BREVO_SENDER_NAME || "MyTurn";

function getClient() {
  if (!apiKey || !senderEmail) {
    throw new Error("BREVO_API_KEY and BREVO_SENDER_EMAIL must be configured.");
  }
  return new BrevoClient({ apiKey });
}

async function sendEmail(to: { email: string; name?: string }, subject: string, htmlContent: string) {
  await getClient().transactionalEmails.sendTransacEmail({
    sender: { email: senderEmail!, name: senderName },
    to: [to],
    subject,
    htmlContent,
  });
}

export async function sendVerificationEmail(email: string, name: string | null | undefined, code: string) {
  await sendEmail(
    { email, name: name || undefined },
    "Verify your MyTurn email",
    `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Welcome to MyTurn${name ? `, ${name}` : ""}!</h2><p>Enter this verification code in the MyTurn app:</p><p style="font-size:32px;letter-spacing:8px;font-weight:700">${code}</p><p>This code expires in one hour and can only be used once.</p></div>`,
  );
}

export async function sendPasswordResetEmail(email: string, name: string | null | undefined, code: string) {
  await sendEmail(
    { email, name: name || undefined },
    "Reset your MyTurn password",
    `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Password reset</h2><p>Enter this code in the MyTurn app to choose a new password:</p><p style="font-size:32px;letter-spacing:8px;font-weight:700">${code}</p><p>This code expires in one hour and can only be used once.</p></div>`,
  );
}

export async function sendAccountDeletionEmail(email: string, name: string | null | undefined, code: string) {
  await sendEmail(
    { email, name: name || undefined },
    "Confirm deletion of your MyTurn account",
    `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Delete your MyTurn account</h2><p>Enter this verification code on the MyTurn account-deletion page:</p><p style="font-size:32px;letter-spacing:8px;font-weight:700">${code}</p><p>This code expires in one hour and can only be used once. If you did not request account deletion, you can ignore this email.</p></div>`,
  );
}

export async function sendAdminLoginCodeEmail(email: string, code: string) {
  await sendEmail(
    { email, name: "MyTurn administrator" },
    "Your MyTurn admin sign-in code",
    `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111"><h2>Confirm your admin sign-in</h2><p>Enter this verification code to finish signing in to the MyTurn admin control center:</p><p style="font-size:32px;letter-spacing:8px;font-weight:700">${code}</p><p>This code expires in 10 minutes and can only be used once.</p><p>If you did not attempt to sign in, change the dedicated admin password immediately.</p></div>`,
  );
}
