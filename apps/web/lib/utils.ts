export function cn(...classes: Array<unknown>): string {
  return classes.filter(Boolean).join(" ");
}
