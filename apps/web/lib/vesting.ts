/** Monthly UTC schedule (48 months by default), always anchored to the original start day. */
export function buildMonthlyBoundaries(startIso: string, months = 48): number[] {
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("Schedules run 1 to 120 months.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(startIso)) {
    throw new Error("Use a UTC start such as 2026-11-01T00:00:00Z.");
  }
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime()) || start.toISOString().replace(".000Z", "Z") !== startIso) {
    throw new Error("Invalid UTC start date.");
  }
  const year = start.getUTCFullYear();
  if (year < 1970 || year > 9995) throw new Error("UTC start is outside the supported range.");
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const hour = start.getUTCHours();
  const minute = start.getUTCMinutes();
  const second = start.getUTCSeconds();
  const boundaries = Array.from({ length: months + 1 }, (_, offset) => {
    const targetMonth = month + offset;
    const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
    return Date.UTC(year, targetMonth, Math.min(day, lastDay), hour, minute, second) / 1000;
  });
  if (!boundaries.every((value, index) => Number.isSafeInteger(value) && value > 0 && (index === 0 || value > boundaries[index - 1]))) {
    throw new Error("Schedule boundaries are invalid.");
  }
  return boundaries;
}

export function vestedAt(units: string, boundaries: number[], nowSeconds: number, entitlementCap = units): string {
  if (boundaries.length !== 49) throw new Error("Expected 49 vesting boundaries.");
  const completed = boundaries.reduce((count, boundary) => count + Number(nowSeconds >= boundary), 0) - 1;
  if (completed < 12) return "0";
  const scheduled = BigInt(units) * BigInt(Math.min(completed, 48)) / 48n;
  const cap = BigInt(entitlementCap);
  return (scheduled < cap ? scheduled : cap).toString();
}
