/**
 * LinkedIn "little text format": these characters have meaning in post
 * commentary (mentions, hashtags, templates) and must be backslash-escaped
 * to appear literally. Hashtags are kept: "#topic" is wanted in posts.
 */
const RESERVED = /[\\|{}@[\]()<>*_~]/g;

export function escapeLittleText(value: string): string {
  return value.replace(RESERVED, (char) => `\\${char}`);
}

/**
 * LinkedIn-Version header (YYYYMM). Versions are supported for about a year,
 * so two months back is always live without a code change each month.
 */
export function linkedInVersion(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
