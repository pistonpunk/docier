declare const unitBrand: unique symbol;

export type Brand<TValue, TUnit extends string> = TValue & {
  readonly [unitBrand]: TUnit;
};

/**
 * Integer millipoints (1 mp = 1/1000 pt). The layout engine's internal unit (spec 02 §1.3).
 * All geometry is i32-range.
 */
export type Mp = Brand<number, 'mp'>;

/** English Metric Units: 914400 per inch, 12700 per point. OOXML DrawingML geometry. */
export type Emu = Brand<number, 'emu'>;

/** Twentieths of a point: 1440 per inch, 20 per point. OOXML WordprocessingML length unit. */
export type Twip = Brand<number, 'twip'>;

/** Points: 72 per inch. May be fractional. */
export type Point = Brand<number, 'point'>;

/** Half-points: the unit of `w:sz`, `w:szCs`, `w:position`. */
export type HalfPoint = Brand<number, 'halfPoint'>;

/** Eighths of a point: the unit of `w:sz` inside `w:pBdr` / `w:tcBorders`. */
export type EighthPoint = Brand<number, 'eighthPoint'>;

/** Fiftieths of a percent: the unit of `w:type="pct"` widths (`w:w="5000"` = 100%). */
export type PercentFiftieth = Brand<number, 'percentFiftieth'>;

export const mp = (value: number): Mp => value as Mp;
export const emu = (value: number): Emu => value as Emu;
export const twip = (value: number): Twip => value as Twip;
export const pt = (value: number): Point => value as Point;
export const halfPoint = (value: number): HalfPoint => value as HalfPoint;
export const eighthPoint = (value: number): EighthPoint => value as EighthPoint;
export const percentFiftieth = (value: number): PercentFiftieth => value as PercentFiftieth;

export const addMp = (a: Mp, b: Mp): Mp => (a + b) as Mp;
export const subMp = (a: Mp, b: Mp): Mp => (a - b) as Mp;
export const negateMp = (value: Mp): Mp => -value as Mp;
export const minMp = (a: Mp, b: Mp): Mp => (a < b ? a : b);
export const maxMp = (a: Mp, b: Mp): Mp => (a > b ? a : b);

export const roundHalfEven = (value: number): number => {
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) return floor + 1;
  if (remainder < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
};

export const scaleMp = (value: Mp, factor: number): Mp => mp(roundHalfEven(value * factor));
