import { DEFAULT_THRESHOLD, validThreshold } from './threshold';
export const definitions = {
  attack: '人への攻撃、侮辱、人格否定',
  hate: '属性に基づく差別・憎悪',
  threat: '脅迫または危害の扇動',
  sexualHarassment: '相手への性的嫌がらせ',
  doxxing: '他人の非公開の個人情報の晒し',
  spam: '迷惑な反復・大量投稿等のスパム',
  unrelatedPromotion: '配信に無関係な宣伝',
} as const;
export type Category = keyof typeof definitions;
export const categories = Object.keys(definitions) as Category[];
export type Values = Record<Category, number>;
export function decide(values: Values, threshold = DEFAULT_THRESHOLD) {
  if (!validThreshold(threshold)) throw new RangeError('Invalid moderation threshold');
  const reasons = categories.filter(key => values[key] >= threshold);
  return { malicious: reasons.length > 0, reasons };
}
