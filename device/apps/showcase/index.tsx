/** @jsxImportSource @matecrew/device-ui */
import { Screen, Router, Route, OverlayHost, useDeviceTheme } from "@matecrew/device-ui";
import { Home, TypeScale, Components } from "./overview";
import { LayoutPage, Charts } from "./charts";
import { Icons, Media } from "./media";
import { Logic, Themes, Hardware } from "./interactive";
import { TitleBar } from "./shared";

/** The kit, page by page: the keys walk through, taps open a page from the home menu. */
export default function ShowcaseApp() {
  const [, setTheme] = useDeviceTheme("paper");
  return (
    <Screen>
      <TitleBar />
      <Router initial="home">
        <Route name="home"><Home /></Route>
        <Route name="type"><TypeScale /></Route>
        <Route name="components"><Components /></Route>
        <Route name="layout"><LayoutPage /></Route>
        <Route name="charts"><Charts /></Route>
        <Route name="icons"><Icons /></Route>
        <Route name="media"><Media /></Route>
        <Route name="logic"><Logic /></Route>
        <Route name="themes"><Themes change={setTheme} /></Route>
        <Route name="hardware"><Hardware /></Route>
      </Router>
      <OverlayHost />
    </Screen>
  );
}
