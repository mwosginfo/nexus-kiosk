import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerCounterQueue } from '../src/dispatch/serial-queue.js';

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('calls to the same counter run strictly in order', async () => {
  // Nexus can call two numbers to one counter within milliseconds — calling
  // the next client auto-misses the current one, so both rows change at once.
  // Unserialised, those POSTs race and the wall can settle on the older number.
  const queue = new PerCounterQueue();
  const order: string[] = [];

  const a = queue.enqueue('7', async () => {
    await tick(30);
    order.push('a');
  });
  const b = queue.enqueue('7', async () => {
    await tick(1);
    order.push('b');
  });

  await Promise.all([a, b]);
  assert.deepEqual(order, ['a', 'b']);
});

test('different counters are not blocked by each other', async () => {
  const queue = new PerCounterQueue();
  const order: string[] = [];

  const slow = queue.enqueue('7', async () => {
    await tick(40);
    order.push('slow-counter-7');
  });
  const fast = queue.enqueue('3', async () => {
    await tick(1);
    order.push('fast-counter-3');
  });

  await Promise.all([slow, fast]);
  assert.deepEqual(order, ['fast-counter-3', 'slow-counter-7']);
});

test('a failing task does not stall the rest of its counter', async () => {
  const queue = new PerCounterQueue();
  const order: string[] = [];

  const bad = queue.enqueue('7', async () => {
    order.push('bad');
    throw new Error('boom');
  });
  const good = queue.enqueue('7', async () => {
    order.push('good');
  });

  await Promise.allSettled([bad, good]);
  assert.deepEqual(order, ['bad', 'good']);
});

test('pending returns to zero once everything settles', async () => {
  const queue = new PerCounterQueue();
  queue.enqueue('7', async () => tick(5));
  queue.enqueue('7', async () => tick(5));
  queue.enqueue('2', async () => tick(5));
  assert.equal(queue.pending, 3);
  await queue.drain();
  assert.equal(queue.pending, 0);
});
