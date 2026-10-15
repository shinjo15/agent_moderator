import type { Category, Values } from './policy';
export type Questions = Record<Category, { type: 'noul'; instructions: string; criteria: { true: string; false: string } }>;
export type Post = { text: string; publishedAt?: string };
export type EvaluationState = { target: Post; history: Post[] };
export type Evaluation = { values: Values; model: string; usage: { input_tokens: number; output_tokens: number } };
export type JevErrorCode = 'definition' | 'confirmationRequired' | 'missingKey' | 'auth' | 'validation' | 'rateLimited' | 'overloaded' | 'network' | 'invalidResponse' | 'aborted' | 'api';
export type JevError = { code: JevErrorCode; retryAfterMillis?: number };
export type JevResult = { ok: true; value: Evaluation } | { ok: false; error: JevError };
export type JevClient = {
  loadQuestions(signal: AbortSignal): Promise<Questions>;
  evaluate(state: EvaluationState, key: string, signal: AbortSignal, questions: Questions): Promise<JevResult>;
};
