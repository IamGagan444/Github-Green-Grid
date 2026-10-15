import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Click-tracking redirect for links sent in Instagram DMs. Resolves the event
 * to its automation's *current* link, so editing the link fixes DMs already sent.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params;
  if (!/^[a-z0-9]{10,40}$/i.test(eventId)) return NextResponse.redirect(getAppUrl());

  const event = await prisma.instagramEvent.findUnique({
    where: { id: eventId },
    select: { automation: { select: { id: true, linkUrl: true } } },
  });
  const automation = event?.automation;
  if (!automation?.linkUrl || !/^https:\/\//i.test(automation.linkUrl)) return NextResponse.redirect(getAppUrl());

  await prisma.instagramAutomation
    .update({ where: { id: automation.id }, data: { clickCount: { increment: 1 } } })
    .catch(() => undefined);
  return NextResponse.redirect(automation.linkUrl, { status: 302 });
}
