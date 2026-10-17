import { AppError } from "@/lib/errors";

/** Error body returned by the Graph API for Cloud API calls. */
export interface WhatsAppErrorBody {
  error?: { code?: number; error_subcode?: number; message?: string; error_data?: { details?: string } };
}

/** Recipient-side failures: the number can't receive (not on WhatsApp, blocked us, …). */
const RECIPIENT_GONE = new Set([131026, 131049, 131050, 131021]);
/** Throughput and pair-rate limits. */
const RATE_LIMITED = new Set([4, 80007, 130429, 131048, 131056]);
/** Problems only the operator can fix: token, template, payment method, account state. */
const OPERATOR_FIXABLE = new Set([0, 3, 10, 190, 200, 131031, 131042, 131045, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010, 368]);

/** Maps Cloud API failures onto the delivery error classes the workflow engine understands. */
export function whatsAppError(status: number, body: WhatsAppErrorBody): AppError {
  const code = body.error?.code ?? status;
  const detail = `whatsapp ${status} code ${code}`;

  if (status === 429 || RATE_LIMITED.has(code)) {
    return new AppError("CHANNEL_RATE_LIMITED", detail, { retryAfterMs: 60_000 });
  }
  if (RECIPIENT_GONE.has(code)) {
    return new AppError("CHANNEL_UNAVAILABLE", detail, {
      userMessage: "WhatsApp couldn't deliver to this number. Check it can receive WhatsApp messages, then reconnect it.",
    });
  }
  if (status === 401 || OPERATOR_FIXABLE.has(code)) {
    return new AppError("CONFIGURATION_MISSING", detail, {
      userMessage: "WhatsApp sending isn't working on this server right now. The admin has been told.",
    });
  }
  // Transient: Graph "unknown"/"service" errors and server-side failures.
  if (status >= 500 || code === 1 || code === 2 || code === 131000) {
    return new AppError("CHANNEL_DELIVERY_FAILED", detail);
  }
  // Any other 4xx means we sent something WhatsApp won't accept; retrying won't help.
  return new AppError("INTERNAL", `whatsapp rejected payload: ${detail}`);
}
