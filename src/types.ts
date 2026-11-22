export type UnitCode = "m" | "cm" | "mm";
export type RoundDir = "n" | "d" | "u";
export type ViewMode = "cards" | "table";
export type PendingMode = "" | "L" | "W" | "B";
export type StepNum = 1 | 2 | 3 | 4;

export interface WindowRow {
  n: string;
  L: string;
  W: string;
  p?: PendingMode;
  q?: string;
}

export interface RelConfig {
  s: string;
  m: string;
  neg: boolean;
  a: string;
  dv?: boolean;
  s2?: string;
  op?: "+" | "-" | "*" | "/";
  n1?: boolean;
  a1?: string;
  n2?: boolean;
  a2?: string;
}

export interface RoundConfig {
  s: number;
  d: RoundDir;
}

export interface CustomField {
  id: string;
  name: string;
  group: string;
}

export interface UserType {
  name: string;
}

export interface LayoutConfig {
  units: string[];
  kids: Record<string, string[]>;
}

export interface AppState {
  type: string;
  rows: WindowRow[];
  sel: Record<string, boolean>;
  inc: Record<string, string>;
  dec: Record<string, string>;
  rel: Record<string, Record<string, RelConfig>>;
  rnd: Record<string, Record<string, RoundConfig>>;
  gr: RoundConfig;
  raw: boolean;
  custom: Record<string, CustomField[]>;
  cn: number;
  utypes: UserType[];
  cascade: boolean;
  layout: LayoutConfig;
  view: ViewMode;
  unit: UnitCode;
  step: StepNum;
}

export interface SavedProject {
  id: string;
  name: string;
  updatedAt: string;
  data: Omit<AppState, "raw">;
}

export interface ResultUnit {
  id: string;
  title: string;
  group: boolean;
  hue: number;
  ks: string[];
}

export interface ExportStructUnit {
  group: boolean;
  hue: number;
  label: string;
  name: string;
  subs: string[];
}

export interface ComputedWindow {
  n: string;
  nm: string;
  L: number | null;
  W: number | null;
  q: number;
  res: Record<string, number | "">;
  neg: boolean;
  row: WindowRow;
}

export interface DuplicateGroup {
  L: number;
  W: number;
  cnt: number;
  nums: string[];
}

export interface AreaTotalItem {
  key: string;
  label: string;
  totalInUnit: number;
  totalSqM: number;
}

export interface BuildResult {
  pend: string[];
  dups: DuplicateGroup[];
  dupRows: [string, string, string, string][];
  dupOther: number;
  negList: number[];
  negSeq: number[];
  area: boolean;
  areaTotals: AreaTotalItem[];
  hasN: boolean;
  units: ResultUnit[];
  keys: string[];
  data: ComputedWindow[];
  bad: string | null;
  rndOn: boolean;
  hasQ: boolean;
  qtotal: number;
  xtable: string[][];
  xstruct: ExportStructUnit[];
  xc1: string[];
  xc2: string[];
  c1: string[];
  c2: string[];
  table: string[][];
  struct: ExportStructUnit[];
  type: string;
  adj: string;
  cascade: boolean;
}
