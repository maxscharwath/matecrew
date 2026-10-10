/** @jsxImportSource ../../authoring */
import { bind } from "../../authoring/jsx-runtime";
import { DeviceChrome, DeviceFooter, KeyBar } from "../../authoring/kit";
import type { IconComponent } from "../../authoring";
import { PackageIcon } from "../../authoring/icons/pixelarticons";
export const data = (key: string, fallback: unknown = "") =>
  bind(`view.${key}`, fallback);
const emit = (name: string) => ({ kind: "emit" as const, name });
export function Chrome({ icon = PackageIcon }: { icon?: IconComponent }) {
  return <DeviceChrome title={data("title")} icon={icon} />;
}
export function Footer() {
  return <DeviceFooter value={data("footer")} />;
}
export function Keys() {
  return (
    <KeyBar
      left={data("left")}
      right={data("right")}
      onLeft={emit("left")}
      onRight={emit("right")}
    />
  );
}
