/** Human-facing dates only; storage continues to use ISO dates. */
export function displayDate(date: Date, options: { heading?: boolean; time?: boolean; compact?: boolean } = {}, now = new Date()): string {
  const day = date.getDate();
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  const month = date.toLocaleDateString("en-US", { month: options.heading ? "long" : "short" });
  if (options.compact) return `${month} ${day}${suffix}${date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`}`;
  const weekday = options.heading ? `${date.toLocaleDateString("en-US", { weekday: "long" })}, ` : "";
  const year = options.heading ? "" : `, ${date.getFullYear()}`;
  const time = options.time ? `, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "";
  return `${weekday}${month} ${day}${suffix}${year}${time}`;
}

export function relativeDate(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  // Compare local calendar days, including daylight-saving and year boundaries.
  if (date < today) {
    if (date >= yesterday) return "yesterday";
    return displayDate(date, { compact: true }, now);
  }
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
