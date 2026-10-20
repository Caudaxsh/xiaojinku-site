import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newCard, firstRating, review, changeStars, isDue, previewInterval, streak,
  newClock, currentDay, tickClock, dueText, isSecondReview,
} from '../js/srs.js';

const base = () => newCard({ id: 'x', word: 'x' }, '2026-10-12');

/** Simulate calendar days: only days on which something is studied advance the clock. */
function studyOn(clock, date) {
  return tickClock(clock, date);
}

test('study-day clock: only days with study advance it', () => {
  let clock = newClock();
  assert.equal(currentDay(clock, '2026-10-12'), 1);
  clock = studyOn(clock, '2026-10-12');
  assert.equal(currentDay(clock, '2026-10-12'), 1); // same day, still day 1
  assert.equal(currentDay(clock, '2026-10-13'), 2); // tomorrow would be day 2
  // Nothing studied on 10-13 and 10-14: the counter has not moved.
  assert.equal(currentDay(clock, '2026-10-15'), 2);
  clock = studyOn(clock, '2026-10-15');
  assert.equal(currentDay(clock, '2026-10-15'), 2);
  assert.equal(clock.count, 2);
});

test('a new card is not due until it has been rated', () => {
  assert.equal(isDue(base(), 99), false);
});

test('3 stars: reviewed again on the 3rd study day after the first study', () => {
  const c = firstRating(base(), 3, 1);
  assert.equal(c.status, 'active');
  assert.equal(c.due, 4);
  assert.equal(isDue(c, 2), false);
  assert.equal(isDue(c, 3), false);
  assert.equal(isDue(c, 4), true);
  assert.equal(isSecondReview(c), true);
  const done = review(c, 'good', 4);
  assert.equal(done.status, 'mastered');
  assert.equal(done.due, null);
});

test('skipped calendar days do not move the schedule', () => {
  let clock = studyOn(newClock(), '2026-10-12'); // day 1: learn
  const c = firstRating(base(), 3, currentDay(clock, '2026-10-12'), '2026-10-12');
  clock = studyOn(clock, '2026-10-13'); // day 2
  // Two weeks off.
  const back = currentDay(clock, '2026-10-27'); // day 3 when you come back
  assert.equal(back, 3);
  assert.equal(isDue(c, back), false);
  clock = studyOn(clock, '2026-10-27');
  clock = studyOn(clock, '2026-10-28'); // day 4
  assert.equal(isDue(c, currentDay(clock, '2026-10-28')), true);
});

test('2 stars and 1 star finish after the first study', () => {
  for (const stars of [2, 1]) {
    const c = firstRating(base(), stars, 1);
    assert.equal(c.status, 'mastered');
    assert.equal(c.due, null);
    assert.equal(isDue(c, 999), false);
    assert.equal(isSecondReview(c), false);
  }
});

test('forgetting brings it back at the next study, then resumes the same interval', () => {
  let c = firstRating(base(), 3, 1);
  c = review(c, 'again', 4);
  assert.equal(c.due, 5);
  assert.equal(c.lapses, 1);
  assert.equal(c.relearn, true);
  c = review(c, 'good', 5);
  assert.equal(c.relearn, false);
  assert.equal(c.due, 8);
  assert.equal(c.status, 'active');
  c = review(c, 'good', 8);
  assert.equal(c.status, 'mastered');
});

test('easy on the follow-up review finishes the word', () => {
  const c = review(firstRating(base(), 3, 1), 'easy', 4);
  assert.equal(c.status, 'mastered');
});

test('changing stars: to 1 star retires, a mastered word moved to 3 stars comes back', () => {
  const active = firstRating(base(), 3, 1);
  assert.equal(changeStars(active, 1, 2).status, 'mastered');
  const back = changeStars(firstRating(base(), 1, 1), 3, 2);
  assert.equal(back.status, 'active');
  assert.equal(back.due, 5);
  assert.equal(changeStars(active, 2, 2).status, 'mastered');
});

test('interval preview, due text and streak', () => {
  const c = firstRating(base(), 3, 1);
  assert.equal(previewInterval(c, 'again', 4), '下次學習');
  assert.equal(previewInterval(c, 'good', 4), '已掌握');
  assert.equal(dueText(c, 1), '再 3 個學習日複習');
  assert.equal(dueText(c, 3), '下次學習複習');
  assert.equal(dueText(c, 4), '今天複習');
  assert.equal(streak(['2026-10-12', '2026-10-11', '2026-10-10', '2026-10-08'], '2026-10-12'), 3);
  assert.equal(streak(['2026-10-11'], '2026-10-12'), 1);
  assert.equal(streak([], '2026-10-12'), 0);
});

test('new words come one import batch at a time, never piled up', async () => {
  const { batchKeys, unlockedNew } = await import('../js/srs.js');
  const mk = (date, n, from) => Array.from({ length: n }, (_, i) => newCard({ id: `${date}-${i}`, word: 'w', order: from + i }, date));
  let cards = [...mk('2026-10-12', 10, 0), ...mk('2026-10-13', 17, 10)];
  assert.deepEqual(batchKeys(cards), ['2026-10-12', '2026-10-13']);
  // The study day unlocks only the oldest batch.
  let keys = [batchKeys(cards)[0]];
  assert.equal(unlockedNew(cards, keys).length, 10);
  // Once that batch is studied, it stays closed until the learner continues or the next study day.
  cards = cards.map((c) => (c.addedAt === '2026-10-12' ? { ...c, status: 'active' } : c));
  assert.equal(unlockedNew(cards, keys).length, 0);
  keys = [batchKeys(cards)[0]]; // next study day
  assert.equal(unlockedNew(cards, keys).length, 17);
  // Two imports on the same day are a single batch.
  assert.equal(batchKeys([...mk('2026-10-14', 3, 0), ...mk('2026-10-14', 4, 3)]).length, 1);
});
