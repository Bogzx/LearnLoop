export declare const EXTRACT_SYSTEM_PROMPT: string;

export interface ExtractedLearning {
  node_path: string;
  insight: string;
}

export interface ExtractResult {
  learning: ExtractedLearning | null;
}

export declare function parseExtractResponse(raw: unknown): ExtractResult;
