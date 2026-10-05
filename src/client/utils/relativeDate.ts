export function formatRelativeDate(iso: string, locale = 'en'): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (diffDays < 30) return rtf.format(-diffDays, 'day');
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return rtf.format(-diffMonths, 'month');
  return rtf.format(-Math.floor(diffDays / 365), 'year');
}
