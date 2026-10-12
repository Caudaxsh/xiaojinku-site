import test from 'node:test';
import assert from 'node:assert/strict';
import { newCard, firstRating, review, changeStars, isDue, addDays, previewInterval, streak } from '../js/srs.js';

const D0 = '2026-10-12';
const base = () => newCard({ id: 'x', word: 'x' }, D0);

/** Review with "good" until mastered; return the dates it was due. */
function walk(card) {
  const dates = [];
  let c = card;
  while (c.status === 'active') {
    dates.push(c.due);
    c = review(c, 'good', c.due);
  }
  return { dates, final: c };
}

test('new card is not due until it has been rated', () => {
  assert.equal(isDue(base(), D0), false);
});

test('3 stars: reviewed on day 5 and day 10, then mastered', () => {
  const { dates, final } = walk(firstRating(base(), 3, D0));
  assert.deepEqual(dates, [addDays(D0, 5), addDays(D0, 10)]);
  assert.equal(final.status, 'mastered');
});

test('2 stars: reviewed once on day 10, then mastered', () => {
  const { dates, final } = walk(firstRating(base(), 2, D0));
  assert.deepEqual(dates, [addDays(D0, 10)]);
  assert.equal(final.status, 'mastered');
});

test('1 star: no further review at all', () => {
  const c = firstRating(base(), 1, D0);
  assert.equal(c.status, 'mastered');
  assert.equal(c.due, null);
  assert.equal(isDue(c, addDays(D0, 400)), false);
});

test('forgetting brings it back tomorrow, then resumes the same interval', () => {
  let c = firstRating(base(), 3, D0);
  const day5 = c.due;
  c = review(c, 'again', day5);
  assert.equal(c.due, addDays(day5, 1));
  assert.equal(c.lapses, 1);
  c = review(c, 'good', c.due);
  assert.equal(c.relearn, false);
  assert.equal(c.due, addDays(day5, 1 + 5));
  // The forgotten review is redone, so both scheduled reviews still happen.
  c = review(c, 'good', c.due);
  assert.equal(c.status, 'active');
  assert.equal(c.due, addDays(day5, 1 + 5 + 5));
  c = review(c, 'good', c.due);
  assert.equal(c.status, 'mastered');
});

test('easy on the first 3-star review finishes the word', () => {
  const c = review(firstRating(base(), 3, D0), 'easy', addDays(D0, 5));
  assert.equal(c.status, 'mastered');
});

test('changing stars: to 1 star retires, mastered word to 3 stars comes back', () => {
  const active = firstRating(base(), 3, D0);
  assert.equal(changeStars(active, 1, D0).status, 'mastered');
  const back = changeStars(firstRating(base(), 1, D0), 3, D0);
  assert.equal(back.status, 'active');
  assert.equal(back.due, addDays(D0, 5));
  const two = changeStars(active, 2, D0);
  assert.equal(two.status, 'active');
  assert.equal(two.due, addDays(D0, 5));
});

test('interval preview and streak', () => {
  const c = firstRating(base(), 3, D0);
  assert.equal(previewInterval(c, 'again', c.due), '明天');
  assert.equal(previewInterval(c, 'good', c.due), '5 天後');
  assert.equal(previewInterval(c, 'easy', c.due), '已掌握');
  assert.equal(streak(['2026-10-12', '2026-10-11', '2026-10-10', '2026-10-08'], '2026-10-12'), 3);
  assert.equal(streak(['2026-10-11'], '2026-10-12'), 1);
  assert.equal(streak([], '2026-10-12'), 0);
});
