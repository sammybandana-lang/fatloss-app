/**
 * Sends the daily trainer email from the account's own Gmail, so the
 * trainer sees the same familiar sender they see today.
 *
 * Deliberately separate from `lib/gmail/client.ts` and its credentials.
 * That module reads mail and must never be able to send; this one sends and
 * never reads. OAuth scopes are fixed at grant time, so the read-only token
 * cannot be reused here — GMAIL_SEND_REFRESH_TOKEN must be granted with
 * https://www.googleapis.com/auth/gmail.send. Keeping two tokens means a
 * bug in the LoseIt import can't send mail, and a bug here can't read the
 * inbox.
 */

import { OAuth2Client } from "google-auth-library";
import { gmail_v1 } from "googleapis";

interface GmailSendEnv {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

function getRequiredEnv(): GmailSendEnv {
  const refreshToken = process.env.GMAIL_SEND_REFRESH_TOKEN;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!refreshToken) {
    throw new Error("GMAIL_SEND_REFRESH_TOKEN is not set.");
  }
  if (!clientId) {
    throw new Error("GMAIL_CLIENT_ID is not set.");
  }
  if (!clientSecret) {
    throw new Error("GMAIL_CLIENT_SECRET is not set.");
  }

  return { refreshToken, clientId, clientSecret };
}

function createGmailClient(env: GmailSendEnv): gmail_v1.Gmail {
  const oauth2Client = new OAuth2Client({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  });
  oauth2Client.setCredentials({ refresh_token: env.refreshToken });

  return new gmail_v1.Gmail({ auth: oauth2Client });
}

/**
 * Builds an RFC 2822 message. The subject is RFC 2047 encoded-word wrapped
 * because it contains an em dash — raw non-ASCII in a header is invalid and
 * renders as mojibake in some clients. The body is sent as UTF-8 base64 for
 * the same reason.
 */
export function buildRawMessage(to: string, subject: string, body: string): string {
  const encodedSubject = `=?utf-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;

  const message = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf-8").toString("base64"),
  ].join("\r\n");

  return Buffer.from(message, "utf-8").toString("base64url");
}

/**
 * Sends a plain-text email. Throws on failure — the caller decides what a
 * failed send means (the daily job leaves `sent_at` null so the next
 * attempt retries).
 */
export async function sendEmail({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const gmail = createGmailClient(getRequiredEnv());

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: buildRawMessage(to, subject, body) },
  });
}
