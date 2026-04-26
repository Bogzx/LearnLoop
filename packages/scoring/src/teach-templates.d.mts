import type { Dimension } from '@trailhead/shared';

export interface DimensionTeachEntry {
  title: string;
  definition: string;
  why: string;
  question: string;
}

export declare const DIMENSION_TEACH: Record<Dimension, DimensionTeachEntry>;
