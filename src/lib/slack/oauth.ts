import "server-only";

import { getAppUrl, getSlackConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { callSlack } from "@/lib/slack/client";

export function getSlackRedirectUri(): string {
  return `${getAppUrl()}/api/integrations/slack/callback`;
}

/**
 * One consent screen grants both identities: bot scopes ("Post as GreenGrid
 * app") and user scopes ("Post as me"), so a single Connect enables both.
 */
export function buildSlackAuthorizeUrl(state: string): string {
  const config = getSlackConfig();
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", config.botScopes.join(","));
  if (config.userScopes.length > 0) {
    url.searchParams.set("user_scope", config.userScopes.join(","));
  }
  url.searchParams.set("redirect_uri", getSlackRedirectUri());
  url.searchParams.set("state", state);
  return url.toString();
}

export interface SlackTokenGrant {
  teamId: string;
  teamName: string;
  appId: string | null;
  authedUserId: string;
  botUserId: string | null;
  bot: TokenBundle | null;
  user: TokenBundle | null;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  scopes: string[];
}

interface OAuthV2Response {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name: string } | null;
  authed_user?: {
    id: string;
    scope?: string;
    access_token?: string;
    token_type?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  [key: string]: unknown;
}

function splitScopes(scope: string | undefined): string[] {
  return scope ? scope.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
}

/** Exchanges the authorization code. Client credentials go in the body, never a URL. */
export async function exchangeSlackCode(code: string): Promise<SlackTokenGrant> {
  const config = getSlackConfig();

  let data: OAuthV2Response;
  try {
    data = await callSlack<OAuthV2Response>("oauth.v2.access", null, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: getSlackRedirectUri(),
    });
  } catch (error) {
    throw new AppError("SLACK_OAUTH_FAILED", "slack oauth.v2.access exchange failed", { cause: error });
  }

  if (!data.team?.id || !data.authed_user?.id) {
    throw new AppError("SLACK_OAUTH_FAILED", "slack oauth response missing team or user");
  }

  const bot: TokenBundle | null =
    data.access_token && data.token_type === "bot"
      ? {
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? null,
          expiresInSeconds: data.expires_in ?? null,
          scopes: splitScopes(data.scope),
        }
      : null;

  const authed = data.authed_user;
  const user: TokenBundle | null = authed.access_token
    ? {
        accessToken: authed.access_token,
        refreshToken: authed.refresh_token ?? null,
        expiresInSeconds: authed.expires_in ?? null,
        scopes: splitScopes(authed.scope),
      }
    : null;

  if (!bot) throw new AppError("SLACK_OAUTH_FAILED", "slack oauth response missing bot token");

  return {
    teamId: data.team.id,
    teamName: data.team.name,
    appId: data.app_id ?? null,
    authedUserId: authed.id,
    botUserId: data.bot_user_id ?? null,
    bot,
    user,
  };
}

/** Refreshes a rotating Slack token (only used when token rotation is enabled). */
export async function refreshSlackToken(refreshToken: string): Promise<TokenBundle> {
  const config = getSlackConfig();
  const data = await callSlack<OAuthV2Response>("oauth.v2.access", null, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  if (!data.access_token) throw new AppError("SLACK_TOKEN_REVOKED", "slack token refresh returned no token");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresInSeconds: data.expires_in ?? null,
    scopes: splitScopes(data.scope),
  };
}
