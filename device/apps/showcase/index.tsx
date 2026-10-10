/** @jsxImportSource ../../authoring */
import {
  Screen,
  Router,
  Route,
  OverlayHost,
  useDeviceTheme,
} from "../../authoring";
import { Home, Components } from "./overview";
import { Charts, Areas } from "./charts";
import { Icons, Media } from "./media";
import { Themes, State, Hardware } from "./interactive";
export default function ShowcaseApp() {
  const [, setTheme] = useDeviceTheme("flipper");
  return (
    <Screen width={400} height={240}>
      <Router width={400} height={240} initial="home">
        <Route name="home">
          <Home />
        </Route>
        <Route name="components">
          <Components />
        </Route>
        <Route name="charts">
          <Charts />
        </Route>
        <Route name="area">
          <Areas />
        </Route>
        <Route name="icons">
          <Icons />
        </Route>
        <Route name="media">
          <Media />
        </Route>
        <Route name="themes">
          <Themes change={setTheme} />
        </Route>
        <Route name="state">
          <State />
        </Route>
        <Route name="hardware">
          <Hardware />
        </Route>
      </Router>
      <OverlayHost />
    </Screen>
  );
}
