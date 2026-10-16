#!/usr/bin/env node
/**
 * Registers GreenGrid's Telegram webhook and the bot's command menu.
 *
 *   npm run telegram:set-webhook            # uses NEXT_PUBLIC_APP_URL
 *   npm run telegram:set-webhook -- https://your-tunnel.example.com
 *   npm run telegram:set-webhook -- --delete
 *
 * Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and NEXT_PUBLIC_APP_URL
 * from the environment (`.env` is loaded by the npm script via --env-file).
 * Telegram sends the secret back in X-Telegram-Bot-Api-Secret-Token on every
 * update; /api/webhooks/telegram rejects requests without it.
 */

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const args = process.argv.slice(2);
const remove = args.includes("--delete");
const baseUrl = (args.find((arg) => arg.startsWith("http")) ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!token) fail("TELEGRAM_BOT_TOKEN is not set.");
if (!remove) {
  if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    fail("TELEGRAM_WEBHOOK_SECRET must be 16-256 characters of A-Z, a-z, 0-9, _ or -.");
  }
  if (!baseUrl.startsWith("https://")) fail("The webhook URL must be https:// (pass one as an argument or set NEXT_PUBLIC_APP_URL).");
}

async function call(method, params) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!payload.ok) fail(`${method} failed: ${payload.description ?? response.status}`);
  return payload.result;
}

if (remove) {
  await call("deleteWebhook", { drop_pending_updates: false });
  console.log("✔ Webhook removed.");
  process.exit(0);
}

const url = `${baseUrl}/api/webhooks/telegram`;
await call("setWebhook", {
  url,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  max_connections: 20,
  drop_pending_updates: false,
});
await call("setMyCommands", {
  commands: [
    { command: "digest", description: "Send today's digest now" },
    { command: "stop", description: "Disconnect this chat from GreenGrid" },
    { command: "help", description: "What this bot does" },
  ],
});

const info = await call("getWebhookInfo", {});
console.log(`✔ Webhook set to ${info.url}`);
if (info.last_error_message) console.log(`  Last delivery error reported by Telegram: ${info.last_error_message}`);
