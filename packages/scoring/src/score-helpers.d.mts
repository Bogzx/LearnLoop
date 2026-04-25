export interface BuildScoreUserPromptArgs {
  prompt: string;
  file_path?: string;
}
export declare function buildScoreUserPrompt(args: BuildScoreUserPromptArgs): string;

export interface BuildAugmentationOpts {
  original: string;
  missing: Partial<Record<string, string>>;
}
export declare function buildAugmentation(opts: BuildAugmentationOpts): string;
