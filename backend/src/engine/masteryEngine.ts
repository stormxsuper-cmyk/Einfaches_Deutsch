export interface ReviewResult { newInterval: number; newEaseFactor: number; newMasteryScore: number; nextReviewDate: string; }
export function calculateSpacedRepetition(quality: number, oldEase = 2.5, oldInterval = 0, oldMastery = 0): ReviewResult {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) throw new Error('qualityScore must be an integer from 0 to 5');
  if (!Number.isFinite(oldEase) || oldEase < 1.3 || oldEase > 5) throw new Error('currentEase must be between 1.3 and 5');
  if (!Number.isFinite(oldInterval) || oldInterval < 0 || oldInterval > 3650) throw new Error('currentInterval must be between 0 and 3650');
  let ease = oldEase + (0.1 - (5-quality)*(0.08+(5-quality)*0.02));
  ease = Math.max(1.3, ease);
  let interval = quality < 3 ? 1 : oldInterval === 0 ? 1 : oldInterval === 1 ? 6 : Math.max(1, Math.round(oldInterval * ease));
  const mastery = quality < 3 ? Math.max(0, Math.round(oldMastery * 0.8)) : Math.min(100, Math.max(0, oldMastery) + quality * 12);
  const next = new Date(); next.setDate(next.getDate() + interval);
  return { newInterval: interval, newEaseFactor: Number(ease.toFixed(2)), newMasteryScore: mastery, nextReviewDate: next.toISOString() };
}
