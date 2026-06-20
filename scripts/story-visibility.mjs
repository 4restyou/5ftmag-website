export function seoulTodayIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function isPublishedContent(item, todayIso) {
  if (!item || item.published === false) return false;
  const date = String(item.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
  const today = typeof todayIso === 'string' ? todayIso : seoulTodayIso();
  return date <= today;
}
