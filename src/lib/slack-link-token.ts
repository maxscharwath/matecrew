import crypto from "node:crypto";
import { platform } from "@/platform";

export interface SlackLinkPayload {
  slackUserId: string;
  slackUsername: string;
  officeId: string;
  mateSessionId: string | null;
  itemId: string | null;
  date: string;
  responseUrl: string;
  exp: number;
}

const TTL_SECONDS = 600;

function getSecret(): string {
  return platform.env.require("BETTER_AUTH_SECRET");
}

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSlackLinkToken(
  payload: Omit<SlackLinkPayload, "exp">,
): string {
  const secret = getSecret();
  const full: SlackLinkPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifySlackLinkToken(token: string): SlackLinkPayload | null {
  const secret = getSecret();
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, secret);
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as SlackLinkPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
