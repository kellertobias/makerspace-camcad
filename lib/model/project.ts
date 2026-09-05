/**
 * Core document model for the CAM application.
 * All lengths are millimetres, all angles degrees unless noted, Y axis points up (machine convention).
 */
export type Id = string;
export interface Vec2 { x: number; y: number }
/** 2x3 affine matrix [a b c d e f] mapping (x,y) -> (a*x + c*y + e, b*x + d*y + f). */
export type Mat = [number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
export type Segment =
  | { k: 'L'; to: Vec2 }
  /** Circular arc from the previous point to `to` around centre `c`; `cw` = clockwise in Y-up coordinates. */
  | { k: 'A'; to: Vec2; c: Vec2; cw: boolean };

export interface Path {
  id: Id;
  start: Vec2;
  segs: Segment[];
  closed: boolean;
  layer?: string;
}

export type ShapeKind = 'outline' | 'text' | 'point';

export interface TextSpec { text: string; font: string; size: number; lineHeight?: number; letterSpacing?: number; align?: 'left' | 'center' | 'right' }

export interface Shape {
  id: Id;
  name: string;
  kind: ShapeKind;
  paths: Path[];
  /** Source file name for reference. */
  source?: string;
  text?: TextSpec;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export interface ArraySpec { nx: number; ny: number; dx: number; dy: number }

export interface Placement {
  id: Id;
  shapeId: Id;
  name: string;
  transform: Mat;
  array?: ArraySpec;
  groupId?: Id;
  locked?: boolean;
  visible?: boolean;
}

export interface Group {
  id: Id;
  name: string;
  parentId?: Id;
  /** Additional start depth (positive = deeper) added to every operation of the group's members. */
  zOffset: number;
}

export type Material = 'mdf' | 'osb' | 'plywood' | 'wood' | 'aluminium' | 'acrylic' | 'generic';
export type OriginMode = 'manual' | 'sheet-corner' | 'sheet-center' | 'parts-bbox-corner' | 'parts-bbox-center';
export type Corner = 'bl' | 'br' | 'tl' | 'tr';

export interface Stock {
  width: number;
  height: number;
  thickness: number;
  material: Material;
  origin: { mode: OriginMode; corner: Corner; manual: Vec2 };
  /** Where Z = 0 sits: on top of the stock or on the machine bed. */
  zZero: 'top' | 'bottom';
  /** Height for rapid moves between operations. */
  safeZ: number;
  /** Height above the surface where the rapid down move ends and the feed move starts. */
  clearZ: number;
}

// ---------------------------------------------------------------------------
// Tools & machines
// ---------------------------------------------------------------------------
export type ToolKind = 'endmill' | 'facemill' | 'ballnose' | 'vbit' | 'drill' | 'saw' | 'laser';

export interface CuttingData {
  /** Spindle speed (1/min) */
  n?: number;
  /** Cutting speed (m/min) */
  vc?: number;
  /** Feed per tooth (mm) */
  fz?: number;
  /** XY feed (mm/min) */
  vf?: number;
  /** Plunge feed (mm/min) */
  vfPlunge?: number;
  /** Depth per pass (mm) */
  stepDown: number;
  /** Step-over for pockets, in % of diameter */
  stepOverPct: number;
  /** Ramp angle for ramp entries (deg) */
  rampAngle?: number;
  /** Laser power in % */
  power?: number;
  /** Laser passes */
  passes?: number;
}

export interface Tool {
  id: Id;
  kind: ToolKind;
  name: string;
  /** Tool number (T word) */
  slot: number;
  /** Diameter (mm). For lasers: beam/kerf width. */
  d: number;
  /** Number of flutes */
  z?: number;
  fluteLength?: number;
  /** V-bit / drill tip angle (deg) */
  tipAngle?: number;
  cut: CuttingData;
  materialOverrides?: Partial<Record<Material, Partial<CuttingData>>>;
  notes?: string;
}

export type MachineKind = 'cnc' | 'laser';

export interface Machine {
  id: Id;
  kind: MachineKind;
  name: string;
  /** Post-processor profile id */
  postId: Id;
  travel: { x: number; y: number; z: number };
  nMax: number;
  nMin: number;
  feedMax: { xy: number; z: number };
  rapid: { xy: number; z: number };
  toolChange: 'manual' | 'auto';
  /** Whether climb milling may be used on this machine. Undefined/false = conventional only (default for the wood CNCs). */
  climbAllowed?: boolean;
  laser?: { sMax: number; dynamic: boolean };
  info?: string;
  /** Toolset: tools available on this machine (ids from the library). Undefined = every tool. */
  toolIds?: Id[];
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export type Side = 'outside' | 'inside' | 'on' | 'left' | 'right';
export type PickKind = 'contour' | 'shape-center' | 'line-center' | 'point';

export interface Target {
  placementId: Id;
  /** Path within the shape; omitted for `shape-center` picks. */
  pathId?: Id;
  pick: PickKind;
  /**
   * Free point (drilling, threading) in the local coordinates of `placementId` so it follows the part; with an empty
   * placementId the point is in sheet (world) coordinates. Arrays replicate it per instance.
   */
  point?: Vec2;
  /** Pockets: 'exclude' marks a contour that must stay (standoff / mounting spot); `margin` = extra material kept around it. */
  role?: 'cut' | 'exclude';
  margin?: number;
}

export interface TabsSpec {
  count: number;
  width: number;
  height: number;
  /** auto = opposite straight sides first; manual = the `points` placed in the 2D view. */
  mode?: 'auto' | 'manual';
  /** Manual bridge positions in the local coordinates of the placement they belong to. */
  points?: { placementId: Id; x: number; y: number }[];
  /** @deprecated fractions along the path (older files) */
  positions?: number[];
}
export type Overcut = { kind: 'none' } | { kind: 'dogbone' | 'tbone' };
export type Entry = { kind: 'plunge' } | { kind: 'ramp'; angle: number } | { kind: 'helix' };

export interface OperationBase {
  id: Id;
  name: string;
  toolId: Id;
  targets: Target[];
  enabled: boolean;
  order: number;
  /** Total depth below Z0 (positive number, mm). */
  depth: number;
  /** Override of the tool's step-down. */
  stepDown?: number;
  feed?: { vf?: number; vfPlunge?: number; n?: number };
  /** Start position along the contour (0..1 of the path length). */
  startT?: number;
  /** Start angle for circular contours (deg). Overrides startT when set. */
  startAngle?: number;
  entry: Entry;
  climb: boolean;
  /** Start depth below Z0 (positive = deeper), e.g. 2 after planing 2 mm. Cutting spans start..start+depth. */
  zOffset: number;
}

export type OperationVariant =
  | { type: 'contour'; side: Side; overcut: Overcut }
  | { type: 'cutout'; side: 'outside' | 'inside'; tabs?: TabsSpec; overcut: Overcut }
  /** Pocket: wall pass on the given side first, then the interior with the step-over.
   *  For side 'outside', `outsideWidth` is how much material is removed around the contour, in mm or in tool widths (`outsideWidthUnit`). */
  | { type: 'pocket'; side: 'inside' | 'on' | 'outside'; outsideWidth?: number; outsideWidthUnit?: 'mm' | 'tool'; strategy: 'offset' | 'raster' | 'zigzag'; rasterAngle: number; stepOverPct?: number; islands: 'auto' | 'none'; overcut: Overcut }
  | { type: 'engrave'; side: Side }
  | { type: 'drill'; mode: 'plunge' | 'peck' | 'helix'; peck?: number; dwell?: number }
  | { type: 'thread'; pitch: number; majorD: number; internal: boolean; passes: number }
  | { type: 'laser-cut'; power: number; speed: number; passes: number; kerfSide: Side }
  | { type: 'laser-engrave'; power: number; speed: number; mode: 'vector' | 'hatch'; hatchPitch: number; hatchAngle: number; passes?: number; /** hatch: also trace the contour */ outline?: boolean };

export type Operation = OperationBase & OperationVariant;
export type OperationType = OperationVariant['type'];

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------
export const SCHEMA_VERSION = 2;

export interface Project {
  schemaVersion: number;
  id: Id;
  name: string;
  created: string;
  modified: string;
  machineId: Id;
  stock: Stock;
  shapes: Record<Id, Shape>;
  placements: Record<Id, Placement>;
  groups: Record<Id, Group>;
  operations: Record<Id, Operation>;
  /** Tools are snapshotted into the project so a file is self contained. */
  tools: Record<Id, Tool>;
}
