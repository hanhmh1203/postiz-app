export function fallbackDateWithoutPostingTimes(
  postingTimes: number[],
  now = new Date()
): string | null {
  if (postingTimes.length > 0) return null;

  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  nextHour.setUTCMinutes(0, 0, 0);
  return nextHour.toISOString().slice(0, 19);
}
