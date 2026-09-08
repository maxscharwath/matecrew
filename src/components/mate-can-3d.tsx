"use client";

import {
  Environment,
  Lightformer,
  useGLTF,
  useTexture,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  CylinderCollider,
  Physics,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from "@react-three/rapier";
import {
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

/**
 * A 33cl can of El Tony Mate, rendered with react-three-fiber.
 *
 * The geometry comes from a GLB in `public/models`, run through
 * gltf-transform (weld, meshopt). Nothing here depends on how the model is
 * built: it is read as a bag of triangles in world space, and each triangle is
 * sorted by shape alone. A side-facing triangle below the seam takes the
 * print — foot, body and shoulder alike; everything else — lid, seam, tab,
 * anything facing up or down — stays bare aluminium. The band of height the
 * printed triangles span becomes the label's height, so the ink runs from the
 * foot right up to the seam, as it does on a real can.
 *
 * UVs are projected cylindrically rather than taken from the model, both for
 * the label and for the tiling metal maps, so a model with no UVs works as
 * well as one with odd ones. Normals are computed here too, smooth and merged
 * by position, because the decimation tooling only produces flat ones — and
 * flat normals on a cylinder reflect a light strip as hard vertical steps.
 *
 * The can is scaled to the real Ø 66.3 × 115.2 mm from its measured bounds.
 *
 * Surfaces are PBR. A scratched-metal normal and roughness pair (ambientCG
 * Metal008, CC0) gives the aluminium its brushed grain and smudges, and a
 * fainter dose of the same pair sits under the label, so the print reads as
 * ink on metal rather than a decal. Colour comes from the material, not the
 * texture set — Metal008's own albedo is coppery.
 *
 * Lighting is a soft procedural studio baked into an environment map. A
 * photographic HDRI would look marginally better but drei fetches those from a
 * CDN at runtime; the studio is deterministic and needs nothing from the
 * network.
 *
 * Two ways to play with it. In `sway` mode a drag turns the can freely with
 * the momentum of the drag; released, it coasts, drifts back to face the
 * viewer and settles into a slow sway. In `flip` mode the can is a rigid body
 * in a real physics engine (Rapier): a cylinder on a table under real gravity,
 * with aluminium's friction and bounce, and a third of maté inside modelled as
 * a low centre of mass, damping on its tumble, and a share of the spin soaked
 * up on every impact. Pick it up, flick it, and it does what a can does.
 */

const MODEL_URL = "/models/canette.glb";
const METAL_MAPS = {
  normalMap: "/textures/aluminium-normal.jpg",
  roughnessMap: "/textures/aluminium-roughness.jpg",
};

// ─── Dimensions (1 unit = 100 mm) ─────────────────────────

/** Real 33cl can: Ø 66.3 mm × 115.2 mm. */
const CAN_HEIGHT = 1.152;
const CAN_DIAMETER = 0.663;
/** Turn of the artwork around the can; 0 puts its centre — the logo — at the front. */
const LABEL_TURN = 0;
/** Side faces below this share of the can's height are printed; above is the seam. */
const PRINT_TOP_SHARE = 0.93;
/** Faces whose normal leans further than this off the horizontal are ends. */
const END_FACE_LEAN = 0.5;

// ─── Motion: sway mode ────────────────────────────────────

/** Radians of turn per pixel of drag. */
const RAD_PER_PX = 0.012;
/** How quickly a released spin bleeds off (per second, exponential). */
const FRICTION = 1.6;
/** Spin speed below which the pull toward home is at full strength. */
const SETTLE_SPEED = 1.2;
/** How eagerly the can drifts home once it has slowed (per second). */
const HOME_RATE = 1.6;
/** Idle sway about home: amplitude in radians, period in seconds. */
const SWAY_YAW = 0.16;
const SWAY_ROLL = 0.025;
const SWAY_PERIOD = 6;
/** Fly-in duration in seconds. */
const INTRO_SECONDS = 1.8;
/** How far the can starts wound back for the fly-in. */
const INTRO_SPIN = -2.6;
const CAMERA_FOV = 30;

// ─── Physics: flip mode ───────────────────────────────────
//
// Everything below is a property of the world or of the can, handed to the
// engine. There is no game logic steering the flight or the landing: what the
// can does, it does because Rapier says so.

/** Table height: the can's base when it stands at the origin. */
const FLOOR_Y = -CAN_HEIGHT / 2;
/** Real gravity, 9.81 m/s², at 1 unit = 100 mm. */
const GRAVITY = 98.1;
/** Physics rate; a small fast body wants more than the 60 Hz default. */
const PHYSICS_STEP = 1 / 120;
/**
 * The can as a body. A third full it has unit mass (125 g) with the centre of
 * mass well below the middle, where the liquid sits. Empty it is a 15 g shell,
 * balanced about its middle — and goes flying when anything hits it. Moments
 * are those of a cylinder, scaled with the mass.
 */
const FULL_CAN = { mass: 1, centreOfMass: { x: 0, y: -0.3, z: 0 } };
const EMPTY_CAN = { mass: 0.12, centreOfMass: { x: 0, y: 0, z: 0 } };
const UNIT_INERTIA = {
  x: (3 * (CAN_DIAMETER / 2) ** 2 + CAN_HEIGHT ** 2) / 12,
  y: 0.5 * (CAN_DIAMETER / 2) ** 2,
  z: (3 * (CAN_DIAMETER / 2) ** 2 + CAN_HEIGHT ** 2) / 12,
};
/** Aluminium on a wooden table: grippy, and a third of maté hardly bounces. */
const CAN_FRICTION = 0.7;
const CAN_RESTITUTION = 0.05;
/** The liquid, as far as a rigid body can say it: it drags on every tumble. */
const LINEAR_DAMPING = 0.1;
const ANGULAR_DAMPING = 1.5;
/**
 * Rolling resistance. Friction alone never stops a rolling cylinder — nothing
 * slides — so while the can touches the floor it is damped harder, the way a
 * dented rim and sloshing liquid stop a real one within a turn or two.
 */
const ROLLING_LINEAR_DAMPING = 2;
const ROLLING_ANGULAR_DAMPING = 5;
/**
 * The grab: a stiff, well-damped spring from the hand to the point taken on
 * the can. Stiff enough to carry, soft enough not to whip.
 */
const GRIP_STIFFNESS = 400;
const GRIP_DAMPING = 30;
/** Standing within this angle of upright is a landing; past the fall angle it is down. */
const STAND_ANGLE = THREE.MathUtils.degToRad(14);
const FALL_ANGLE = THREE.MathUtils.degToRad(60);
/**
 * A landing only counts after a flip: the can's up-vector must have turned
 * through at least this much between release and rest. Lifting it and setting
 * it down turns it through nothing.
 */
const MIN_FLIP = THREE.MathUtils.degToRad(300);
/** Still enough, on the floor, for this long: the throw is over. */
const REST_SPEED = 0.3;
const REST_SPIN = 0.8;
const REST_SECONDS = 0.4;
/** A throw that never settles is called after this long anyway. */
const THROW_TIMEOUT = 7;
/** After the throw is called, how long before the can is put back. */
const RESET_DELAY = 0.9;
/** The floor: to all intents infinite. */
const FLOOR_EXTENT = 500;
/** Flip mode framing at rest, and how the camera gives ground as the can climbs. */
const FLIP_VIEW_HEIGHTS = 3;
const FLIP_LOOK_AT = 0.7;

// ─── Physics: knockdown mode ──────────────────────────────

/** Levels are pyramids: this many rows at the first, one more each level. */
const FIRST_ROWS = 3;
const LAST_ROWS = 11;
/** The gap between cans in a row. */
const PYRAMID_GAP = 0.02;
/** Shots per level: a couple more than there are rows. */
const SHOTS_FOR_ROWS = (rows: number) => rows + 2;
/**
 * The range: how far down the line the pyramid stands from the gun. Never
 * closer than a fairground would put it; further as the pyramid grows, so it
 * keeps roughly the same size in the sights.
 */
const RANGE_FOR_ROWS = (rows: number) => Math.max(16, rows * CAN_HEIGHT * 3.4);
/**
 * The slug: small, heavy for its size, fast. Some 40 g against the can's
 * 125 g, at 15 m/s — enough momentum to punch a can clean off the stack, slow
 * enough for the engine to track (with CCD on) and for the eye to follow.
 */
const SLUG_RADIUS = 0.09;
const SLUG_MASS = 0.3;
const SLUG_SPEED = 150;
/** Where the gun sits relative to the camera: a little right and below the eye. */
const GUN_OFFSET = new THREE.Vector3(0.35, -0.45, -0.6);
/** A can counts as down once it leans past this, or has left its spot by this much. */
const DOWN_ANGLE = THREE.MathUtils.degToRad(50);
const DOWN_DISTANCE = 0.6;
/** After the last shot, the level is judged once everything is still, or after this long. */
const KNOCKDOWN_TIMEOUT = 6;
/** How long the result stays before the next level (or the retry) is set up. */
const LEVEL_PAUSE = 1.6;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * What the pointer is doing to the can, shared between the handlers on the
 * wrapper element and the frame loop inside the canvas. Neither re-renders
 * anything; they move the can.
 */
interface CanState {
  /** Sway mode: orientation and its angular velocity (axis × rad/s). */
  orientation: THREE.Quaternion;
  spin: THREE.Vector3;
  dragging: boolean;
  lastX: number;
  lastY: number;
  lastTime: number;
  /** Pointer in normalised device coordinates, for flip mode's pick-up. */
  pointer: THREE.Vector2;
  /** Set by the first drag; ends the fly-in's control over the orientation. */
  touched: boolean;
  /** Count of presses so far — an event a frame loop can't miss. */
  presses: number;
}

function createCanState(intro: boolean): CanState {
  return {
    orientation: new THREE.Quaternion().setFromAxisAngle(
      Y_AXIS,
      intro ? INTRO_SPIN : 0,
    ),
    spin: new THREE.Vector3(),
    dragging: false,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    pointer: new THREE.Vector2(),
    touched: false,
    presses: 0,
  };
}

function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4;
}

/** Framerate-independent share of the way to a target. */
function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

// ─── Materials ────────────────────────────────────────────

/**
 * The scratched-metal normal and roughness maps, tiled `repeat` times. Each
 * caller gets its own clones: the body and the ends are different sizes, and
 * a texture's repeat is a property of the texture, not the material.
 */
function useMetalMaps(repeat: readonly [number, number]) {
  const shared = useTexture(METAL_MAPS);
  const [repeatX, repeatY] = repeat;
  return useMemo(() => {
    const tile = (texture: THREE.Texture) => {
      const clone = texture.clone();
      clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
      clone.repeat.set(repeatX, repeatY);
      clone.needsUpdate = true;
      return clone;
    };
    return {
      normalMap: tile(shared.normalMap),
      roughnessMap: tile(shared.roughnessMap),
    };
  }, [shared, repeatX, repeatY]);
}

/** Bare aluminium: fully metallic, brushed and lightly scuffed. */
function Aluminium() {
  const maps = useMetalMaps([3, 3]);
  return (
    <meshPhysicalMaterial
      color="#dcdee2"
      metalness={1}
      roughness={0.55}
      roughnessMap={maps.roughnessMap}
      normalMap={maps.normalMap}
      normalScale={new THREE.Vector2(0.9, 0.9)}
      envMapIntensity={1.3}
    />
  );
}

/** The print: label over the same metal, under a coat of lacquer. */
function Print({
  textureUrl,
  turn = 0,
}: {
  readonly textureUrl: string;
  readonly turn?: number;
}) {
  const maxAnisotropy = useThree((state) =>
    state.gl.capabilities.getMaxAnisotropy(),
  );
  const configure = useCallback(
    (texture: THREE.Texture | THREE.Texture[]) => {
      for (const t of Array.isArray(texture) ? texture : [texture]) {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        // Text on a curved surface aliases badly at grazing angles without this.
        t.anisotropy = maxAnisotropy;
        // Slide the artwork round the can so its mark faces the viewer.
        t.offset.x = turn;
        t.needsUpdate = true;
      }
    },
    [maxAnisotropy, turn],
  );
  const label = useTexture(textureUrl, configure);
  const metal = useMetalMaps([3, 2]);

  return (
    // Ink under lacquer over metal: a little metalness bleeds through, the
    // scratches show faintly through the print, the clearcoat gives it gloss.
    // Kept well below the bare metal's metalness — the studio's lights
    // otherwise reflect as hard bars across the artwork.
    <meshPhysicalMaterial
      map={label}
      metalness={0.2}
      roughness={0.6}
      roughnessMap={metal.roughnessMap}
      normalMap={metal.normalMap}
      normalScale={new THREE.Vector2(0.12, 0.12)}
      clearcoat={0.8}
      clearcoatRoughness={0.2}
      envMapIntensity={0.9}
    />
  );
}

// ─── Model ────────────────────────────────────────────────

/** Triangle indices of a geometry, indexed or not. */
function trianglesOf(geometry: THREE.BufferGeometry): ArrayLike<number> {
  return (
    geometry.index?.array ??
    Array.from({ length: geometry.attributes.position.count }, (_, i) => i)
  );
}

/**
 * Smooth normals, merged by position alone.
 *
 * Three's own `computeVertexNormals` would leave a crease wherever the model
 * duplicates a vertex along a seam, so faces are accumulated per *position* —
 * every vertex that shares a spot in space gets the same normal, seam or not.
 */
function smoothNormals(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  triangles: ArrayLike<number>,
): THREE.BufferAttribute {
  const keyOf = (i: number) =>
    `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;
  const keys = Array.from({ length: position.count }, (_, i) => keyOf(i));

  // Area-weighted face normals, summed per position.
  const sums = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const face = new THREE.Vector3();
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [triangles[t], triangles[t + 1], triangles[t + 2]];
    a.fromBufferAttribute(position, corners[0]);
    b.fromBufferAttribute(position, corners[1]);
    c.fromBufferAttribute(position, corners[2]);
    face.subVectors(b, a).cross(c.sub(a));
    for (const i of corners) {
      const sum = sums.get(keys[i]);
      if (sum) sum.add(face);
      else sums.set(keys[i], face.clone());
    }
  }

  const normal = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const n = sums.get(keys[i])!.clone().normalize();
    normal.set([n.x, n.y, n.z], i * 3);
  }
  return new THREE.BufferAttribute(normal, 3);
}

/**
 * Cylindrical UVs in world space: `u` around the can's axis with the artwork's
 * centre at the front, `v` from `bottom` to `top`.
 */
function cylindricalUv(
  world: readonly THREE.Vector3[],
  axis: THREE.Vector3,
  bottom: number,
  top: number,
): THREE.BufferAttribute {
  const uv = new Float32Array(world.length * 2);
  world.forEach((p, i) => {
    uv[i * 2] =
      0.5 + Math.atan2(p.x - axis.x, p.z - axis.z) / (2 * Math.PI) + LABEL_TURN;
    uv[i * 2 + 1] = (p.y - bottom) / (top - bottom);
  });
  return new THREE.BufferAttribute(uv, 2);
}

interface Part {
  readonly geometry: THREE.BufferGeometry;
  readonly matrix: THREE.Matrix4;
  readonly printed: boolean;
}

/**
 * The model, read as triangles and sorted into printed and bare parts (see the
 * file comment), with the transform that stands the can at real size on the
 * origin. The loaded scene is only read — the loader caches it, and two
 * canvases on one page share the same objects — so every geometry handed out
 * is new, sharing vertex data where it can.
 */
function useCanParts() {
  const { scene } = useGLTF(MODEL_URL, undefined, true);
  return useMemo(() => {
    scene.updateMatrixWorld(true);

    // Every mesh's vertices in world space, and the can's overall bounds.
    const meshes: {
      matrix: THREE.Matrix4;
      position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
      triangles: ArrayLike<number>;
      world: THREE.Vector3[];
    }[] = [];
    const whole = new THREE.Box3();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const position = object.geometry.attributes.position;
      const world = Array.from({ length: position.count }, (_, i) =>
        new THREE.Vector3()
          .fromBufferAttribute(position, i)
          .applyMatrix4(object.matrixWorld),
      );
      for (const p of world) whole.expandByPoint(p);
      meshes.push({
        matrix: object.matrixWorld.clone(),
        position,
        triangles: trianglesOf(object.geometry),
        world,
      });
    });

    const size = whole.getSize(new THREE.Vector3());
    const centre = whole.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) / 2;

    // Sort triangles: side-facing and below the seam means printed — foot,
    // body and shoulder alike, the way ink covers a real can. The height those
    // span is the label's band.
    const seamY = whole.min.y + size.y * PRINT_TOP_SHARE;
    const band = { bottom: Infinity, top: -Infinity };
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const sorted = meshes.map((m) => {
      const printed: number[] = [];
      const bare: number[] = [];
      for (let t = 0; t < m.triangles.length; t += 3) {
        const corners = [m.triangles[t], m.triangles[t + 1], m.triangles[t + 2]];
        const [pa, pb, pc] = corners.map((i) => m.world[i]);
        const lean = Math.abs(
          ab.subVectors(pb, pa).cross(ac.subVectors(pc, pa)).normalize().y,
        );
        const height = (pa.y + pb.y + pc.y) / 3;
        if (lean < END_FACE_LEAN && height < seamY) {
          printed.push(...corners);
          for (const p of [pa, pb, pc]) {
            band.bottom = Math.min(band.bottom, p.y);
            band.top = Math.max(band.top, p.y);
          }
        } else {
          bare.push(...corners);
        }
      }
      return { ...m, printed, bare };
    });

    const parts: Part[] = [];
    for (const m of sorted) {
      const normal = smoothNormals(m.position, m.triangles);
      const build = (indices: number[], uv: THREE.BufferAttribute) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", m.position);
        geometry.setAttribute("normal", normal);
        geometry.setAttribute("uv", uv);
        geometry.setIndex(indices);
        return geometry;
      };
      if (m.printed.length) {
        parts.push({
          geometry: build(
            m.printed,
            cylindricalUv(m.world, centre, band.bottom, band.top),
          ),
          matrix: m.matrix,
          printed: true,
        });
      }
      if (m.bare.length) {
        // Bare metal only needs UVs for its tiling grain; the whole height will do.
        parts.push({
          geometry: build(
            m.bare,
            cylindricalUv(m.world, centre, whole.min.y, whole.max.y),
          ),
          matrix: m.matrix,
          printed: false,
        });
      }
    }

    const scale = new THREE.Vector3(
      CAN_DIAMETER / (radius * 2),
      CAN_HEIGHT / size.y,
      CAN_DIAMETER / (radius * 2),
    );

    return { parts, scale, centre };
  }, [scene]);
}

interface LabelProps {
  readonly textureUrl: string;
  readonly turn: number;
}

/** The can itself, standing on the origin with its middle at the origin. */
function CanVisual({ textureUrl, turn }: LabelProps) {
  const { parts, scale, centre } = useCanParts();
  return (
    <group scale={scale} position={centre.clone().multiply(scale).negate()}>
      {parts.map((part, index) => (
        <mesh
          key={index}
          geometry={part.geometry}
          matrixAutoUpdate={false}
          matrix={part.matrix}
          castShadow
        >
          {part.printed ? (
            <Print textureUrl={textureUrl} turn={turn} />
          ) : (
            <Aluminium />
          )}
        </mesh>
      ))}
    </group>
  );
}

// ─── Sway mode ────────────────────────────────────────────

interface SwayCanProps extends LabelProps {
  readonly state: React.RefObject<CanState>;
  readonly intro: boolean;
  readonly swayScale: number;
}

/** Spin with inertia, then drift home into a slow sway. */
function SwayCan({ textureUrl, turn, state, intro, swayScale }: SwayCanProps) {
  const group = useRef<THREE.Group>(null);
  const startedAt = useRef<number | null>(null);
  // Scratch objects, so the frame loop allocates nothing.
  const scratch = useMemo(
    () => ({
      step: new THREE.Quaternion(),
      home: new THREE.Quaternion(),
      axis: new THREE.Vector3(),
      euler: new THREE.Euler(),
    }),
    [],
  );

  useFrame(({ clock }, dt) => {
    const s = state.current;
    const { orientation, spin } = s;
    startedAt.current ??= clock.elapsedTime;
    const elapsed = clock.elapsedTime - startedAt.current;

    if (intro && !s.touched && elapsed < INTRO_SECONDS) {
      // The fly-in owns the orientation until it lands or the user grabs the can.
      orientation.setFromAxisAngle(
        Y_AXIS,
        THREE.MathUtils.lerp(
          INTRO_SPIN,
          0,
          easeOutQuart(elapsed / INTRO_SECONDS),
        ),
      );
    } else if (!s.dragging) {
      // Home is not quite still: a slow sway, so the can breathes at rest.
      const phase = (elapsed / SWAY_PERIOD) * Math.PI * 2;
      scratch.euler.set(
        0,
        Math.sin(phase) * SWAY_YAW * swayScale,
        Math.sin(phase * 0.5) * SWAY_ROLL * swayScale,
        "YXZ",
      );
      scratch.home.setFromEuler(scratch.euler);

      const speed = spin.length();
      if (speed > 0) {
        // Coast on whatever axis the drag left it, bleeding off.
        spin.multiplyScalar(Math.exp(-FRICTION * dt));
        scratch.step.setFromAxisAngle(
          scratch.axis.copy(spin).normalize(),
          speed * dt,
        );
        orientation.premultiply(scratch.step);
      }
      // The pull home fades in as the spin dies, so the hand-over from
      // coasting to settling has no seam.
      const settle = THREE.MathUtils.clamp(1 - speed / SETTLE_SPEED, 0, 1);
      orientation.slerp(scratch.home, dampFactor(HOME_RATE * settle, dt));
    }

    group.current?.quaternion.copy(orientation);
  });

  return (
    <group ref={group}>
      <CanVisual textureUrl={textureUrl} turn={turn} />
    </group>
  );
}

// ─── The hand ─────────────────────────────────────────────

/** Rapier's joint type, taken from the world so it matches the engine build in use. */
type GripJoint = ReturnType<
  ReturnType<typeof useRapier>["world"]["createImpulseJoint"]
>;

interface GripOptions {
  /** The body to take hold of, and the meshes to aim the grab at. */
  readonly body: React.RefObject<RapierRigidBody | null>;
  readonly visual: React.RefObject<THREE.Object3D | null>;
  /** The hand: a kinematic body with nothing on it. */
  readonly hand: React.RefObject<RapierRigidBody | null>;
  /** The plane the pointer moves the hand on, through the body's position. */
  readonly planeNormal: THREE.Vector3;
  /** Furthest a grab point may sit from the body's centre. */
  readonly reach: number;
}

/**
 * Picking things up, physically. Taking hold attaches a stiff, damped spring
 * from a kinematic hand that follows the pointer to the exact point grabbed —
 * so a can hangs and swings from where it is held, and a ball is carried.
 * The drag is relative: the hand starts where it took hold and moves by as
 * much as the pointer does, so pressing anywhere picks the thing up where it
 * lies rather than yanking it to the cursor. Letting go removes the spring and
 * whatever the swing gave the body, it keeps.
 */
function useGrip({ body, visual, hand, planeNormal, reach }: GripOptions) {
  const { rapier, world } = useRapier();
  const camera = useThree((s) => s.camera);
  const grip = useRef({ held: false, joint: null as GripJoint | null });
  const scratch = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      plane: new THREE.Plane(),
      target: new THREE.Vector3(),
      point: new THREE.Vector3(),
      position: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
      pointerOrigin: new THREE.Vector3(),
      handOrigin: new THREE.Vector3(),
    }),
    [],
  );

  const pointerOnPlane = (pointer: THREE.Vector2, out: THREE.Vector3) => {
    scratch.raycaster.setFromCamera(pointer, camera);
    return scratch.raycaster.ray.intersectPlane(scratch.plane, out) !== null;
  };

  const take = (pointer: THREE.Vector2) => {
    const b = body.current;
    const h = hand.current;
    if (!b || !h) return;
    const t = b.translation();
    scratch.position.set(t.x, t.y, t.z);
    scratch.plane.setFromNormalAndCoplanarPoint(planeNormal, scratch.position);
    if (!pointerOnPlane(pointer, scratch.pointerOrigin)) return;

    // Aim at the meshes; miss, and it is taken by the nearest point anyway.
    scratch.raycaster.setFromCamera(pointer, camera);
    const hit = visual.current
      ? scratch.raycaster.intersectObject(visual.current, true)[0]
      : undefined;
    scratch.point.copy(hit ? hit.point : scratch.pointerOrigin);
    scratch.point.sub(scratch.position).clampLength(0, reach);
    // The grab point in the body's own frame.
    const r = b.rotation();
    const local = scratch.point
      .clone()
      .applyQuaternion(scratch.rotation.set(r.x, r.y, r.z, r.w).invert());
    scratch.point.add(scratch.position);
    scratch.handOrigin.copy(scratch.point);

    h.setTranslation(scratch.point, true);
    h.setNextKinematicTranslation(scratch.point);
    grip.current.joint = world.createImpulseJoint(
      rapier.JointData.spring(0, GRIP_STIFFNESS, GRIP_DAMPING, { x: 0, y: 0, z: 0 }, local),
      h,
      b,
      true,
    );
    b.wakeUp();
    grip.current.held = true;
  };

  const drop = () => {
    if (grip.current.joint) {
      world.removeImpulseJoint(grip.current.joint, true);
      grip.current.joint = null;
    }
    grip.current.held = false;
  };

  /**
   * Called every frame with the pointer state. Returns what just happened:
   * `"taken"` on the frame the grab began, `"dropped"` on the frame it ended.
   */
  const update = (dragging: boolean, pointer: THREE.Vector2) => {
    const g = grip.current;
    if (dragging) {
      if (!g.held) {
        take(pointer);
        return g.held ? "taken" : null;
      }
      const h = hand.current;
      if (h && pointerOnPlane(pointer, scratch.target)) {
        scratch.target.sub(scratch.pointerOrigin).add(scratch.handOrigin);
        scratch.target.setY(Math.max(scratch.target.y, FLOOR_Y + 0.05));
        h.setNextKinematicTranslation(scratch.target);
      }
      return null;
    }
    if (g.held) {
      drop();
      return "dropped";
    }
    return null;
  };

  return update;
}

/** The hand: nothing to see, nothing to collide with, only a point to hold by. */
function Hand({ handRef }: { readonly handRef: React.RefObject<RapierRigidBody | null> }) {
  return (
    <RigidBody
      ref={handRef}
      type="kinematicPosition"
      colliders={false}
      position={[0, 10, 0]}
    >
      <group />
    </RigidBody>
  );
}

/** Cheap, stable pseudo-randomness from two seeds. */
function pick(i: number, level: number, count: number) {
  const x = Math.sin(i * 12.9898 + level * 78.233) * 43758.5453;
  return Math.floor((x - Math.floor(x)) * count);
}

/** Tilt of a body from upright, in radians. */
function tiltOf(b: RapierRigidBody, scratch: THREE.Quaternion, up: THREE.Vector3) {
  const r = b.rotation();
  up.set(0, 1, 0).applyQuaternion(scratch.set(r.x, r.y, r.z, r.w));
  return Math.acos(THREE.MathUtils.clamp(up.y, -1, 1));
}

function speedOf(b: RapierRigidBody) {
  const v = b.linvel();
  return Math.hypot(v.x, v.y, v.z);
}

function spinOf(b: RapierRigidBody) {
  const w = b.angvel();
  return Math.hypot(w.x, w.y, w.z);
}

/** The can as a rigid body: collider, mass, materials, rolling resistance. */
function CanBody({
  bodyRef,
  position,
  fill = FULL_CAN,
  children,
}: {
  readonly bodyRef: React.RefObject<RapierRigidBody | null>;
  readonly position?: readonly [number, number, number];
  /** How much is in it — what it weighs and where that weight sits. */
  readonly fill?: typeof FULL_CAN;
  readonly children: React.ReactNode;
}) {
  const contacts = useRef(0);
  useFrame(() => {
    const b = bodyRef.current;
    if (!b) return;
    // Rolling resistance: harder damping while on the floor.
    const rolling = contacts.current > 0;
    b.setAngularDamping(rolling ? ROLLING_ANGULAR_DAMPING : ANGULAR_DAMPING);
    b.setLinearDamping(rolling ? ROLLING_LINEAR_DAMPING : LINEAR_DAMPING);
  });
  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      ccd
      position={position}
      linearDamping={LINEAR_DAMPING}
      angularDamping={ANGULAR_DAMPING}
      friction={CAN_FRICTION}
      restitution={CAN_RESTITUTION}
      onCollisionEnter={() => void (contacts.current += 1)}
      onCollisionExit={() => void (contacts.current = Math.max(0, contacts.current - 1))}
    >
      <CylinderCollider
        args={[CAN_HEIGHT / 2, CAN_DIAMETER / 2]}
        massProperties={{
          mass: fill.mass,
          centerOfMass: fill.centreOfMass,
          principalAngularInertia: {
            x: UNIT_INERTIA.x * fill.mass,
            y: UNIT_INERTIA.y * fill.mass,
            z: UNIT_INERTIA.z * fill.mass,
          },
          angularInertiaLocalFrame: { x: 0, y: 0, z: 0, w: 1 },
        }}
      />
      {children}
    </RigidBody>
  );
}

// ─── Flip mode ────────────────────────────────────────────

interface FlipCanProps {
  readonly state: React.RefObject<CanState>;
  /** Artwork to pick from: a different can, at random, every round. */
  readonly labels: readonly { readonly url: string; readonly turn?: number }[];
  /** Where the can is, for the camera to follow. */
  readonly focus: React.RefObject<THREE.Vector3>;
  /** Standing at rest, and whether it actually flipped on the way. */
  readonly onLand?: (upright: boolean, flipped: boolean) => void;
}

const VERTICAL_PLANE = new THREE.Vector3(0, 0, 1);

/**
 * The bottle flip: the can, the hand, and the little that is not the engine.
 * Gravity, the floor, the bounce, the roll and the stillness are Rapier's.
 * Once the can has been still on the floor for a moment — standing or lying,
 * nothing in between counts — the throw is scored by how it stands, and after
 * a moment the can is put back on its spot for the next one.
 */
function FlipCan({ state, labels, focus, onLand }: FlipCanProps) {
  // A new can every round: whichever label chance hands out.
  const [round, setRound] = useState(0);
  const label = labels[pick(round, 7, labels.length)];
  const body = useRef<RapierRigidBody>(null);
  const hand = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null);
  const grip = useGrip({
    body,
    visual,
    hand,
    planeNormal: VERTICAL_PLANE,
    reach: CAN_HEIGHT / 2,
  });
  const game = useRef({
    thrown: false,
    thrownFor: 0,
    restFor: 0,
    resetIn: 0,
    /** How far the can has turned over since release, in radians. */
    turned: 0,
  });
  const scratch = useMemo(
    () => ({
      rotation: new THREE.Quaternion(),
      up: new THREE.Vector3(),
      lastUp: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );

  useFrame((_, dt) => {
    const b = body.current;
    if (!b) return;
    const s = state.current;
    const g = game.current;
    const t = b.translation();
    focus.current.set(t.x, t.y, t.z);

    const event = grip(s.dragging, s.pointer);
    if (event === "taken") {
      g.thrown = false;
      g.resetIn = 0;
    } else if (event === "dropped") {
      g.thrown = true;
      g.thrownFor = 0;
      g.restFor = 0;
      g.turned = 0;
      tiltOf(b, scratch.rotation, scratch.lastUp);
    }
    if (s.dragging) return;

    if (g.thrown) {
      // Read the engine: still, on the floor, standing or lying — or out of time.
      const tilt = tiltOf(b, scratch.rotation, scratch.up);
      // Keep count of how far it has turned over — yaw doesn't move the up-vector,
      // so spinning on the spot earns nothing; going over does.
      g.turned += Math.acos(
        THREE.MathUtils.clamp(scratch.lastUp.dot(scratch.up), -1, 1),
      );
      scratch.lastUp.copy(scratch.up);
      const standing = tilt < STAND_ANGLE;
      const lying = tilt > FALL_ANGLE;
      const onFloor = t.y < FLOOR_Y + CAN_HEIGHT / 2 + 0.05;
      const still = onFloor && speedOf(b) < REST_SPEED && spinOf(b) < REST_SPIN;
      g.restFor = still && (standing || lying) ? g.restFor + dt : 0;
      g.thrownFor += dt;
      if (g.restFor >= REST_SECONDS || b.isSleeping() || g.thrownFor > THROW_TIMEOUT) {
        g.thrown = false;
        g.resetIn = RESET_DELAY;
        onLand?.(standing, g.turned >= MIN_FLIP);
      }
    }
    if (g.resetIn > 0) {
      g.resetIn -= dt;
      if (g.resetIn <= 0) {
        b.setTranslation({ x: 0, y: 0, z: 0 }, true);
        b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        setRound((n) => n + 1);
      }
    }
  });

  return (
    <>
      <CanBody bodyRef={body}>
        <group ref={visual}>
          <CanVisual textureUrl={label.url} turn={label.turn ?? 0} />
        </group>
      </CanBody>
      <Hand handRef={hand} />
    </>
  );
}

// ─── Knockdown mode ───────────────────────────────────────

export interface KnockdownReport {
  /** 1-based level, and the pyramid's row count. */
  readonly level: number;
  readonly rows: number;
  readonly down: number;
  readonly total: number;
  readonly shotsLeft: number;
  /** Set when a level has just been judged. */
  readonly result?: "cleared" | "failed";
}

/** Where a camera stands and what it looks at. */
export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
}

interface KnockdownProps extends LabelProps {
  readonly state: React.RefObject<CanState>;
  /** Artwork to pick from for the pyramid: every can wears one at random. */
  readonly labels: readonly { readonly url: string; readonly turn?: number }[];
  readonly onReport?: (report: KnockdownReport) => void;
  /** Called with the camera stance that fits the current pyramid, and its rows. */
  readonly onPose?: (pose: CameraPose, rows: number) => void;
}

/** Where each can of a pyramid of `rows` stands, bottom row first. */
function pyramidSpots(rows: number, z: number) {
  const spots: { x: number; y: number; z: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const count = rows - row;
    for (let i = 0; i < count; i++) {
      spots.push({
        x: (i - (count - 1) / 2) * (CAN_DIAMETER + PYRAMID_GAP),
        y: FLOOR_Y + CAN_HEIGHT / 2 + row * (CAN_HEIGHT + 0.002),
        z,
      });
    }
  }
  return spots;
}

/**
 * The shooter's stance for a pyramid of `rows`: standing at the origin, eye a
 * little above the pyramid's middle, looking straight down the range.
 */
function knockdownPose(rows: number): CameraPose {
  const height = rows * CAN_HEIGHT;
  return {
    position: [0, 1.6 + height * 0.3, 0],
    lookAt: [0, FLOOR_Y + height * 0.45, -RANGE_FOR_ROWS(rows)],
  };
}

/**
 * The shooting gallery: a pyramid of empty cans down the range, a few slugs,
 * and a click to fire. Aim at a spot — the slug leaves the gun on the ballistic arc
 * that meets it, and the engine decides what happens when it gets there. When
 * the last slug is gone and everything has settled, every can leaning over or
 * knocked off its spot counts; clear the pyramid to face a bigger one.
 */
function Knockdown({ state, labels, onReport, onPose }: KnockdownProps) {
  const [level, setLevel] = useState(0);
  const rows = Math.min(FIRST_ROWS + level, LAST_ROWS);
  const range = RANGE_FOR_ROWS(rows);
  const spots = useMemo(() => pyramidSpots(rows, -range), [rows, range]);
  const shotCount = SHOTS_FOR_ROWS(rows);
  const camera = useThree((s) => s.camera);
  const cans = useRef<(RapierRigidBody | null)[]>([]);
  const slugs = useRef<(RapierRigidBody | null)[]>([]);
  const game = useRef({
    fired: 0,
    seenPresses: 0,
    /** Judging: after the last shot, waiting for stillness. */
    judging: false,
    judgingFor: 0,
    restFor: 0,
    nextIn: 0,
    nextLevel: 0,
  });
  const scratch = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      plane: new THREE.Plane(),
      target: new THREE.Vector3(),
      muzzle: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
      up: new THREE.Vector3(),
    }),
    [],
  );

  // Each level gets its own camera stance and a fresh report.
  const pose = useMemo(() => knockdownPose(rows), [rows]);
  const reported = useRef(-1);
  if (reported.current !== level) {
    reported.current = level;
    onPose?.(pose, rows);
    game.current.fired = 0;
    game.current.judging = false;
    game.current.nextIn = 0;
    onReport?.({ level: level + 1, rows, down: 0, total: spots.length, shotsLeft: shotCount });
  }

  const countDown = () =>
    cans.current.filter((c, i) => {
      if (!c) return false;
      const t = c.translation();
      const spot = spots[i];
      const moved = Math.hypot(t.x - spot.x, t.y - spot.y, t.z - spot.z);
      return tiltOf(c, scratch.rotation, scratch.up) > DOWN_ANGLE || moved > DOWN_DISTANCE;
    }).length;

  /** Fire the next slug at what the pointer is over, on the pyramid's plane. */
  const fire = (pointer: THREE.Vector2) => {
    const g = game.current;
    const slug = slugs.current[g.fired];
    if (!slug || g.fired >= shotCount) return;
    scratch.plane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -range),
    );
    scratch.raycaster.setFromCamera(pointer, camera);
    if (!scratch.raycaster.ray.intersectPlane(scratch.plane, scratch.target)) return;
    scratch.target.y = Math.max(scratch.target.y, FLOOR_Y + SLUG_RADIUS);

    // From the muzzle to the target in T seconds at the slug's speed: the
    // velocity that covers the distance, plus what gravity takes back on the way.
    scratch.muzzle.copy(GUN_OFFSET).applyQuaternion(camera.quaternion).add(camera.position);
    scratch.velocity.subVectors(scratch.target, scratch.muzzle);
    const T = scratch.velocity.length() / SLUG_SPEED;
    scratch.velocity.divideScalar(T);
    scratch.velocity.y += 0.5 * GRAVITY * T;

    slug.setTranslation(scratch.muzzle, true);
    slug.setLinvel(scratch.velocity, true);
    slug.setAngvel({ x: 0, y: 0, z: 0 }, true);
    g.fired += 1;
    if (g.fired >= shotCount) {
      g.judging = true;
      g.judgingFor = 0;
      g.restFor = 0;
    }
    onReport?.({
      level: level + 1,
      rows,
      down: countDown(),
      total: spots.length,
      shotsLeft: shotCount - g.fired,
    });
  };

  useFrame((_, dt) => {
    const s = state.current;
    const g = game.current;

    // Every press is a shot — counted, so a quick click between frames still fires.
    while (g.seenPresses < s.presses) {
      g.seenPresses += 1;
      if (g.nextIn <= 0 && !g.judging) fire(s.pointer);
    }

    // The pyramid may well be down before the last slug: don't make the
    // player spend them, judge as soon as everything settles.
    if (!g.judging && g.nextIn <= 0 && g.fired > 0 && countDown() >= spots.length) {
      g.judging = true;
      g.judgingFor = 0;
      g.restFor = 0;
    }

    if (g.judging) {
      const bodies = [...cans.current, ...slugs.current].filter(
        (b): b is RapierRigidBody => b !== null,
      );
      const still = bodies.every((b) => speedOf(b) < REST_SPEED && spinOf(b) < REST_SPIN);
      g.restFor = still ? g.restFor + dt : 0;
      g.judgingFor += dt;
      if (g.restFor >= REST_SECONDS || g.judgingFor > KNOCKDOWN_TIMEOUT) {
        g.judging = false;
        const down = countDown();
        const cleared = down >= spots.length;
        g.nextLevel = cleared ? Math.min(level + 1, LAST_ROWS - FIRST_ROWS) : level;
        g.nextIn = LEVEL_PAUSE;
        onReport?.({
          level: level + 1,
          rows,
          down,
          total: spots.length,
          shotsLeft: shotCount - g.fired,
          result: cleared ? "cleared" : "failed",
        });
      }
    }
    if (g.nextIn > 0) {
      g.nextIn -= dt;
      if (g.nextIn <= 0) {
        if (g.nextLevel === level) {
          // Same level again: stand the pyramid back up, pocket the slugs.
          cans.current.forEach((c, i) => {
            if (!c) return;
            c.setTranslation(spots[i], true);
            c.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
            c.setLinvel({ x: 0, y: 0, z: 0 }, true);
            c.setAngvel({ x: 0, y: 0, z: 0 }, true);
          });
          slugs.current.forEach((b, i) => {
            if (!b) return;
            b.setTranslation({ x: 0, y: -20 - i, z: 0 }, true);
            b.setLinvel({ x: 0, y: 0, z: 0 }, true);
            b.setAngvel({ x: 0, y: 0, z: 0 }, true);
          });
          g.fired = 0;
          onReport?.({ level: level + 1, rows, down: 0, total: spots.length, shotsLeft: shotCount });
        } else {
          setLevel(g.nextLevel);
        }
      }
    }
  });

  return (
    // Keyed on the level: a new pyramid is a new set of bodies.
    <group key={level}>
      {spots.map((spot, i) => {
        const label = labels[pick(i, level, labels.length)];
        return (
          <CanBody
            key={i}
            bodyRef={{
              get current() {
                return cans.current[i] ?? null;
              },
              set current(value) {
                cans.current[i] = value;
              },
            }}
            position={[spot.x, spot.y, spot.z]}
            fill={EMPTY_CAN}
          >
            <CanVisual textureUrl={label.url} turn={label.turn ?? 0} />
          </CanBody>
        );
      })}
      {Array.from({ length: shotCount }, (_, i) => (
        <RigidBody
          key={i}
          ref={(b) => {
            slugs.current[i] = b;
          }}
          colliders={false}
          ccd
          gravityScale={1}
          // Unfired slugs wait well out of the way, below the floor.
          position={[0, -20 - i, 0]}
          linearDamping={0.02}
          angularDamping={0.2}
          friction={0.5}
          restitution={0.3}
        >
          <BallCollider args={[SLUG_RADIUS]} mass={SLUG_MASS} />
          <mesh castShadow>
            <sphereGeometry args={[SLUG_RADIUS, 24, 16]} />
            {/* Brass. */}
            <meshStandardMaterial color="#c9a24a" roughness={0.35} metalness={1} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

/** The floor, as far as the eye can see. */
function Floor() {
  return (
    <RigidBody type="fixed" friction={CAN_FRICTION} restitution={0.05}>
      <CuboidCollider
        args={[FLOOR_EXTENT, 0.5, FLOOR_EXTENT]}
        position={[0, FLOOR_Y - 0.5, 0]}
      />
    </RigidBody>
  );
}

// ─── Camera & lighting ────────────────────────────────────

interface RigProps {
  readonly distance: number;
  readonly lookAtY: number;
  readonly intro: boolean;
  readonly parallax: boolean;
  /** Something to keep in view — the camera backs off and looks up as it climbs. */
  readonly follow?: React.RefObject<THREE.Vector3>;
  /** A fixed stance instead of the front-on framing. */
  readonly pose?: CameraPose;
}

/**
 * Flies the camera in from low and to the side on mount, then holds a rest
 * position with a slight lean toward the pointer. Given something to follow,
 * it gives ground as that rises so a real throw never leaves the frame.
 */
function Rig({ distance, lookAtY, intro, parallax, follow, pose }: RigProps) {
  const camera = useThree((state) => state.camera);
  const startedAt = useRef<number | null>(null);
  const { start, rest, target, look, scratch } = useMemo(
    () => ({
      start: new THREE.Vector3(distance * 0.7, -distance * 0.35, distance * 0.6),
      rest: pose
        ? new THREE.Vector3(...pose.position)
        : new THREE.Vector3(0, lookAtY + distance * 0.06, distance),
      target: new THREE.Vector3(),
      look: pose ? new THREE.Vector3(...pose.lookAt) : new THREE.Vector3(0, lookAtY, 0),
      scratch: new THREE.Vector3(),
    }),
    [distance, lookAtY, pose],
  );

  useFrame((state, dt) => {
    startedAt.current ??= state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - startedAt.current;

    target.copy(rest);
    if (follow) {
      // Keep the can in the sights: look at it, and stand back by as much as it
      // has wandered — up, sideways or away — so it never leaves the frame.
      const away = Math.hypot(follow.current.x, follow.current.z);
      const climb = Math.max(0, follow.current.y);
      const back = distance + away * 0.9 + climb * 0.8;
      look.lerp(
        scratch.set(
          follow.current.x,
          Math.max(follow.current.y, FLOOR_Y + 0.3),
          follow.current.z,
        ),
        dampFactor(6, dt),
      );
      target.set(look.x * 0.6, look.y + back * 0.12 + 0.2, look.z + back);
    }
    if (parallax) {
      target.x += state.pointer.x * distance * 0.08;
      target.y += state.pointer.y * distance * 0.05;
    }

    if (intro && elapsed < INTRO_SECONDS) {
      camera.position.lerpVectors(
        start,
        target,
        easeOutQuart(elapsed / INTRO_SECONDS),
      );
    } else {
      camera.position.lerp(target, dampFactor(5, dt));
    }
    camera.lookAt(look);
  });

  return null;
}

/**
 * The key light, and the only one that casts a shadow: a real shadow map, so
 * whatever is lit is grounded wherever it lands or flies. It looks at `centre`
 * and its shadow frustum spans `reach` around it — the size of the play area.
 */
function Sun({
  centre,
  reach,
}: {
  readonly centre: readonly [number, number, number];
  readonly reach: number;
}) {
  const target = useMemo(() => new THREE.Object3D(), []);
  const [cx, cy, cz] = centre;
  return (
    <>
      <primitive object={target} position={[cx, cy, cz]} />
      <directionalLight
        castShadow
        target={target}
        position={[cx + reach * 0.4, reach * 1.2, cz + reach * 0.6]}
        intensity={2.2}
        shadow-mapSize={[4096, 4096]}
        shadow-camera-near={1}
        shadow-camera-far={reach * 4}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
    </>
  );
}

/**
 * A soft studio. Big, dim panels rather than bright strips: a can is a
 * cylinder, and a narrow bright source reflects off it as a hard vertical bar
 * across the artwork. Wide, gentle sources wrap it in a graded sheen instead.
 * The room is the stage's green, so the metal picks up its surroundings the way
 * a real can on a green backdrop would.
 */
function Studio({ resolution }: { readonly resolution: number }) {
  return (
    <Environment resolution={resolution} frames={1}>
      <mesh scale={50}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#1f5a3d" side={THREE.BackSide} />
      </mesh>
      {/* Softbox overhead, large and gentle. */}
      <Lightformer
        form="rect"
        intensity={2.4}
        position={[0, 6, 1]}
        rotation-x={Math.PI / 2}
        scale={[14, 8, 1]}
      />
      {/* Warm key panel, camera left, high. */}
      <Lightformer
        form="rect"
        intensity={1.6}
        color="#fff3e0"
        position={[-6, 3, 4]}
        rotation-y={Math.PI / 3}
        scale={[6, 8, 1]}
      />
      {/* Cool fill panel, camera right, lower and dimmer. */}
      <Lightformer
        form="rect"
        intensity={1}
        color="#e2ecff"
        position={[6, 1, 3]}
        rotation-y={-Math.PI / 3}
        scale={[6, 8, 1]}
      />
      {/* A broad glow behind, so the silhouette edges catch a little light. */}
      <Lightformer
        form="circle"
        intensity={0.8}
        color="#cfe3d6"
        position={[0, 2, -8]}
        scale={12}
      />
    </Environment>
  );
}

// ─── Public component ─────────────────────────────────────

export type MateCanDetail = "full" | "icon";
export type MateCanMode = "sway" | "flip" | "knockdown";

export interface MateCan3DProps {
  readonly className?: string;
  /**
   * `full` is the hero: shadows, high-res environment, big texture. `icon`
   * trims all of that for a logo-sized canvas that lives on every page.
   */
  readonly detail?: MateCanDetail;
  /** Drag to turn the can, in any direction, with inertia. */
  readonly interactive?: boolean;
  /** Fly the camera in and unwind the can on mount. */
  readonly intro?: boolean;
  /** `sway` turns in place; `flip` is the bottle-flip game. */
  readonly mode?: MateCanMode;
  /** Artwork wrapped around the can: full-size, a smaller one for logos, and its turn. */
  readonly label: {
    readonly url: string;
    readonly small: string;
    readonly turn?: number;
  };
  /** Flip mode: called when a thrown can comes to rest — standing or not, flipped or not. */
  readonly onLand?: (upright: boolean, flipped: boolean) => void;
  /** Knockdown mode: the labels to mix on the pyramid, and progress reports. */
  readonly labels?: readonly { readonly url: string; readonly turn?: number }[];
  readonly onReport?: (report: KnockdownReport) => void;
}

/** Camera distance that frames `height` at `fill` of the viewport. */
function distanceFor(height: number, fill: number): number {
  const halfFov = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
  return height / (fill * 2 * Math.tan(halfFov));
}

export function MateCan3D({
  className,
  detail = "full",
  interactive = detail === "full",
  intro = detail === "full",
  mode = "sway",
  label,
  labels,
  onLand,
  onReport,
}: MateCan3DProps) {
  const icon = detail === "icon";
  const flip = mode === "flip";
  const knockdown = mode === "knockdown";
  const physics = flip || knockdown;
  // The flip game needs air above the table; the others frame the can tight.
  const distance = flip
    ? distanceFor(CAN_HEIGHT * FLIP_VIEW_HEIGHTS, 1)
    : distanceFor(CAN_HEIGHT, icon ? 0.92 : 0.78);
  const lookAtY = flip ? FLIP_LOOK_AT : 0;
  const state = useRef<CanState>(createCanState(intro));
  const focus = useRef(new THREE.Vector3());
  const [pose, setPose] = useState<CameraPose>(() => knockdownPose(FIRST_ROWS));
  const [rows, setRows] = useState(FIRST_ROWS);
  const [dragging, setDragging] = useState(false);
  const textureUrl = icon ? label.small : label.url;
  const turn = label.turn ?? 0;

  const updatePointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    state.current.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  };

  // Pointer handling sits on the wrapper, not a hit mesh, so a drag that
  // leaves the can keeps turning it; capturing the pointer makes it survive
  // leaving the element too.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = state.current;
    s.dragging = true;
    s.touched = true;
    s.presses += 1;
    s.spin.set(0, 0, 0);
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    s.lastTime = performance.now();
    updatePointer(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = state.current;
    if (!s.dragging) return;
    updatePointer(e);
    if (flip) return;
    const now = performance.now();
    const dt = Math.max((now - s.lastTime) / 1000, 1 / 240);
    const yaw = (e.clientX - s.lastX) * RAD_PER_PX;
    const pitch = (e.clientY - s.lastY) * RAD_PER_PX;
    // Sideways drags turn about the vertical, up-and-down ones about the
    // horizontal — both in world space, so the can turns the way the hand moves
    // whatever way it is already facing.
    s.orientation
      .premultiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw))
      .premultiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, pitch));
    // Smooth the instantaneous velocity a little; raw pointer deltas are
    // jittery and would make the release direction a coin toss.
    s.spin.lerp(new THREE.Vector3(pitch / dt, yaw / dt, 0), 0.5);
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    s.lastTime = now;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = state.current;
    if (!s.dragging) return;
    s.dragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  return (
    <div
      className={cn(
        "relative",
        interactive
          ? knockdown
            ? "cursor-crosshair touch-none"
            : dragging
              ? "cursor-grabbing touch-none"
              : "cursor-grab touch-none"
          : // Let the surrounding Link or button take clicks when the can is
            // just a picture; a static canvas has no business eating them.
            "pointer-events-none",
        className,
      )}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
    >
      <Canvas
        style={{ position: "absolute", inset: 0 }}
        shadows={!icon}
        dpr={icon ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{
          position: knockdown ? [...pose.position] : [0, lookAtY, distance],
          fov: CAMERA_FOV,
        }}
      >
        <Suspense fallback={null}>
          {physics ? (
            <Physics gravity={[0, -GRAVITY, 0]} timeStep={PHYSICS_STEP}>
              {knockdown ? (
                <Knockdown
                  textureUrl={textureUrl}
                  turn={turn}
                  state={state}
                  labels={labels?.length ? labels : [label]}
                  onReport={onReport}
                  onPose={(next, nextRows) => {
                    setPose(next);
                    setRows(nextRows);
                  }}
                />
              ) : (
                <FlipCan
                  state={state}
                  labels={labels?.length ? labels : [label]}
                  focus={focus}
                  onLand={onLand}
                />
              )}
              <Floor />
            </Physics>
          ) : (
            <SwayCan
              textureUrl={textureUrl}
              turn={turn}
              state={state}
              intro={intro}
              // A logo-sized can can afford a bigger sway; it has no text to keep legible.
              swayScale={icon ? 2 : 1}
            />
          )}
          <Studio resolution={icon ? 256 : 512} />
          <Sun
            // The gallery plays far down the range; the light and its shadow
            // frustum go where the cans are.
            centre={knockdown ? [0, 0, -RANGE_FOR_ROWS(rows) * 0.5] : [0, 0, 0]}
            // Wide enough to keep a shadow under a can shot clean off the range.
            reach={knockdown ? RANGE_FOR_ROWS(rows) * 0.9 + 10 : 8}
          />
          {!icon && (
            // The floor is invisible; only the shadow it catches is drawn.
            <mesh
              receiveShadow
              rotation-x={-Math.PI / 2}
              position-y={FLOOR_Y - 0.001}
            >
              <planeGeometry args={[80, 80]} />
              <shadowMaterial transparent opacity={0.38} />
            </mesh>
          )}
        </Suspense>
        <Rig
          distance={distance}
          lookAtY={lookAtY}
          intro={intro}
          parallax={interactive}
          follow={flip ? focus : undefined}
          pose={knockdown ? pose : undefined}
        />
      </Canvas>
    </div>
  );
}

useGLTF.preload(MODEL_URL, undefined, true);
