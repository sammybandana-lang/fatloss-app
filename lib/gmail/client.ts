/**
 * Thin Gmail client for pulling the most recent LoseIt daily-report CSV out
 * of the inbox. Read-only on purpose (scope
 * https://www.googleapis.com/auth/gmail.readonly) — this code can look at
 * mail, never send, delete, or modify it.
 *
 * The refresh token in GMAIL_REFRESH_TOKEN must have been granted with only
 * that scope; this module has no way to enforce that at runtime, so it's a
 * one-time setup concern when the token is created.
 */

import { OAuth2Client } from "google-auth-library";
import { gmail_v1 } from "googleapis";

const LOSEIT_SENDER = "donotreply@loseit.com";
const SEARCH_QUERY = `from:${LOSEIT_SENDER} has:attachment newer_than:1d`;

interface GmailEnv {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

function getRequiredEnv(): GmailEnv {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!refreshToken) {
    throw new Error("GMAIL_REFRESH_TOKEN is not set.");
  }
  if (!clientId) {
    throw new Error("GMAIL_CLIENT_ID is not set.");
  }
  if (!clientSecret) {
    throw new Error("GMAIL_CLIENT_SECRET is not set.");
  }

  return { refreshToken, clientId, clientSecret };
}

function createGmailClient(env: GmailEnv): gmail_v1.Gmail {
  const oauth2Client = new OAuth2Client({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  });
  oauth2Client.setCredentials({ refresh_token: env.refreshToken });

  return new gmail_v1.Gmail({ auth: oauth2Client });
}

/** Gmail search results come back newest-first; maxResults keeps it to one round-trip. */
async function findMostRecentMessageId(gmail: gmail_v1.Gmail): Promise<string | null> {
  const { data } = await gmail.users.messages.list({
    userId: "me",
    q: SEARCH_QUERY,
    maxResults: 1,
  });

  const [message] = data.messages ?? [];
  return message?.id ?? null;
}

function getHeader(
  payload: gmail_v1.Schema$MessagePart | undefined,
  name: string,
): string | null {
  const header = payload?.headers?.find(
    (candidate) => candidate.name?.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

/**
 * Pulls the actual email address out of a From header. Headers can be
 * either a bare address ("a@b.com") or "Display Name <a@b.com>" — and the
 * display name is attacker-controlled free text, so it must never be part
 * of the trust decision (e.g. `"donotreply@loseit.com" <attacker@evil.com>`
 * has the trusted address sitting in the display name on purpose).
 */
function extractEmailAddress(from: string): string {
  const angleBracketMatch = /<([^>]+)>/.exec(from);
  const address = angleBracketMatch ? angleBracketMatch[1] : from;
  return address.trim().toLowerCase();
}

/**
 * The search query already filters by sender, but that's untrusted input
 * from Gmail, not a guarantee. Re-check the actual message before trusting
 * anything inside it. Compares the real address exactly — never a substring
 * check, which a display name or lookalike domain could otherwise spoof.
 */
function assertTrustedSender(message: gmail_v1.Schema$Message): void {
  const from = getHeader(message.payload, "From");
  const address = from ? extractEmailAddress(from) : null;
  if (!address || address !== LOSEIT_SENDER) {
    throw new Error(`Unexpected sender: ${from ?? "(missing From header)"}`);
  }
}

function findCsvAttachmentPart(
  part: gmail_v1.Schema$MessagePart | undefined,
): gmail_v1.Schema$MessagePart | null {
  if (!part) {
    return null;
  }
  if (part.filename?.toLowerCase().endsWith(".csv")) {
    return part;
  }
  for (const child of part.parts ?? []) {
    const found = findCsvAttachmentPart(child);
    if (found) {
      return found;
    }
  }
  return null;
}

async function downloadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
): Promise<string> {
  const { data } = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  if (!data.data) {
    throw new Error("Attachment had no data.");
  }

  // Gmail encodes attachment bytes as base64url (RFC 4648 §5).
  return Buffer.from(data.data, "base64url").toString("utf-8");
}

/**
 * Fetches the most recent LoseIt daily-report CSV from Gmail, or `null` if
 * there's no matching email. Never logs the CSV contents, tokens, or any
 * part of the email body — only a byte count on success.
 */
export async function getMostRecentLoseItCsv(): Promise<string | null> {
  const env = getRequiredEnv();
  const gmail = createGmailClient(env);

  const messageId = await findMostRecentMessageId(gmail);
  if (!messageId) {
    return null;
  }

  const { data: message } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  assertTrustedSender(message);

  const attachmentPart = findCsvAttachmentPart(message.payload);
  const attachmentId = attachmentPart?.body?.attachmentId;
  if (!attachmentId) {
    throw new Error("No CSV attachment in LoseIt email");
  }

  const csvText = await downloadAttachment(gmail, messageId, attachmentId);

  console.log(`Fetched LoseIt CSV, ${Buffer.byteLength(csvText, "utf-8")} bytes`);

  return csvText;
}
