import "server-only";

import { AppError } from "@/lib/errors";
import { buildMimeMessage, toGmailRaw, type MimeInput } from "@/lib/google/mime";

/**
 * Sheets and Gmail REST calls with an access token. Error mapping:
 * 401 → token revoked, 403 → permission (or rate limit, which is retryable),
 * 429/5xx → transient.
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const REQUEST_TIMEOUT_MS = 20_000;
const SHEET_TITLE = "Responses";

async function googleRequest<T>(url: string, token: string, init: { method: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("GOOGLE_UNAVAILABLE", "google api network error or timeout");
  }

  if (response.ok) return (await response.json()) as T;

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { status?: string; errors?: Array<{ reason?: string }> };
  };
  const reason = payload.error?.errors?.[0]?.reason ?? payload.error?.status ?? "";
  if (response.status === 401) throw new AppError("GOOGLE_TOKEN_REVOKED", "google api 401");
  if (response.status === 429 || /rateLimit|quotaExceeded|RESOURCE_EXHAUSTED/i.test(reason)) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "60");
    throw new AppError("GOOGLE_UNAVAILABLE", `google api rate limited (${reason})`, {
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 60_000,
    });
  }
  if (response.status === 403) throw new AppError("GOOGLE_PERMISSION_DENIED", `google api 403 ${reason}`);
  if (response.status === 404) throw new AppError("GOOGLE_PERMISSION_DENIED", "google resource not found");
  if (response.status >= 500) throw new AppError("GOOGLE_UNAVAILABLE", `google api ${response.status}`);
  throw new AppError("GOOGLE_PERMISSION_DENIED", `google api ${response.status} ${reason}`);
}

export async function createSpreadsheet(
  token: string,
  title: string,
  headers: string[],
): Promise<{ spreadsheetId: string; url: string }> {
  const created = await googleRequest<{ spreadsheetId: string; spreadsheetUrl: string }>(SHEETS_API, token, {
    method: "POST",
    body: {
      properties: { title: title.slice(0, 100) },
      sheets: [
        {
          properties: { title: SHEET_TITLE, gridProperties: { frozenRowCount: 1 } },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [{ values: headers.map((header) => ({ userEnteredValue: { stringValue: header.slice(0, 200) } })) }],
            },
          ],
        },
      ],
    },
  });
  return { spreadsheetId: created.spreadsheetId, url: created.spreadsheetUrl };
}

/**
 * Appends one row. `valueInputOption=RAW` stores every value as literal text,
 * so a submission such as "=IMPORTXML(...)" can never execute as a formula.
 */
export async function appendRow(token: string, spreadsheetId: string, values: string[]): Promise<{ updatedRange: string | null }> {
  const range = encodeURIComponent(`${SHEET_TITLE}!A1`);
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const result = await googleRequest<{ updates?: { updatedRange?: string } }>(url, token, {
    method: "POST",
    body: { values: [values.map((value) => value.slice(0, 50_000))] },
  });
  return { updatedRange: result.updates?.updatedRange ?? null };
}

export async function sendGmail(token: string, input: MimeInput): Promise<{ messageId: string }> {
  const raw = toGmailRaw(buildMimeMessage(input));
  const result = await googleRequest<{ id: string }>(GMAIL_SEND, token, { method: "POST", body: { raw } });
  return { messageId: result.id };
}
