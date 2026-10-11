export function validMaxClicks(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  const limit = Number(text);
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(limit) && limit <= 1_000_000_000_000;
}
