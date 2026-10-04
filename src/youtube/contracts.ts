export const errorMessages = {
  notLive: 'ライブ配信中の動画ではありません。',
  chatDisabled: '取得できるライブチャットがありません。',
  ended: 'ライブ配信またはチャットは終了しました。',
  notFound: '動画またはチャットが見つかりません。',
  quota: 'YouTube APIの利用上限に達しました。',
  auth: 'YouTube APIキーまたはAPIの設定を確認してください。',
  forbidden: 'このチャットへのアクセスが許可されていません。',
  network: 'YouTube APIとの通信に失敗しました。',
  rateLimited: '取得間隔の制限に達しました。時間をおいて再開してください。',
  unavailable: 'YouTube APIが一時的に利用できません。',
  invalidResponse: 'YouTube APIの応答が不正なため停止しました。',
  invalidInput: '動画IDまたは取得設定が不正です。',
  aborted: '取得を停止しました。',
  api: 'YouTube APIの取得に失敗しました。',
} as const;

export type ErrorCode = keyof typeof errorMessages;
export type ChatError = { code: ErrorCode; message: string; retryAfterMillis?: number };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ChatError };
export type ChatMessage = { id: string; text: string; authorChannelId: string; type: string };
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
