import nodemailer from "nodemailer";

/** Strip accidental quotes/spaces from Railway variable values. */
export function cleanEnv(value: string | undefined | null): string {
  return String(value || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

export function gmailUser() {
  return cleanEnv(process.env.GMAIL_USER || process.env.EMAIL_USER);
}

export function gmailAppPassword() {
  return cleanEnv(process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD || process.env.GOOGLE_APP_PASSWORD).replace(
    /\s+/g,
    ""
  );
}

/** Always include Rahul, Devesh, Nitin on purchase/payment slips. */
export const DEFAULT_SLIP_RECIPIENTS = [
  "rahulnitingupta741@gmail.com",
  "deveshemailbox@gmail.com",
  "nitingupta212000@gmail.com",
] as const;

function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => cleanEnv(s))
    .filter((s) => s.includes("@"));
}

/** Primary inbox (first recipient) — kept for diagnostics / single-field UI. */
export function notifyInbox(): string {
  return notifyRecipients()[0] || "";
}

/**
 * All slip recipients: NOTIFY_EMAILS (or NOTIFY_EMAIL) plus the three office inboxes.
 * Deduped, lowercased keys, original casing preserved from first occurrence.
 */
export function notifyRecipients(): string[] {
  const fromEnv = parseEmailList(
    cleanEnv(process.env.NOTIFY_EMAILS) || cleanEnv(process.env.NOTIFY_EMAIL) || gmailUser()
  );
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const email of [...fromEnv, ...DEFAULT_SLIP_RECIPIENTS]) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(email);
  }
  return ordered;
}

export function resendApiKey() {
  return cleanEnv(process.env.RESEND_API_KEY);
}

export function isEmailConfigured() {
  if (resendApiKey() && notifyRecipients().length > 0) return true;
  return Boolean(gmailUser() && gmailAppPassword() && notifyRecipients().length > 0);
}

export function emailConfigDiagnostics() {
  const user = gmailUser();
  const pass = gmailAppPassword();
  const recipients = notifyRecipients();
  const notify = recipients.join(", ");
  const resend = Boolean(resendApiKey());
  const missing: string[] = [];
  if (!resend) {
    if (!user) missing.push("GMAIL_USER");
    if (!pass) missing.push("GMAIL_APP_PASSWORD");
  }
  if (!recipients.length) missing.push("NOTIFY_EMAIL or NOTIFY_EMAILS");
  return {
    configured: isEmailConfigured(),
    hasGmailUser: Boolean(user),
    hasGmailAppPassword: Boolean(pass),
    hasResendKey: resend,
    notifyEmail: notify || "",
    notifyRecipients: recipients,
    transport: resend ? "resend" : user && pass ? "gmail-smtp" : "none",
    missing,
  };
}

const FREE_MAIL_FROM_BLOCK =
  /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me)\./i;

function resendFromAddress() {
  const fallback = "NAVRIT Portal <onboarding@resend.dev>";
  const raw = cleanEnv(process.env.RESEND_FROM);
  // Railway often truncates unquoted values at `<`, leaving "NAVRIT Portal" with no email.
  if (!raw || !raw.includes("@")) return fallback;
  // Resend cannot send FROM gmail.com / other free inboxes unless you own that domain.
  // NOTIFY_EMAIL (to) can still be Gmail — only the From: address must be resend.dev or your domain.
  if (FREE_MAIL_FROM_BLOCK.test(raw)) return fallback;
  return raw;
}

async function sendViaResend(opts: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  filename: string;
  pdf: Buffer;
}): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  const key = resendApiKey();
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };
  if (!key.startsWith("re_")) {
    return { ok: false, error: "RESEND_API_KEY looks invalid — it should start with re_" };
  }
  const from = resendFromAddress();
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to]).map((t) => cleanEnv(t)).filter(Boolean);
  if (!recipients.length) return { ok: false, error: "No email recipients" };

  async function postTo(toList: string[]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          from,
          to: toList,
          subject: opts.subject,
          text: opts.text,
          html: opts.html || undefined,
          attachments: [
            {
              filename: opts.filename,
              content: opts.pdf.toString("base64"),
            },
          ],
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
        error?: { message?: string; name?: string };
      };
      if (!res.ok) {
        const detail =
          json.error?.message || json.message || json.name || json.error?.name || `Resend failed (${res.status})`;
        return { ok: false as const, error: detail, status: res.status };
      }
      return { ok: true as const, messageId: json.id };
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    // Prefer one email to everyone; if Resend rejects multi-recipient (test domain), send one-by-one.
    const batch = await postTo(recipients);
    if (batch.ok) return { ok: true, messageId: batch.messageId };

    const detail = batch.error;
    if (/domain is not verified|gmail\.com domain/i.test(detail)) {
      return {
        ok: false,
        error:
          "Resend From address cannot be Gmail. On Railway delete RESEND_FROM (or set RESEND_FROM=\"NAVRIT Portal <onboarding@resend.dev>\"), keep NOTIFY_EMAIL as your Gmail, redeploy, then Send test email",
      };
    }
    if (/api key|unauthorized|401/i.test(detail) || batch.status === 401) {
      return { ok: false, error: "Resend API key rejected — recreate key in Resend and update RESEND_API_KEY on Railway" };
    }

    if (recipients.length > 1) {
      const sent: string[] = [];
      const failed: string[] = [];
      let lastId: string | undefined;
      for (const to of recipients) {
        const one = await postTo([to]);
        if (one.ok) {
          sent.push(to);
          lastId = one.messageId || lastId;
        } else {
          failed.push(`${to}: ${one.error}`);
        }
      }
      if (sent.length) {
        if (failed.length) {
          return {
            ok: true,
            messageId: lastId,
          };
        }
        return { ok: true, messageId: lastId };
      }
      if (/only send testing emails to your own/i.test(failed.join(" "))) {
        return {
          ok: false,
          error: `${failed[0]} — verify a domain in Resend (or use Gmail SMTP) to email Rahul, Devesh, and Nitin together`,
        };
      }
      return { ok: false, error: `Resend: ${failed[0] || detail}` };
    }

    if (/only send testing emails to your own/i.test(detail)) {
      return {
        ok: false,
        error: `${detail} — NOTIFY_EMAIL must be the same Gmail you used to sign up on Resend (while on free test domain)`,
      };
    }
    return { ok: false, error: `Resend: ${detail}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Resend failed";
    return { ok: false, error: msg.includes("abort") ? "Resend timed out" : msg };
  }
}

async function sendViaGmailSmtp(opts: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  filename: string;
  pdf: Buffer;
}): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  const user = gmailUser();
  const pass = gmailAppPassword();
  if (!user || !pass) return { ok: false, error: "GMAIL_USER / GMAIL_APP_PASSWORD missing" };

  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to]).map((t) => cleanEnv(t)).filter(Boolean);
  if (!recipients.length) return { ok: false, error: "No email recipients" };

  const fromName = process.env.NEXT_PUBLIC_BUSINESS_NAME || "NAVRIT";
  const attempts: Array<{ host: string; port: number; secure: boolean }> = [
    { host: cleanEnv(process.env.SMTP_HOST) || "smtp.gmail.com", port: Number(process.env.SMTP_PORT || 465), secure: true },
    { host: "smtp.gmail.com", port: 587, secure: false },
  ];

  let lastError = "Gmail SMTP failed";
  for (const attempt of attempts) {
    try {
      const transport = nodemailer.createTransport({
        host: attempt.host,
        port: attempt.port,
        secure: attempt.secure,
        auth: { user, pass },
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 20000,
        tls: { rejectUnauthorized: true },
      });

      const info = await transport.sendMail({
        from: `"${fromName} Portal" <${user}>`,
        to: recipients.join(", "),
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        attachments: [
          {
            filename: opts.filename,
            content: opts.pdf,
            contentType: "application/pdf",
          },
        ],
      });
      try {
        transport.close();
      } catch {
        /* ignore */
      }
      return { ok: true, messageId: info.messageId };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Gmail SMTP failed";
      // Try next port/mode
    }
  }

  // Friendlier hints for common Gmail failures
  const lower = lastError.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("username and password") || lower.includes("badcredentials") || lower.includes("535")) {
    return {
      ok: false,
      error:
        "Gmail login failed — use a 16-char App Password (not normal password), and ensure GMAIL_USER is exactly the Gmail that created it",
    };
  }
  if (lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("enotfound")) {
    return {
      ok: false,
      error:
        "Gmail SMTP blocked/unreachable from Railway — add free RESEND_API_KEY (HTTPS) or allow smtp.gmail.com",
    };
  }
  return { ok: false, error: lastError };
}

export async function sendMailWithPdf(opts: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  filename: string;
  pdf: Buffer;
}): Promise<{ ok: true; messageId?: string; transport?: string } | { ok: false; error: string }> {
  if (!isEmailConfigured()) {
    const d = emailConfigDiagnostics();
    return {
      ok: false,
      error: d.missing.length
        ? `Email not configured — missing ${d.missing.join(", ")}`
        : "Email not configured",
    };
  }

  // Prefer Resend (HTTPS) when set — most reliable on Railway.
  // Do NOT fall back to Gmail SMTP here; that hides the real Resend error behind "SMTP blocked".
  if (resendApiKey()) {
    const sent = await sendViaResend(opts);
    if (sent.ok) return { ...sent, transport: "resend" };
    return sent;
  }

  if (gmailUser() && gmailAppPassword()) {
    const sent = await sendViaGmailSmtp(opts);
    if (sent.ok) return { ...sent, transport: "gmail-smtp" };
    return sent;
  }

  return { ok: false, error: "No email transport configured" };
}

export async function sendTestEmail(): Promise<
  { ok: true; to: string; transport?: string; messageId?: string } | { ok: false; error: string; diagnostics: ReturnType<typeof emailConfigDiagnostics> }
> {
  const diagnostics = emailConfigDiagnostics();
  if (!diagnostics.configured) {
    return { ok: false, error: `Missing ${diagnostics.missing.join(", ") || "email settings"}`, diagnostics };
  }
  const recipients = notifyRecipients();
  const to = recipients.join(", ");
  const pdf = Buffer.from(
    "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
    "utf8"
  );
  const sent = await sendMailWithPdf({
    to: recipients,
    subject: "NAVRIT portal — test email",
    text: `Test from NAVRIT portal to: ${to}. If you received this, purchase PDF email is working. Check Spam if needed.`,
    html: `<p>Test from <b>NAVRIT</b> portal to <code>${to}</code>.</p><p>If you received this, purchase PDF email is working. Check Spam if needed.</p>`,
    filename: "navrit-test.txt.pdf",
    pdf,
  });
  if (!sent.ok) return { ok: false, error: sent.error, diagnostics };
  return { ok: true, to, transport: sent.transport, messageId: sent.messageId };
}
