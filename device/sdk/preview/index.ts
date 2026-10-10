/** Preview authoring: name the states an app should be drawn in. `dui render`, `dui test` and `dui dev` draw every one. */
import type { PreviewSpec } from "./engine";
export type { PreviewEvent, PreviewSpec } from "./engine";

export type Preview = PreviewSpec & {
  /** For multi-screen apps: which exported screen to draw. */
  screen?: string;
  /** One line shown under the preview in the studio and contact sheets. */
  description?: string;
  /**
   * Studio only: the preview to show next when the app emits an event (`left`, `right`…) or the
   * badge reader fires while nothing in the app is bound to it. Stands in for the host's flow.
   */
  on?: Record<string, string>;
};
export type Previews = Record<string, Preview>;

export function definePreviews<const T extends Previews>(previews: T): T {
  return previews;
}
