"use client";

import { Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState, useTransition } from "react";
import { type FlipBoard, recordFlip } from "@/app/can/actions";
import { MateCan } from "@/components/mate-can";
import type { KnockdownReport } from "@/components/mate-can-3d";
import { MATE_LABELS } from "@/lib/mate-label";
import { cn } from "@/lib/utils";

interface Props {
  readonly board: FlipBoard;
  readonly signedIn: boolean;
}

type Game = "flip" | "knockdown";

/**
 * The games: the bottle flip and the can pyramid, on one stage, with the
 * scores and the flip leaderboard. The scene only reports outcomes; what they
 * mean — points, streak, standing — is decided here and, for signed-in players
 * of the flip, on the server. Anonymous visitors play with a local tally.
 */
export function MateCanFlip({ board: initial, signedIn }: Props) {
  const t = useTranslations("can");
  const [game, setGame] = useState<Game>("flip");
  const [board, setBoard] = useState(initial);
  // Local tallies for this session — instant feedback, and all an anonymous
  // player gets.
  const [flip, setFlip] = useState({ landings: 0, throws: 0, streak: 0 });
  /** The last throw stood without turning over: a lift-and-drop, not a flip. */
  const [noFlip, setNoFlip] = useState(false);
  const [knock, setKnock] = useState<KnockdownReport | null>(null);
  const [knockTotal, setKnockTotal] = useState(0);
  const [, startSaving] = useTransition();

  const onLand = useCallback(
    (upright: boolean, flipped: boolean) => {
      // Standing only counts after a real flip; set down gently, it's a miss.
      const landed = upright && flipped;
      setNoFlip(upright && !flipped);
      setFlip((s) => ({
        landings: s.landings + (landed ? 1 : 0),
        throws: s.throws + 1,
        streak: landed ? s.streak + 1 : 0,
      }));
      if (signedIn) {
        startSaving(async () => setBoard(await recordFlip(landed)));
      }
    },
    [signedIn],
  );

  const onReport = useCallback((report: KnockdownReport) => {
    setKnock(report);
    if (report.result) setKnockTotal((n) => n + report.down);
  }, []);

  const me = board.me;
  const myRank = me ? board.top.findIndex((s) => s.userId === me.userId) : -1;

  return (
    <>
      {/* Keyed on the game so switching rebuilds the physics world clean. */}
      <MateCan
        key={game}
        className="absolute inset-0"
        mode={game}
        intro={game === "flip"}
        labels={MATE_LABELS}
        onLand={onLand}
        onReport={onReport}
      />

      {/* Score and hint sit over the empty air above the scene, never on it. */}
      <div className="pointer-events-none absolute inset-x-0 top-5 flex flex-col items-center gap-2 text-center text-sm text-white/60">
        <div
          role="tablist"
          className="pointer-events-auto flex rounded-full bg-black/25 p-1 backdrop-blur-sm"
        >
          {(["flip", "knockdown"] as const).map((option) => (
            <button
              key={option}
              role="tab"
              type="button"
              aria-selected={game === option}
              onClick={() => setGame(option)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                game === option
                  ? "bg-white text-black"
                  : "text-white/80 hover:text-white",
              )}
            >
              {t(option === "flip" ? "gameFlip" : "gameKnockdown")}
            </button>
          ))}
        </div>
        {game === "flip" ? (
          <>
            <p className="text-4xl font-semibold text-white tabular-nums">
              {t("points", { points: me ? me.landings : flip.landings })}
            </p>
            <p className="text-white/80 tabular-nums">
              {t("score", { landed: flip.landings, throws: flip.throws })}
              {" · "}
              {t("streak", {
                streak: me ? me.currentStreak : flip.streak,
                best: me ? me.bestStreak : flip.streak,
              })}
              {myRank >= 0 && ` · ${t("rank", { rank: myRank + 1 })}`}
            </p>
            <p className={cn(noFlip && "font-medium text-white")}>
              {noFlip ? t("noFlip") : t("flipHint")}
            </p>
          </>
        ) : (
          <>
            <p className="text-4xl font-semibold text-white tabular-nums">
              {t("knockScore", {
                down: knock?.down ?? 0,
                total: knock?.total ?? 6,
              })}
            </p>
            <p className="text-white/80 tabular-nums">
              {t("knockLevel", { level: knock?.level ?? 1, rows: knock?.rows ?? 3 })}
              {" · "}
              {t("knockShots", { shots: knock?.shotsLeft ?? 5 })}
              {" · "}
              {t("points", { points: knockTotal })}
            </p>
            <p className={cn(knock?.result && "font-medium text-white")}>
              {knock?.result === "cleared"
                ? t("knockCleared")
                : knock?.result === "failed"
                  ? t("knockFailed", { down: knock.down, total: knock.total })
                  : t("knockHint")}
            </p>
          </>
        )}
      </div>

      {game === "flip" && (
        <aside className="absolute top-4 right-4 w-64 rounded-xl bg-black/25 p-3 text-white backdrop-blur-sm">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-white/70 uppercase">
            <Trophy className="size-3.5" aria-hidden="true" />
            {t("leaderboard")}
          </p>
          {board.top.length === 0 ? (
            <p className="text-sm text-white/60">{t("leaderboardEmpty")}</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {board.top.map((standing, index) => (
                <li
                  key={standing.userId}
                  className={cn(
                    "flex items-baseline gap-2 rounded px-1.5 py-0.5",
                    standing.userId === me?.userId && "bg-white/15",
                  )}
                >
                  <span className="w-4 text-right text-white/50 tabular-nums">
                    {index + 1}
                  </span>
                  <span className="flex-1 truncate">{standing.name}</span>
                  <span className="font-medium tabular-nums">
                    {standing.landings}
                  </span>
                  <span className="text-xs text-white/50 tabular-nums">
                    {t("streakShort", { streak: standing.bestStreak })}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {!signedIn && (
            <p className="mt-2 text-xs text-white/60">{t("signInToSave")}</p>
          )}
        </aside>
      )}
    </>
  );
}
