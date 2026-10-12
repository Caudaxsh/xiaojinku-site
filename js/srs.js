// Review scheduling. Day-based intervals per importance level, counted from
// the previous review:
//   3 stars: reviewed on day 5 and day 10 after first study, then mastered.
//   2 stars: reviewed once on day 10, then mastered.
//   1 star : seen once when first studied, no further reviews.

export const LADDERS = {
  3: [5, 5],
  2: [10],
  1: [],
};

export const STAR_LABELS = { 3: '最重要', 2: '重要', 1: '艱深少用' };

const pad = (n) => String(n).padStart(2, '0');

export function todayStr(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + days));
}

export function daysBetween(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function newCard(fields, today = todayStr()) {
  return {
    ...fields,
    stars: 0,
    status: 'new',
    step: 0,
    relearn: false,
    due: null,
    reps: 0,
    lapses: 0,
    addedAt: today,
    lastReviewed: null,
  };
}

export function isDue(card, today = todayStr()) {
  return card.status === 'active' && card.due !== null && card.due <= today;
}

/** First time the card is seen: the learner picks 1-3 stars. */
export function firstRating(card, stars, today = todayStr()) {
  const ladder = LADDERS[stars];
  const base = { ...card, stars, step: 0, relearn: false, reps: card.reps + 1, lastReviewed: today };
  if (!ladder.length) return { ...base, status: 'mastered', due: null };
  return { ...base, status: 'active', due: addDays(today, ladder[0]) };
}

/** Where the card goes next for each grade, without mutating it. */
export function review(card, grade, today = todayStr()) {
  const ladder = LADDERS[card.stars];
  const next = { ...card, reps: card.reps + 1, lastReviewed: today };

  if (grade === 'again') {
    return {
      ...next,
      lapses: card.lapses + 1,
      relearn: true,
      step: Math.max(0, card.step - 1),
      due: addDays(today, 1),
    };
  }

  // A card that was forgotten comes back at the same interval, not a longer one.
  if (card.relearn && grade === 'good') {
    return { ...next, relearn: false, due: addDays(today, ladder[card.step]) };
  }

  const advance = grade === 'easy' ? 2 : 1;
  const step = card.step + advance;
  if (step >= ladder.length) {
    return { ...next, relearn: false, step: Math.max(0, ladder.length - 1), status: 'mastered', due: null };
  }
  return { ...next, relearn: false, step, due: addDays(today, ladder[step]) };
}

/** Human readable interval label for a button, e.g. "明天" or "7 天後". */
export function previewInterval(card, grade, today = todayStr()) {
  const out = review(card, grade, today);
  if (out.status === 'mastered') return '已掌握';
  const days = daysBetween(today, out.due);
  if (days <= 1) return '明天';
  return `${days} 天後`;
}

export function changeStars(card, stars, today = todayStr()) {
  if (card.status === 'new') return { ...card, stars };
  const ladder = LADDERS[stars];
  if (!ladder.length) return { ...card, stars, status: 'mastered', relearn: false, due: null };
  if (card.status === 'mastered') {
    return { ...card, stars, status: 'active', step: 0, relearn: false, due: addDays(today, ladder[0]) };
  }
  const step = Math.min(card.step, ladder.length - 1);
  const cap = addDays(today, ladder[step]);
  return { ...card, stars, step, due: card.due && card.due < cap ? card.due : cap };
}

export function streak(days, today = todayStr()) {
  const set = new Set(days);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (set.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}
