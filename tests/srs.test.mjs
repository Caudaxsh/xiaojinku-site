import test from 'node:test';
import assert from 'node:assert/strict';
import { newCard, firstRating, review, changeStars, isDue, addDays, previewInterval, streak, LADDERS } from '../js/srs.js';

const D0 = '2026-10-12';
const base = () => newCard({ id: 'x', word: 'x' }, D0);

test('new card is not due until it has been rated', () => {
  assert.equal(isDue(base(), D0), false);
});

test('first rating schedules by star ladder', () => {
  assert.equal(firstRating(base(), 3, D0).due, addDays(D0, 1));
  assert.equal(firstRating(base(), 2, D0).due, addDays(D0, 3));
  assert.equal(firstRating(base(), 1, D0).due, addDays(D0, 7));
});

test('1 star: exactly one more review, then mastered', () => {
  let c = firstRating(base(), 1, D0);
  c = review(c, 'good', c.due);
  assert.equal(c.status, 'mastered');
  assert.equal(c.due, null);
});

test('2 stars: three more reviews then mastered', () => {
  let c = firstRating(base(), 2, D0);
  const seen = [];
  while (c.status === 'active') {
    seen.push(c.due);
    c = review(c, 'good', c.due);
  }
  assert.equal(seen.length, LADDERS[2].length);
  assert.equal(c.status, 'mastered');
});

test('3 stars never retire and cap at the last interval', () => {
  let c = firstRating(base(), 3, D0);
  for (let i = 0; i < 20; i++) c = review(c, 'good', c.due);
  assert.equal(c.status, 'active');
  assert.equal(c.step, LADDERS[3].length - 1);
});

test('forgetting brings it back tomorrow, then resumes the same interval', () => {
  let c = firstRating(base(), 3, D0);
  c = review(c, 'good', c.due);           // step 1 (3 days)
  c = review(c, 'good', c.due);           // step 2 (7 days)
  const stepBefore = c.step;
  const day = c.due;
  c = review(c, 'again', day);
  assert.equal(c.due, addDays(day, 1));
  assert.equal(c.lapses, 1);
  c = review(c, 'good', c.due);
  assert.equal(c.relearn, false);
  assert.equal(c.step, stepBefore - 1);
});

test('easy skips a step; 1 star easy masters immediately', () => {
  let c = firstRating(base(), 3, D0);
  c = review(c, 'easy', c.due);
  assert.equal(c.step, 2);
  const one = review(firstRating(base(), 1, D0), 'easy', addDays(D0, 7));
  assert.equal(one.status, 'mastered');
});

test('changing stars re-clamps the schedule; mastered cards reactivate', () => {
  let c = firstRating(base(), 3, D0);
  c = review(c, 'good', c.due);
  c = changeStars(c, 1, c.due);
  assert.equal(c.stars, 1);
  assert.ok(c.step <= LADDERS[1].length - 1);
  let m = review(firstRating(base(), 1, D0), 'good', addDays(D0, 7));
  m = changeStars(m, 3, addDays(D0, 7));
  assert.equal(m.status, 'active');
});

test('interval preview and streak', () => {
  const c = firstRating(base(), 3, D0);
  assert.equal(previewInterval(c, 'again', D0), '明天');
  assert.equal(streak(['2026-10-12', '2026-10-11', '2026-10-10', '2026-10-08'], '2026-10-12'), 3);
  assert.equal(streak(['2026-10-11'], '2026-10-12'), 1);
  assert.equal(streak([], '2026-10-12'), 0);
});
