import { getTranslations } from "next-intl/server";
import { getFlipBoard } from "@/app/can/actions";
import { MateCanFlip } from "@/components/mate-can-flip";
import { getOptionalSession } from "@/lib/auth-utils";

/**
 * The bottle-flip challenge: the 3D El Tony Mate can, a third full, on a
 * table in the brand green — with the scoreboard for everyone who has played.
 *
 * The can model is "Canette" by oliviergillet206 (Sketchfab), CC-BY-4.0 — the
 * credit below is a condition of the licence.
 */
export default async function CanPage() {
  const [t, session, board] = await Promise.all([
    getTranslations("can"),
    getOptionalSession(),
    getFlipBoard(),
  ]);
  return (
    <main className="stage-gradient relative h-screen w-screen">
      <h1 className="sr-only">{t("title")}</h1>
      <MateCanFlip board={board} signedIn={session !== null} />
      <p className="pointer-events-none absolute right-4 bottom-2 text-[11px] text-white/40">
        3D model:{" "}
        <a
          className="pointer-events-auto underline"
          href="https://sketchfab.com/3d-models/canette-20eb5b043555496d9efb02312aa8887e"
          rel="noreferrer"
          target="_blank"
        >
          Canette
        </a>{" "}
        by oliviergillet206, CC-BY-4.0
      </p>
    </main>
  );
}
