/** @jsxImportSource @matecrew/device-ui */
import { Screen, OverlayHost } from "@matecrew/device-ui";

/** Composited by the host over any built-in screen: only the toast ever draws. */
export default function SystemLayer() {
  return (
    <Screen width={800} height={480}>
      <OverlayHost />
    </Screen>
  );
}
