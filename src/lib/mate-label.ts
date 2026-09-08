/**
 * The artwork that can be wrapped around the 3D can.
 *
 * The first is the default — the logo, the sign-in stage and the dashboard wear
 * it. The games mix them: the bottle flip picks one at random for every round,
 * the shooting gallery for every can of the pyramid.
 */

export interface MateLabel {
  readonly id: string;
  readonly name: string;
  /** Full-size artwork, for the hero. */
  readonly url: string;
  /** Smaller artwork, for logo-sized cans. */
  readonly small: string;
  /**
   * Share of a full turn to rotate the artwork by, when the part that should
   * face the viewer is not at its centre. Positive turns it to the left.
   */
  readonly turn?: number;
}

export const MATE_LABELS: readonly MateLabel[] = [
  {
    id: "el-tony",
    name: "El Tony Mate",
    url: "/textures/el-tony-mate-label.jpg",
    small: "/textures/el-tony-mate-label-sm.jpg",
  },
  {
    id: "el-tony-ginger-red",
    name: "El Tony Mate & Ginger",
    url: "/textures/el-tony-ginger-red-label.jpg",
    small: "/textures/el-tony-ginger-red-label-sm.jpg",
  },
  {
    id: "el-tony-ginger-silver",
    name: "El Tony Mate Ginger (silver)",
    url: "/textures/el-tony-ginger-silver-label.jpg",
    small: "/textures/el-tony-ginger-silver-label-sm.jpg",
  },
];

export const DEFAULT_LABEL = MATE_LABELS[0];
