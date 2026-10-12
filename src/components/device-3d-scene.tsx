"use client";

import {
  ContactShadows,
  Environment,
  Html,
  Lightformer,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Box, Download, Layers, Nfc, Volume2, VolumeX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as THREE from "three";
import { paintFrame, PANEL_HEIGHT, PANEL_WIDTH } from "@/components/device-console/frame-bits";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VirtualBuzzer } from "@matecrew/device-ui/emulator";
import { DemoTerminal, type DemoOffice } from "@/lib/device/virtual/demo";
import type { Side } from "@/lib/device/virtual/wasm";
import { cn } from "@/lib/utils";

/**
 * The terminal in 3D, as built: its parts come from the Fusion model
 * (device/hardware/boitier_matecrew), printed parts as exported, the boards and
 * the panel as their makers modelled them, with the silkscreen we draw on them,
 * screws, inserts and magnets after their standards, one mesh each, instanced.
 * The makers' models may not be redistributed: the GLB
 * (assets/models/matecrew-terminal.glb, meshopt) is served to signed-in users
 * only, by src/app/api/models/terminal/route.ts. It is in metres, in the
 * device's own frame: x right, y up, z out of the screen, z = 0 on its back. One
 * node per layer, each with its explode offset in its extras; the scene tilts it
 * onto its stand.
 *
 * The panel shows a live frame: the terminal's firmware screens in WebAssembly,
 * either the page's own terminal (`screen`) or, without one, a demo terminal
 * started here with made-up data and no request to the site. Until the first
 * frame, the snapshot of its main screen. The black dots and the badge pad on
 * the face are its keys and its reader.
 *
 * Exploding runs in two steps: the device lifts off its stand, clear of the back
 * rest, then its thirteen layers part along its depth while the orbit swings
 * round to the back, where the boards show. Rendering is on demand: nothing
 * draws while nothing moves.
 */

const MODEL_URL = "/api/models/terminal";
/** The main screen as the snapshot tests draw it (device/apps/mate/__snapshots__/stock.png). */
const SCREEN_FALLBACK_URL = "/models/matecrew-screen.png";
/** Seconds for a full explode or assembly. */
const DURATION = 1.8;
/** The lift takes this share of the animation; the layers start parting before it ends. */
const LIFT_SHARE = 0.4;
const SPREAD_START = 0.28;
const CAMERA = { position: [0.24, 0.24, 0.34] as const, fov: 30 };
const TARGET_ASSEMBLED = new THREE.Vector3(0, 0.075, -0.01);
const TARGET_EXPLODED = new THREE.Vector3(-0.03, 0.13, -0.06);
/** Narrower than this, the view widens (camera zoom under 1) so the device keeps its sides. */
const WIDE = 1.35;
/** Camera distance when exploded, relative to assembled. */
const DOLLY = 2;
/** The orbit turns this far as the device comes apart (radians): from its front to its back. */
const SWING = 1.65;
/**
 * Exploded, the orbit swings round behind the device, where the boards are: the
 * layers part along the depth and step up towards the front, a little, so that
 * from up there each one shows above the one nearer the camera.
 */
const RISE = 0.3;

const LAYERS = [
  "facade",
  "inlays",
  "keys",
  "screen",
  "chassis",
  "driver",
  "xiao",
  "nfc",
  "battery",
  "cover",
  "screws",
  "magnets",
  "stand",
] as const;
type LayerName = (typeof LAYERS)[number];

/** A frame source shared with the page: its terminal's panel and inputs. */
export type Device3DScreen = {
  /** 800 x 480, packed 1-bit, 1 = ink; null until the first frame. */
  bits: Uint8Array | null;
  onKey?: (side: Side) => void;
  onBadge?: () => void;
};

export interface Device3DSceneProps {
  /** The page's terminal; without it the scene runs its own demo terminal. */
  readonly screen?: Device3DScreen;
  /** What the demo terminal shows: a real office's state and account, else made-up data. */
  readonly office?: DemoOffice;
  readonly className?: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const liftOf = (p: number) => ease(clamp01(p / LIFT_SHARE));
const spreadOf = (p: number) => ease(clamp01((p - SPREAD_START) / (1 - SPREAD_START)));

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

// ─── Screen ───────────────────────────────────────────────

/**
 * Frames for the panel: the page's terminal when it has one, else a demo terminal
 * started on mount (it fetches the firmware's WebAssembly then) and stopped on unmount.
 * The demo's beeps play on the page's speakers, as the buzzer would sound them; a
 * shared terminal has its own buzzer on its page.
 */
function useScreen(shared: Device3DScreen | undefined, office: DemoOffice | undefined, sound: boolean) {
  const t = useTranslations("devices.terminal3d.demo");
  const locale = useLocale();
  const [demo, setDemo] = useState<DemoTerminal | null>(null);
  const buzzer = useRef<VirtualBuzzer | null>(null);
  const standalone = shared === undefined;

  useEffect(() => {
    if (!standalone) return;
    let current: DemoTerminal | null = null;
    let cancelled = false;
    const player = new VirtualBuzzer();
    buzzer.current = player;
    DemoTerminal.start(
      {
        take: t("take"),
        account: t("account"),
        lowLabel: t("lowLabel"),
        moreLabel: t("moreLabel"),
        chartLabel: t("chartLabel"),
        holder: t("holder"),
      },
      locale,
      office,
    )
      .then((terminal) => {
        if (cancelled) return terminal.dispose();
        current = terminal;
        terminal.setBeep((tones) => player.play(tones));
        setDemo(terminal);
      })
      .catch(() => {
        // No WebAssembly: the snapshot stays on the panel.
      });
    return () => {
      cancelled = true;
      current?.dispose();
      player.dispose();
      buzzer.current = null;
      setDemo(null);
    };
  }, [standalone, t, locale, office]);

  useEffect(() => {
    buzzer.current?.setEnabled(sound);
  }, [sound, demo]);

  const demoBits = useSyncExternalStore(
    demo?.subscribe ?? noSubscribe,
    () => demo?.getSnapshot() ?? null,
    () => null,
  );
  /** Browsers start audio only from a gesture: the pointer going down on the view. */
  const unlock = () => {
    void buzzer.current?.unlock().catch(() => {});
  };
  if (shared) return { ...shared, live: shared.bits !== null, standalone, unlock };
  return {
    bits: demoBits,
    live: demoBits !== null,
    standalone,
    unlock,
    onKey: demo ? (side: Side) => demo.press(side) : undefined,
    onBadge: demo ? () => demo.tap() : undefined,
  };
}
const noSubscribe = () => () => {};

/**
 * The panel's texture: an 800 x 480 canvas, the snapshot until the first frame, then
 * every frame as the console paints it (warm paper, near-black ink).
 */
class PanelCanvas {
  readonly texture: THREE.CanvasTexture;
  private readonly context: CanvasRenderingContext2D | null;
  private framed = false;

  constructor(anisotropy: number) {
    const canvas = document.createElement("canvas");
    canvas.width = PANEL_WIDTH;
    canvas.height = PANEL_HEIGHT;
    this.context = canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
  }

  /** Draws a frame; true when the texture changed. */
  frame(bits: Uint8Array): boolean {
    if (!this.context) return false;
    this.framed = true;
    paintFrame(this.context, bits);
    this.texture.needsUpdate = true;
    return true;
  }

  /** The snapshot, unless a frame came first. */
  snapshot(image: HTMLImageElement): boolean {
    if (!this.context || this.framed) return false;
    this.context.drawImage(image, 0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    this.texture.needsUpdate = true;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

function useScreenTexture(bits: Uint8Array | null): THREE.CanvasTexture {
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);
  const panel = useMemo(() => new PanelCanvas(gl.capabilities.getMaxAnisotropy()), [gl]);
  useEffect(() => () => panel.dispose(), [panel]);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      if (panel.snapshot(image)) invalidate();
    };
    image.src = SCREEN_FALLBACK_URL;
  }, [panel, invalidate]);
  useEffect(() => {
    if (bits && panel.frame(bits)) invalidate();
  }, [bits, panel, invalidate]);
  return panel.texture;
}

// ─── Materials ────────────────────────────────────────────

/**
 * Layer lines for the printed walls: 0.2 mm ridges, 50 to a texture that the GLB's
 * UVs repeat every 10 mm along the print's up axis. Each layer gets a slightly
 * different width, as an extruder lays them; far away the mipmaps flatten it out.
 */
function layerLinesTexture(): THREE.CanvasTexture {
  const width = 16;
  const height = 512;
  const layers = 50;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(width, height);
  const bulge = Array.from({ length: layers }, (_, i) => 0.75 + 0.25 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1));
  const heightAt = (y: number) => {
    const v = (y / height) * layers;
    const layer = Math.floor(v) % layers;
    return Math.sin(Math.PI * (v - Math.floor(v))) ** 0.6 * bulge[layer];
  };
  for (let y = 0; y < height; y++) {
    const slope = (heightAt(y + 1) - heightAt(y - 1)) * 0.9;
    const n = new THREE.Vector3(0, -slope, 1).normalize();
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      image.data[i] = Math.round((n.x * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/**
 * Physical looks per material, keyed by the GLB's names. PLA has a soft sheen and
 * its layer lines on the walls; solder masks, the e-paper's front sheet and the
 * kapton have a thin coat over a rougher base; metals take the room's light. The
 * panel shows the live texture, with no glow of its own: e-paper only reflects.
 */
const LOOKS: Record<string, THREE.MeshPhysicalMaterialParameters> = {
  "pla-white": { roughness: 0.58, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color("#ffffff"), specularIntensity: 0.6 },
  "pla-white-flat": { roughness: 0.5, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color("#ffffff"), specularIntensity: 0.6 },
  "pla-black": { roughness: 0.55, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color("#5a5a5e") },
  "pla-black-flat": { roughness: 0.45, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color("#5a5a5e") },
  "pcb-red": { roughness: 0.6, clearcoat: 0.9, clearcoatRoughness: 0.28 },
  "pcb-red-trace": { roughness: 0.5, clearcoat: 0.9, clearcoatRoughness: 0.25 },
  "pcb-black": { roughness: 0.6, clearcoat: 0.9, clearcoatRoughness: 0.3 },
  "ic-black": { roughness: 0.7, clearcoat: 0.15, clearcoatRoughness: 0.6 },
  glass: { roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 },
  "epaper-border": { roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.45 },
  screen: { roughness: 0.75, clearcoat: 0.18, clearcoatRoughness: 0.5 },
  kapton: { roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.15 },
  fpc: { roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.2 },
  pouch: { roughness: 0.32, anisotropy: 0.5, envMapIntensity: 1.2 },
  gold: { envMapIntensity: 1.3 },
  brass: { envMapIntensity: 1.3 },
  nickel: { envMapIntensity: 1.4 },
  steel: { envMapIntensity: 1.2 },
  shield: { envMapIntensity: 1.2 },
  "plastic-white": { roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 },
  ceramic: { roughness: 0.75 },
  "led-amber": { roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 },
  "dip-red": { roughness: 0.45, clearcoat: 0.3 },
  "panel-back": { roughness: 0.45, envMapIntensity: 1.1 },
  ffc: { roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.4 },
  "ffc-panel": { roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 },
};
/** The boards' prints, laid over their faces: ink on a solder mask's clear coat. */
const PRINT: THREE.MeshPhysicalMaterialParameters = { roughness: 0.6, clearcoat: 0.9, clearcoatRoughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 };

function dressMaterials(root: THREE.Object3D, screen: THREE.Texture, lines: THREE.Texture) {
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as THREE.MeshStandardMaterial;
    mesh.castShadow = source.name !== "screen";
    mesh.receiveShadow = true;
    let material = cache.get(source);
    if (!material) {
      const next = new THREE.MeshPhysicalMaterial({
        name: source.name,
        color: source.color,
        metalness: source.metalness,
        roughness: source.roughness,
        map: source.map,
        transparent: source.transparent,
        depthWrite: source.depthWrite,
        ...(source.name.startsWith("decal-") ? PRINT : LOOKS[source.name]),
      });
      if (source.name.startsWith("decal-")) mesh.castShadow = false;
      if (source.name === "pla-white" || source.name === "pla-black") {
        next.normalMap = lines;
        next.normalScale = new THREE.Vector2(0.35, 0.35);
      } else if (source.name === "screen") {
        next.map = screen;
        next.color = new THREE.Color("#ffffff");
      }
      cache.set(source, next);
      material = next;
    }
    mesh.material = material;
  });
}

// ─── Model ────────────────────────────────────────────────

type Layer = {
  name: LayerName;
  node: THREE.Object3D;
  explode: THREE.Vector3;
  lift: number;
  label: THREE.Vector3;
};
type Hit = { name: "key-left" | "key-right" | "badge-pad"; position: THREE.Vector3; radius?: number; width?: number; height?: number };

function useTerminalModel(screen: THREE.Texture) {
  const { scene } = useGLTF(MODEL_URL, undefined, true);
  return useMemo(() => {
    const root = scene.clone(true);
    const lines = layerLinesTexture();
    dressMaterials(root, screen, lines);
    const vector = (value: unknown) => new THREE.Vector3(...((value as [number, number, number] | undefined) ?? [0, 0, 0]));
    const layers: Layer[] = LAYERS.map((name) => {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`matecrew-terminal.glb: no layer ${name}`);
      return {
        name,
        node,
        explode: vector(node.userData.explode),
        lift: Number(node.userData.lift ?? 0),
        label: vector(node.userData.label),
      };
    });
    const hits: Hit[] = (["key-left", "key-right", "badge-pad"] as const).map((name) => {
      const node = root.getObjectByName(name)!;
      return { name, position: node.position.clone(), ...(node.userData as { radius?: number; width?: number; height?: number }) };
    });
    const extras = root.userData as { tilt?: number; floor?: number };
    return { layers, hits, tilt: extras.tilt ?? 0, floor: extras.floor ?? 0 };
  }, [scene, screen]);
}

/** Explode progress: where it is, where it goes, and whether it eases there or jumps. */
class Motion {
  current = 0;
  private target = 0;
  private animate = true;

  to(target: number, animate: boolean): void {
    this.target = target;
    this.animate = animate;
  }

  /** Moves on by `delta` seconds; true while it has not arrived. */
  step(delta: number): boolean {
    if (this.current === this.target) return false;
    const step = this.animate ? Math.min(delta, 1 / 20) / DURATION : 1;
    this.current =
      this.target > this.current ? Math.min(this.target, this.current + step) : Math.max(this.target, this.current - step);
    return true;
  }
}

function Terminal({ motion, screen }: Readonly<{ motion: Motion; screen: Device3DScreen }>) {
  const texture = useScreenTexture(screen.bits);
  const { layers, hits, tilt, floor } = useTerminalModel(texture);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const controls = useThree((state) => state.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const invalidate = useThree((state) => state.invalidate);
  const shown = useRef(-1);

  useFrame(({ camera, size }, delta) => {
    if (motion.step(delta)) invalidate();
    const zoom = Math.min(1, size.width / size.height / WIDE);
    if (camera.zoom !== zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    const p = motion.current;
    if (p === shown.current) return;
    const lift = liftOf(p);
    const spread = spreadOf(p);
    const back = Math.min(...layers.map((layer) => layer.explode.z));
    layers.forEach((layer, i) => {
      const group = groups.current[i];
      if (!group) return;
      const rise = layer.name === "stand" ? 0 : (layer.explode.z - back) * RISE * spread;
      group.position.set(0, layer.lift * lift + rise, 0).addScaledVector(layer.explode, spread);
      const label = labelRefs.current[i];
      if (label) {
        const opacity = clamp01((spread - 0.55) / 0.35);
        label.style.opacity = String(opacity);
        label.style.visibility = opacity > 0 ? "visible" : "hidden";
      }
    });
    // Follow the model as it grows: the orbit keeps its direction, its distance scales.
    if (controls) {
      const before = shown.current < 0 ? 0 : ease(shown.current);
      const after = ease(p);
      const offset = camera.position.clone().sub(controls.target);
      offset.multiplyScalar((1 + (DOLLY - 1) * after) / (1 + (DOLLY - 1) * before));
      offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, (after - before) * SWING);
      controls.target.lerpVectors(TARGET_ASSEMBLED, TARGET_EXPLODED, after);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    }
    shown.current = p;
  });

  return (
    <group position-y={floor} rotation-x={-tilt}>
      {layers.map((layer, i) => (
        <group
          key={layer.name}
          ref={(group) => {
            groups.current[i] = group;
          }}
        >
          <primitive object={layer.node} />
          {layer.name === "facade" &&
            hits.map((hit) => (
              <HitArea
                key={hit.name}
                hit={hit}
                onPress={
                  hit.name === "badge-pad"
                    ? screen.onBadge
                    : screen.onKey && (() => screen.onKey?.(hit.name === "key-left" ? "left" : "right"))
                }
              />
            ))}
          <Html position={layer.label} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <span
              ref={(element) => {
                labelRefs.current[i] = element;
              }}
              aria-hidden
              style={{ opacity: 0, visibility: "hidden" }}
              className="grid size-5 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background shadow-md ring-2 ring-background"
            >
              {i + 1}
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}

/** A key dot or the badge pad, both black inlays: a faint sheen under the pointer, brighter when pressed. */
function HitArea({ hit, onPress }: Readonly<{ hit: Hit; onPress?: () => void }>) {
  const [state, setState] = useState<"idle" | "hover" | "down">("idle");
  const invalidate = useThree((s) => s.invalidate);
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flash.current), []);
  useEffect(() => invalidate(), [state, invalidate]);
  if (!onPress) return null;
  const opacity = { idle: 0, hover: 0.1, down: 0.26 }[state];
  const over = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    document.body.style.cursor = "pointer";
    setState("hover");
  };
  const out = () => {
    document.body.style.cursor = "";
    setState("idle");
  };
  return (
    <mesh
      position={hit.position}
      onPointerOver={over}
      onPointerOut={out}
      onClick={(event) => {
        event.stopPropagation();
        onPress();
        setState("down");
        clearTimeout(flash.current);
        flash.current = setTimeout(() => setState("hover"), 180);
      }}
    >
      {hit.radius ? <circleGeometry args={[hit.radius, 40]} /> : <planeGeometry args={[hit.width ?? 0.02, hit.height ?? 0.015]} />}
      <meshBasicMaterial color="#ffffff" transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

/**
 * A product studio: a large softbox overhead and a warm key from the upper left,
 * both casting soft shadows, a cool fill on the right, a strip behind for the
 * rims and a dim floor bounce. White PLA reads as white, not grey, and the boards'
 * gold, the brass and the magnets catch long highlights without hot spots.
 */
function Studio() {
  return (
    <>
      <Environment resolution={512} frames={1}>
        <mesh scale={40}>
          <sphereGeometry args={[1, 48, 48]} />
          <meshBasicMaterial color="#cfcdc8" side={THREE.BackSide} />
        </mesh>
        <Lightformer form="rect" intensity={2.6} position={[0, 6, 1]} rotation-x={Math.PI / 2} scale={[14, 8, 1]} />
        <Lightformer form="rect" intensity={1.8} color="#fff1dc" position={[-6, 3, 4]} rotation-y={Math.PI / 3} scale={[5, 8, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#e3ecff" position={[6, 1.5, 3]} rotation-y={-Math.PI / 3} scale={[6, 8, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[0, 2, -7]} scale={[12, 1.2, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#f3eee6" position={[0, -3, 2]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
      </Environment>
      <directionalLight
        castShadow
        position={[-0.25, 0.9, 0.3]}
        intensity={1.6}
        color="#fff6ea"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={6}
        shadow-camera-left={-0.3}
        shadow-camera-right={0.3}
        shadow-camera-top={0.3}
        shadow-camera-bottom={-0.3}
        shadow-camera-near={0.1}
        shadow-camera-far={2}
      />
      <directionalLight position={[0.5, 0.3, -0.4]} intensity={0.5} color="#e6eeff" />
      {/* The desk: the key light's shadow, and the soft contact under the stand. */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[3, 3]} />
        <shadowMaterial transparent opacity={0.07} />
      </mesh>
      <ContactShadows position={[0, 0.0005, 0]} scale={0.7} blur={2.2} far={0.12} opacity={0.5} resolution={1024} />
    </>
  );
}

// ─── Public component ─────────────────────────────────────

const SOUND_KEY = "matecrew:terminal3d:sound";

export function Device3DScene({ screen: shared, office, className }: Device3DSceneProps) {
  const t = useTranslations("devices.terminal3d");
  const reduced = useReducedMotion();
  // Read once, after mount: this component never renders on the server.
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const screen = useScreen(shared, office, sound);
  const [motion] = useState(() => new Motion());
  const [exploded, setExploded] = useState(0);
  const invalidateRef = useRef<() => void>(() => {});

  const go = (target: number, animate: boolean) => {
    motion.to(target, animate && !reduced);
    setExploded(target);
    invalidateRef.current();
  };
  const isOpen = exploded >= 0.5;
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  };

  return (
    <div className={cn("@container relative size-full", className)} onPointerDownCapture={screen.unlock}>
      <Canvas
        style={{ position: "absolute", inset: 0 }}
        frameloop="demand"
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }}
        camera={{ position: [...CAMERA.position], fov: CAMERA.fov, near: 0.02, far: 5 }}
        onCreated={(state) => {
          invalidateRef.current = state.invalidate;
        }}
      >
        <Suspense fallback={null}>
          <Terminal motion={motion} screen={screen} />
          <Studio />
        </Suspense>
        <OrbitControls
          makeDefault
          target={TARGET_ASSEMBLED}
          enablePan={false}
          enableDamping
          minDistance={0.25}
          maxDistance={1.1}
          minPolarAngle={0.15 * Math.PI}
          maxPolarAngle={0.52 * Math.PI}
        />
      </Canvas>

      {/* The parts list of the exploded drawing, numbered like the markers on the layers. */}
      <ol
        aria-hidden={!isOpen}
        style={{ opacity: clamp01((exploded - 0.5) / 0.4) }}
        className={cn(
          "absolute top-3 right-3 z-30 hidden max-w-56 space-y-1 rounded-lg border bg-background/90 p-2 text-xs shadow-sm backdrop-blur-sm sm:block",
          exploded === 0 && "invisible",
        )}
      >
        {LAYERS.map((name, i) => (
          <li key={name} className="flex items-start gap-2" title={t(`layers.${name}.detail`)}>
            <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-foreground text-[10px] font-semibold text-background">
              {i + 1}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate">{t(`layers.${name}.title`)}</span>
              {/* Details only where the view leaves room for them; a tooltip otherwise. */}
              <span className="hidden text-[11px] text-muted-foreground @4xl:block">{t(`layers.${name}.detail`)}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant={isOpen ? "secondary" : "default"}
          className="pointer-events-auto"
          aria-pressed={isOpen}
          onClick={() => go(isOpen ? 0 : 1, true)}
        >
          {isOpen ? <Box /> : <Layers />}
          {isOpen ? t("assemble") : t("explode")}
        </Button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(exploded * 100)}
          aria-label={t("slider")}
          onChange={(event) => go(Number(event.target.value) / 100, false)}
          className="pointer-events-auto h-1.5 w-28 cursor-pointer accent-primary sm:w-40"
        />
        {screen.standalone && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="pointer-events-auto"
            aria-pressed={sound}
            aria-label={sound ? t("mute") : t("unmute")}
            onClick={toggleSound}
          >
            {sound ? <Volume2 /> : <VolumeX />}
          </Button>
        )}
        <HardwareFiles />
        <p className="ml-auto hidden items-center gap-3 text-xs text-muted-foreground md:flex">
          {screen.onKey && <span>{t("hint")}</span>}
          {screen.live && (
            <span className="inline-flex items-center gap-1">
              <Nfc className="size-3" />
              {t("live")}
            </span>
          )}
        </p>
      </div>

      {screen.onKey && (
        <div className="absolute top-3 left-3 flex gap-1">
          <Button type="button" size="sm" variant="outline" className="sr-only focus:not-sr-only" onClick={() => screen.onKey?.("left")}>
            {t("keyLeft")}
          </Button>
          <Button type="button" size="sm" variant="outline" className="sr-only focus:not-sr-only" onClick={() => screen.onBadge?.()}>
            {t("badge")}
          </Button>
          <Button type="button" size="sm" variant="outline" className="sr-only focus:not-sr-only" onClick={() => screen.onKey?.("right")}>
            {t("keyRight")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The case's files, in public/hardware: copies of device/hardware (`bun run hardware:public`),
 * exported from the Fusion script. Printed parts in their print orientation, then the assembly.
 */
const HARDWARE_FILES = [
  { file: "facade.stl", part: "facade", colour: "white" },
  { file: "cadre.stl", part: "frame", colour: "black" },
  { file: "pastille-gauche.stl", part: "keyLeft", colour: "black" },
  { file: "pastille-droite.stl", part: "keyRight", colour: "black" },
  { file: "pavé-nfc.stl", part: "pad", colour: "black" },
  { file: "chassis.stl", part: "chassis", colour: "black" },
  { file: "capot.stl", part: "cover", colour: "white" },
  { file: "socle.stl", part: "stand", colour: "white" },
] as const;
const ASSEMBLY_FILE = "boitier-matecrew.step";

/** The printable parts to download, and the whole assembly as STEP. */
function HardwareFiles() {
  const t = useTranslations("devices.terminal3d.files");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="pointer-events-auto">
          <Download />
          {t("button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("title")}</DropdownMenuLabel>
        {HARDWARE_FILES.map(({ file, part, colour }) => (
          <DropdownMenuItem key={file} asChild>
            <a href={`/hardware/${encodeURIComponent(file)}`} download>
              <span className="min-w-0 flex-1 truncate">{t(`parts.${part}`)}</span>
              <span className="text-xs text-muted-foreground">{t(colour)}</span>
            </a>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`/hardware/${ASSEMBLY_FILE}`} download>
            <span className="min-w-0 flex-1 truncate">{t("assembly")}</span>
            <span className="text-xs text-muted-foreground">STEP</span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

useGLTF.preload(MODEL_URL, undefined, true);
