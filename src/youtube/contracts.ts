export const errorMessages = {
  confirmationRequired: '設定で利用規約案・プライバシーポリシー案とデータの扱いに同意してください。同意できるまで外部送信しません。',
  notLive: 'ライブ配信中の動画ではありません。配信中の動画を選び直してください。',
  chatDisabled: '取得できるライブチャットがありません。別の配信を選んでください。',
  ended: 'ライブ配信またはチャットは終了しました。別の配信を選んでください。',
  notFound: '動画またはチャットが見つかりません。視聴タブから選び直してください。',
  quota: 'YouTube APIの利用上限に達しました。利用枠を確認し、回復してから取得を再開してください。',
  auth: 'YouTube APIキーまたはAPIの設定を確認してください。',
  forbidden: 'このチャットを取得できません。視聴タブから対象を選び直してください。',
  network: 'YouTubeとの通信に失敗しました。接続を確認し、時間をおいて取得を再開してください。',
  rateLimited: '取得間隔の制限に達しました。時間をおいて再開してください。',
  unavailable: 'YouTubeが一時的に利用できません。時間をおいて取得を再開してください。',
  invalidResponse: 'YouTubeからのデータを確認できず、取得を停止しました。時間をおいて取得を再開してください。',
  invalidInput: '対象動画や取得設定を確認できません。視聴タブから対象を選び直してください。',
  aborted: '取得を停止しました。',
  api: 'YouTubeからコメントを取得できませんでした。時間をおいて取得を再開してください。',
} as const;

export type ErrorCode = keyof typeof errorMessages;
export type ChatError = { code: ErrorCode; message: string; retryAfterMillis?: number };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ChatError };
export const validDisplayName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export type ChatMessage = { id: string; text: string; authorChannelId: string; authorDisplayName?: string; type: string; publishedAt?: string };
export type ChatPage = {
  messages: ChatMessage[];
  nextPageToken: string;
  pollingIntervalMillis: number;
  ended: boolean;
};
export type YouTubeClient = {
  resolveVideo(videoId: string, apiKey: string, signal: AbortSignal): Promise<Result<{ liveChatId: string }>>;
  listMessages(liveChatId: string, pageToken: string | undefined, apiKey: string, signal: AbortSignal): Promise<Result<ChatPage>>;
};

export function failure(code: ErrorCode, retryAfterMillis?: number): { ok: false; error: ChatError } {
  return { ok: false, error: { code, message: errorMessages[code],
    ...(retryAfterMillis === undefined ? {} : { retryAfterMillis }) } };
}
