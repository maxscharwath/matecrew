/** @jsxImportSource ../runtime */
import { HStack, type Element } from "../runtime/jsx-runtime";
import { createArt } from "../icons/factory";
import { Styled } from "./typography";
import type { TypeName } from "./tokens";

/**
 * The matécrew mark, as the site draws it (src/components/matecrew-logo.tsx): a gourd, its
 * collar and the bombilla. Filled shapes, so it holds at 16 px and at 160.
 */
export const MateCrewMark = createArt([
  { nodes: [["path", { d: "M14.9 6.6 20.4 2.2" }]], stroke: 2.1 },
  {
    nodes: [
      ["circle", { cx: 11.6, cy: 14.8, r: 6.9 }],
      ["rect", { x: 10.2, y: 4.9, width: 5.2, height: 4.6, rx: 1.6, transform: "rotate(12 12.8 7.2)" }],
    ],
    fill: true,
  },
]);

/** Mark and name, side by side; `size` is the mark's side. */
export function Logo({ size = 48, style = "title" }: { size?: number; style?: TypeName }): Element {
  return (
    <HStack gap={Math.round(size / 4)} align="center">
      <MateCrewMark size={size} />
      <Styled style={style}>matécrew</Styled>
    </HStack>
  );
}
