import { expect, it } from 'vitest';
import { errorMessages, failure } from '../src/youtube/contracts';
it('YouTubeの全失敗表示は次操作を示しエラーcode/待機期限を変えない', () => {
  for (const code of Object.keys(errorMessages) as (keyof typeof errorMessages)[]) {
    const result = failure(code, 1234);
    expect(result.error.code).toBe(code); expect(result.error.retryAfterMillis).toBe(1234);
    if (code !== 'aborted') expect(result.error.message).toMatch(/選び|選ん|確認|同意|再開|押してください/);
    expect(result.error.message).not.toMatch(/IPC|raw|fixture|invalidResponse/);
  }
});
