/** Human-facing dates only; storage continues to use ISO dates. */
export function displayDate(date: Date, options: { heading?: boolean; time?: boolean; compact?: boolean } = {}): string {
  const day = date.getDate();
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  const month = date.toLocaleDateString("en-US", { month: options.heading ? "long" : "short" });
  if (options.compact) return `${day}${suffix} ${month}${date.getFullYear() === new Date().getFullYear() ? "" : ` ${date.getFullYear()}`}`;
  const weekday = options.heading ? `${date.toLocaleDateString("en-US", { weekday: "long" })}, ` : "";
  const year = options.heading ? "" : `, ${date.getFullYear()}`;
  const time = options.time ? `, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "";
  return `${weekday}${month} ${day}${suffix}${year}${time}`;
}
