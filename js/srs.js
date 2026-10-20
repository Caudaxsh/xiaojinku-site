// Review scheduling, counted in STUDY DAYS rather than calendar days.
//
// A study day is a calendar day on which at least one card was actually rated.
// Skipping a day does not advance the counter, so every pending review simply
// waits and shifts to the next time you study.
//
//   Import  -> the words come up the next time you study (first study, pick 1-3 stars).
//   3 stars -> one more review on the 3rd study day after that (shown as a dark card).
//   2 / 1 stars -> finished after the first study.

/** Study days between a study/review and the next review, per star level. */
export const LADDERS = {
  3: [3],
  2: [],
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

/* ---------------------------------------------------------- study-day clock */

export const newClock = () => ({ count: 0, last: '' });

/** The study day number you are on right now (today counts as the next one until you study). */
export function currentDay(clock, today = todayStr()) {
  return clock.last === today ? clock.count : clock.count + 1;
}

/** Call when a card is rated: today becomes a study day if it was not one yet. */
export function tickClock(clock, today = todayStr()) {
  return clock.last === today ? clock : { count: clock.count + 1, last: today };
}

/* -------------------------------------------------------------------- cards */

export function newCard(fields, today = todayStr()) {
  return {
    ...fields,
    stars: 0,
    status: 'new',
    step: 0,
    relearn: false,
    due: null, // study day number, not a date
    reps: 0,
    lapses: 0,
    addedAt: today,
    lastReviewed: null,
  };
}

/** `day` is the current study day number (see currentDay). */
export function isDue(card, day) {
  return card.status === 'active' && typeof card.due === 'number' && card.due <= day;
}

/** First time the card is seen: the learner picks 1-3 stars. */
export function firstRating(card, stars, day, today = todayStr()) {
  const ladder = LADDERS[stars];
  const base = { ...card, stars, step: 0, relearn: false, reps: card.reps + 1, lastReviewed: today };
  if (!ladder.length) return { ...base, status: 'mastered', due: null };
  return { ...base, status: 'active', due: day + ladder[0] };
}

/** Where the card goes next for each grade, without mutating it. */
export function review(card, grade, day, today = todayStr()) {
  const ladder = LADDERS[card.stars];
  const next = { ...card, reps: card.reps + 1, lastReviewed: today };

  if (grade === 'again') {
    return {
      ...next,
      lapses: card.lapses + 1,
      relearn: true,
      step: Math.max(0, card.step - 1),
      due: day + 1,
    };
  }

  // A card that was forgotten comes back at the same interval, not a longer one.
  if (card.relearn && grade === 'good') {
    return { ...next, relearn: false, due: day + ladder[card.step] };
  }

  const advance = grade === 'easy' ? 2 : 1;
  const step = card.step + advance;
  if (step >= ladder.length) {
    return { ...next, relearn: false, step: Math.max(0, ladder.length - 1), status: 'mastered', due: null };
  }
  return { ...next, relearn: false, step, due: day + ladder[step] };
}

/** Human readable interval label for a button. */
export function previewInterval(card, grade, day) {
  const out = review(card, grade, day);
  if (out.status === 'mastered') return '已掌握';
  const gap = out.due - day;
  return gap <= 1 ? '下次學習' : `${gap} 個學習日後`;
}

/** "下次學習時複習" / "再 2 個學習日" for lists. */
export function dueText(card, day) {
  if (card.status === 'new') return '待分級';
  if (card.status === 'mastered') return card.stars === 1 ? '不需複習' : '已掌握';
  const gap = card.due - day;
  if (gap <= 0) return '今天複習';
  if (gap === 1) return '下次學習複習';
  return `再 ${gap} 個學習日複習`;
}

/** A card that comes back for its follow-up review is shown as a dark card. */
export const isSecondReview = (card) => card.status === 'active';

export function changeStars(card, stars, day) {
  if (card.status === 'new') return { ...card, stars };
  const ladder = LADDERS[stars];
  if (!ladder.length) return { ...card, stars, status: 'mastered', relearn: false, due: null };
  if (card.status === 'mastered') {
    return { ...card, stars, status: 'active', step: 0, relearn: false, due: day + ladder[0] };
  }
  const step = Math.min(card.step, ladder.length - 1);
  const cap = day + ladder[step];
  return { ...card, stars, step, due: typeof card.due === 'number' && card.due < cap ? card.due : cap };
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

/**
 * New words come in batches: everything imported on the same day is one batch. A study day only
 * serves the oldest batch that still has unstudied words (plus any batch the learner chose to
 * continue with), so imports from several days never pile up into one huge session.
 */
export const batchOf = (card) => card.addedAt || '';

export function batchKeys(cards) {
  return [...new Set(cards.filter((c) => c.status === 'new').map(batchOf))].sort();
}

/** The unstudied words of the unlocked batches, in import order. */
export function unlockedNew(cards, keys) {
  return cards
    .filter((c) => c.status === 'new' && keys.includes(batchOf(c)))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
