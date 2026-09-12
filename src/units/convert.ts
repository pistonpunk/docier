import {
  eighthPoint,
  emu,
  halfPoint,
  mp,
  percentFiftieth,
  pt,
  roundHalfEven,
  twip,
} from './brand.js';
import type { EighthPoint, Emu, HalfPoint, Mp, PercentFiftieth, Point, Twip } from './brand.js';
import {
  EMU_PER_POINT,
  EMU_PER_TWIP,
  EMU_TO_MP_DEN,
  EMU_TO_MP_NUM,
  MP_PER_EIGHTH_POINT,
  MP_PER_HALF_POINT,
  MP_PER_POINT,
  MP_PER_TWIP,
  PERCENT_FIFTIETHS_PER_PERCENT,
  TWIPS_PER_INCH,
  TWIPS_PER_POINT,
} from './constants.js';

export const twipToMp = (value: Twip): Mp => mp(value * MP_PER_TWIP);
export const mpToTwip = (value: Mp): Twip => twip(roundHalfEven(value / MP_PER_TWIP));

export const pointToMp = (value: Point): Mp => mp(roundHalfEven(value * MP_PER_POINT));
export const mpToPoint = (value: Mp): Point => pt(value / MP_PER_POINT);

export const halfPointToMp = (value: HalfPoint): Mp => mp(value * MP_PER_HALF_POINT);
export const mpToHalfPoint = (value: Mp): HalfPoint => halfPoint(roundHalfEven(value / MP_PER_HALF_POINT));

export const eighthPointToMp = (value: EighthPoint): Mp => mp(value * MP_PER_EIGHTH_POINT);
export const mpToEighthPoint = (value: Mp): EighthPoint =>
  eighthPoint(roundHalfEven(value / MP_PER_EIGHTH_POINT));

export const emuToMp = (value: Emu): Mp => mp(roundHalfEven((value * EMU_TO_MP_NUM) / EMU_TO_MP_DEN));
export const mpToEmu = (value: Mp): Emu => emu(roundHalfEven((value * EMU_TO_MP_DEN) / EMU_TO_MP_NUM));

export const twipToEmu = (value: Twip): Emu => emu(value * EMU_PER_TWIP);
export const emuToTwip = (value: Emu): Twip => twip(roundHalfEven(value / EMU_PER_TWIP));

export const pointToEmu = (value: Point): Emu => emu(roundHalfEven(value * EMU_PER_POINT));
export const emuToPoint = (value: Emu): Point => pt(value / EMU_PER_POINT);

export const pointToTwip = (value: Point): Twip => twip(roundHalfEven(value * TWIPS_PER_POINT));
export const twipToPoint = (value: Twip): Point => pt(value / TWIPS_PER_POINT);

export const pointToHalfPoint = (value: Point): HalfPoint => halfPoint(roundHalfEven(value * 2));
export const halfPointToPoint = (value: HalfPoint): Point => pt(value / 2);

export const inchToTwip = (value: number): Twip => twip(roundHalfEven(value * TWIPS_PER_INCH));
export const twipToInch = (value: Twip): number => value / TWIPS_PER_INCH;

export const percentFiftiethToRatio = (value: PercentFiftieth): number =>
  value / PERCENT_FIFTIETHS_PER_PERCENT / 100;
export const ratioToPercentFiftieth = (value: number): PercentFiftieth =>
  percentFiftieth(roundHalfEven(value * PERCENT_FIFTIETHS_PER_PERCENT * 100));

export const EMU_TO_MP_EXACT_LIMIT = Number.MAX_SAFE_INTEGER / EMU_TO_MP_NUM;
export const MP_TO_EMU_EXACT_LIMIT = Number.MAX_SAFE_INTEGER / EMU_TO_MP_DEN;

export const isExactEmuToTwip = (value: Emu): boolean => value % EMU_PER_TWIP === 0;
export const isExactEmuToMp = (value: Emu): boolean => (value * EMU_TO_MP_NUM) % EMU_TO_MP_DEN === 0;
export const isExactEmuToPoint = (value: Emu): boolean => value % EMU_PER_POINT === 0;

export const isExactMpToTwip = (value: Mp): boolean => value % MP_PER_TWIP === 0;
export const isExactMpToHalfPoint = (value: Mp): boolean => value % MP_PER_HALF_POINT === 0;
export const isExactMpToEighthPoint = (value: Mp): boolean => value % MP_PER_EIGHTH_POINT === 0;
export const isExactMpToPoint = (value: Mp): boolean => value % MP_PER_POINT === 0;
export const isExactMpToEmu = (value: Mp): boolean => (value * EMU_TO_MP_DEN) % EMU_TO_MP_NUM === 0;
