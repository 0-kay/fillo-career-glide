export interface Period {
  from: string;
  to: string;
}

export interface RangePair {
  current: Period;
  previous: Period;
}

const DAY = 86_400_000;

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

/**
 * Resolves a dashboard range into the current period and the equal-length period before it.
 * "today" / "7d" / "30d" end at the end of the current UTC day; "custom" takes from/to
 * (ISO dates, `to` inclusive).
 */
export function resolveRange(range: string | null, from?: string | null, to?: string | null, now = Date.now()): RangePair {
  const endOfToday = startOfUtcDay(now) + DAY;
  let start: number;
  let end: number;

  if (range === "custom") {
    const f = from ? Date.parse(from) : NaN;
    const t = to ? Date.parse(to) : NaN;
    if (Number.isNaN(f) || Number.isNaN(t)) throw new RangeError("custom range needs valid from and to");
    start = startOfUtcDay(f);
    end = startOfUtcDay(t) + DAY;
    if (end <= start) throw new RangeError("range end must be after start");
    if (end - start > 366 * DAY) throw new RangeError("range is limited to 366 days");
  } else {
    const days = range === "today" ? 1 : range === "30d" ? 30 : 7;
    end = endOfToday;
    start = end - days * DAY;
  }

  const length = end - start;
  return {
    current: { from: new Date(start).toISOString(), to: new Date(end).toISOString() },
    previous: { from: new Date(start - length).toISOString(), to: new Date(start).toISOString() },
  };
}
