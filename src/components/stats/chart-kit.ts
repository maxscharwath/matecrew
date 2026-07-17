"use client";

import { useEffect, useState } from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

ChartJS.defaults.font.family =
  'system-ui, -apple-system, "Segoe UI", sans-serif';
ChartJS.defaults.font.size = 11;

/**
 * Categorical series palette, validated with the dataviz palette validator
 * against the app's card surfaces (light #ffffff / dark #171717).
 * Fixed slot order — never cycle or reshuffle.
 */
const SERIES_LIGHT = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
];
const SERIES_DARK = [
  "#3987e5",
  "#008300",
  "#d55181",
  "#c98500",
  "#199e70",
  "#d95926",
];

export interface ChartTheme {
  series: string[];
  /** De-emphasis gray for "context" series. */
  deemphasis: string;
  /** Card surface — used for the 2px gaps between touching marks. */
  surface: string;
  grid: string;
  mutedText: string;
  secondaryText: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

const LIGHT: ChartTheme = {
  series: SERIES_LIGHT,
  deemphasis: "#c3c2b7",
  surface: "#ffffff",
  grid: "#e5e5e3",
  mutedText: "#898781",
  secondaryText: "#52514e",
  tooltipBg: "#ffffff",
  tooltipBorder: "#e1e0d9",
  tooltipText: "#0b0b0b",
};

const DARK: ChartTheme = {
  series: SERIES_DARK,
  deemphasis: "#3f3f3d",
  surface: "#171717",
  grid: "#2c2c2a",
  mutedText: "#898781",
  secondaryText: "#c3c2b7",
  tooltipBg: "#232322",
  tooltipBorder: "#383835",
  tooltipText: "#ffffff",
};

/** Follows the app's `.dark` class on <html> (shadcn convention). */
export function useChartTheme(): ChartTheme {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark ? DARK : LIGHT;
}

/** Shared tooltip styling so every chart's hover layer reads the same. */
export function tooltipOptions(theme: ChartTheme) {
  return {
    backgroundColor: theme.tooltipBg,
    borderColor: theme.tooltipBorder,
    borderWidth: 1,
    titleColor: theme.tooltipText,
    bodyColor: theme.secondaryText,
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true,
  } as const;
}

/** Shared legend styling — rounded swatches, text in ink (never series color). */
export function legendOptions(theme: ChartTheme) {
  return {
    position: "bottom" as const,
    labels: {
      color: theme.secondaryText,
      usePointStyle: true,
      pointStyle: "rectRounded" as const,
      boxWidth: 8,
      boxHeight: 8,
      padding: 16,
    },
  };
}
