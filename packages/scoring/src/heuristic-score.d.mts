export declare const HEURISTIC_SCORER: string;
export declare function heuristicScore(prompt: string): {
  dimensions: {
    goal_clarity: number;
    specificity: number;
    context_loading: number;
    constraint_articulation: number;
    output_specification: number;
  };
  missing: Partial<Record<
    'goal_clarity' | 'specificity' | 'context_loading' | 'constraint_articulation' | 'output_specification',
    string
  >>;
};
