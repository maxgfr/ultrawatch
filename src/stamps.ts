/** `12:34` or `1:02:03` → seconds; undefined when it is not a stamp. */
export function stampSeconds(stamp: string): number | undefined {
  if (!/^\d{1,2}(?::\d{2}){1,2}$/.test(stamp)) return undefined;
  return stamp.split(":").reduce((n, p) => n * 60 + Number(p), 0);
}
