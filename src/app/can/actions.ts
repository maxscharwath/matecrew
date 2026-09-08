"use server";

import { getOptionalSession } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

/**
 * The bottle-flip scoreboard.
 *
 * Every throw that comes to rest is recorded against the signed-in player:
 * landings are the score, throws give the odds, and the streak is the run of
 * landings without a miss. Anonymous visitors can still play; nothing is saved
 * for them.
 */

export interface FlipStanding {
  readonly userId: string;
  readonly name: string;
  readonly landings: number;
  readonly throws: number;
  readonly bestStreak: number;
}

export interface FlipBoard {
  /** The signed-in player's own row, if any. */
  readonly me: (FlipStanding & { readonly currentStreak: number }) | null;
  /** The best players, most landings first. */
  readonly top: readonly FlipStanding[];
}

const TOP_SIZE = 10;

const standing = (row: {
  userId: string;
  landings: number;
  throws: number;
  bestStreak: number;
  user: { name: string };
}): FlipStanding => ({
  userId: row.userId,
  name: row.user.name,
  landings: row.landings,
  throws: row.throws,
  bestStreak: row.bestStreak,
});

export async function getFlipBoard(): Promise<FlipBoard> {
  const session = await getOptionalSession();
  const [top, me] = await Promise.all([
    prisma.flipScore.findMany({
      orderBy: [{ landings: "desc" }, { bestStreak: "desc" }, { throws: "asc" }],
      take: TOP_SIZE,
      include: { user: { select: { name: true } } },
    }),
    session
      ? prisma.flipScore.findUnique({
          where: { userId: session.user.id },
          include: { user: { select: { name: true } } },
        })
      : null,
  ]);
  return {
    me: me ? { ...standing(me), currentStreak: me.currentStreak } : null,
    top: top.map(standing),
  };
}

/**
 * Records one finished throw for the signed-in player and returns the fresh
 * board. Returns the board unchanged for an anonymous player.
 */
export async function recordFlip(upright: boolean): Promise<FlipBoard> {
  const session = await getOptionalSession();
  if (session) {
    const userId = session.user.id;
    await prisma.$transaction(async (tx) => {
      const current = await tx.flipScore.findUnique({ where: { userId } });
      const streak = upright ? (current?.currentStreak ?? 0) + 1 : 0;
      await tx.flipScore.upsert({
        where: { userId },
        create: {
          userId,
          throws: 1,
          landings: upright ? 1 : 0,
          currentStreak: streak,
          bestStreak: streak,
        },
        update: {
          throws: { increment: 1 },
          landings: { increment: upright ? 1 : 0 },
          currentStreak: streak,
          bestStreak: Math.max(current?.bestStreak ?? 0, streak),
        },
      });
    });
  }
  return getFlipBoard();
}
