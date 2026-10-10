"use server";

import { getOptionalSession } from "@/lib/auth-utils";
import { commitBatch, expectRows, prisma, retryOnConflict } from "@/lib/prisma";

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
    await retryOnConflict(() => recordThrow(session.user.id, upright));
  }
  return getFlipBoard();
}

/**
 * Reads the player's row, computes the new streak, then writes it in one
 * atomic batch. The guard only updates the row as it was read (same throw
 * count), so two throws landing at once cannot both extend the same streak;
 * the loser reads again. A first throw creates the row, and a concurrent first
 * throw makes it a unique-key conflict, retried the same way.
 */
async function recordThrow(userId: string, upright: boolean): Promise<void> {
  const current = await prisma.flipScore.findUnique({ where: { userId } });
  const landing = upright ? 1 : 0;
  const streak = upright ? (current?.currentStreak ?? 0) + 1 : 0;
  await commitBatch((db) =>
    current
      ? [
          expectRows(
            db.flipScore.updateMany({
              where: { userId, throws: current.throws },
              data: {
                throws: current.throws + 1,
                landings: current.landings + landing,
                currentStreak: streak,
                bestStreak: Math.max(current.bestStreak, streak),
              },
            }),
            1,
          ),
        ]
      : [
          db.flipScore.createMany({
            data: [{ userId, throws: 1, landings: landing, currentStreak: streak, bestStreak: streak }],
          }),
        ],
  );
}
