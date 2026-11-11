export type ClassNameValue = string | false | null | undefined;

export function classNames(...values: readonly ClassNameValue[]): string {
  return values.filter(Boolean).join(" ");
}
