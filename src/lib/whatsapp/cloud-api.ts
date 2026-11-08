import { normalizeIndiaPhone } from "@/lib/whatsapp/phone";

const GRAPH = "https://graph.facebook.com/v21.0";

export type WhatsAppSendResult = {
  ok: boolean;
  to?: string;
  messageId?: string;
  error?: string;
  skipped?: boolean;
};

export function isWhatsAppConfigured() {
  return Boolean(
    process.env.WHATSAPP_TOKEN?.trim() &&
      process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  );
}

export function officeNotifyPhones(): string[] {
  const raw = process.env.WHATSAPP_OFFICE_NOTIFY_PHONES || "";
  return raw
    .split(/[,;\s]+/)
    .map((p) => normalizeIndiaPhone(p))
    .filter((p): p is string => Boolean(p));
}

export function officeGroupId(): string | null {
  return process.env.WHATSAPP_OFFICE_GROUP_ID?.trim() || null;
}

function token() {
  return process.env.WHATSAPP_TOKEN!.trim();
}

function phoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID!.trim();
}

async function withTimeout<T>(promise: Promise<T>, ms = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("WhatsApp request timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function uploadDocument(
  buffer: Buffer,
  filename: string,
  mimeType = "application/pdf"
): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  if (!isWhatsAppConfigured()) return { ok: false, error: "WhatsApp not configured" };
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    const bytes = new Uint8Array(buffer);
    form.append("file", new Blob([bytes], { type: mimeType }), filename);

    const res = await withTimeout(
      fetch(`${GRAPH}/${phoneNumberId()}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
        body: form,
      })
    );
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !json.id) {
      return { ok: false, error: json.error?.message || `Media upload failed (${res.status})` };
    }
    return { ok: true, mediaId: json.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Media upload failed" };
  }
}

type TemplateSendInput = {
  to: string;
  templateName: string;
  languageCode?: string;
  mediaId: string;
  filename: string;
  /** Body parameter strings in template order */
  bodyParams: string[];
  recipientType?: "individual" | "group";
};

export async function sendDocumentTemplate(input: TemplateSendInput): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) {
    return { ok: false, skipped: true, error: "WhatsApp not configured" };
  }
  const to =
    input.recipientType === "group"
      ? input.to
      : normalizeIndiaPhone(input.to);
  if (!to) return { ok: false, skipped: true, error: "Invalid phone number" };

  const language = input.languageCode || process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const body = {
    messaging_product: "whatsapp",
    recipient_type: input.recipientType || "individual",
    to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: language },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "document",
              document: { id: input.mediaId, filename: input.filename },
            },
          ],
        },
        {
          type: "body",
          parameters: input.bodyParams.map((text) => ({ type: "text", text: String(text || "—").slice(0, 1024) })),
        },
      ],
    },
  };

  try {
    const res = await withTimeout(
      fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    );
    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, to, error: json.error?.message || `Send failed (${res.status})` };
    }
    return { ok: true, to, messageId: json.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, to, error: e instanceof Error ? e.message : "Send failed" };
  }
}

/** Fallback when templates are not yet approved: send a plain document (only works inside 24h session). */
export async function sendDocumentMessage(opts: {
  to: string;
  mediaId: string;
  filename: string;
  caption: string;
  recipientType?: "individual" | "group";
}): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) {
    return { ok: false, skipped: true, error: "WhatsApp not configured" };
  }
  const to =
    opts.recipientType === "group" ? opts.to : normalizeIndiaPhone(opts.to);
  if (!to) return { ok: false, skipped: true, error: "Invalid phone number" };

  const body = {
    messaging_product: "whatsapp",
    recipient_type: opts.recipientType || "individual",
    to,
    type: "document",
    document: {
      id: opts.mediaId,
      filename: opts.filename,
      caption: opts.caption.slice(0, 1024),
    },
  };

  try {
    const res = await withTimeout(
      fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    );
    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, to, error: json.error?.message || `Send failed (${res.status})` };
    }
    return { ok: true, to, messageId: json.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, to, error: e instanceof Error ? e.message : "Send failed" };
  }
}
