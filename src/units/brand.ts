declare const unitBrand: unique symbol;

export type Brand<TValue, TUnit extends string> = TValue & {
  readonly [unitBrand]: TUnit;
};

export type Mp = Brand<number, 'mp'>;

export type Emu = Brand<number, 'emu'>;

export type Twip = Brand<number, 'twip'>;

export type Point = Brand<number, 'point'>;

export type HalfPoint = Brand<number, 'halfPoint'>;

export type EighthPoint = Brand<number, 'eighthPoint'>;

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
