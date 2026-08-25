import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameReader, encodeFrame } from '../src/qtech/framing.js';

test('newline framing round-trips', () => {
  const r = new FrameReader('newline');
  r.push(encodeFrame('{"a":1}', 'newline'));
  assert.equal(r.next(), '{"a":1}');
  assert.equal(r.next(), null);
});

test('length framing round-trips', () => {
  const r = new FrameReader('length');
  r.push(encodeFrame('{"a":1}', 'length'));
  assert.equal(r.next(), '{"a":1}');
  assert.equal(r.next(), null);
});

test('a message split across reads is reassembled', () => {
  // TCP will happily deliver half a message. Parsing whatever happens to be
  // in the buffer is how an integration works on a quiet desk and fails
  // under load.
  const r = new FrameReader('newline');
  const frame = encodeFrame('{"response":"Success"}', 'newline');
  r.push(frame.subarray(0, 7));
  assert.equal(r.next(), null, 'must wait for the rest');
  r.push(frame.subarray(7));
  assert.equal(r.next(), '{"response":"Success"}');
});

test('a length-framed message split mid-header is reassembled', () => {
  const r = new FrameReader('length');
  const frame = encodeFrame('{"a":1}', 'length');
  r.push(frame.subarray(0, 2));       // half the 4-byte length prefix
  assert.equal(r.next(), null);
  r.push(frame.subarray(2, 6));
  assert.equal(r.next(), null);
  r.push(frame.subarray(6));
  assert.equal(r.next(), '{"a":1}');
});

test('two messages in one read are returned one at a time', () => {
  const r = new FrameReader('newline');
  r.push(Buffer.concat([
    encodeFrame('{"n":1}', 'newline'),
    encodeFrame('{"n":2}', 'newline'),
  ]));
  assert.equal(r.next(), '{"n":1}');
  assert.equal(r.next(), '{"n":2}');
  assert.equal(r.next(), null);
});

test('raw framing is delimited by the peer closing', () => {
  const r = new FrameReader('raw');
  r.push(encodeFrame('{"a":1}', 'raw'));
  assert.equal(r.next(), null, 'nothing is complete until the close');
  assert.equal(r.flush(), '{"a":1}');
});

test('flush returns nothing for delimited framings', () => {
  const r = new FrameReader('newline');
  r.push(Buffer.from('partial'));
  assert.equal(r.flush(), null);
});

test('an oversized frame is rejected rather than buffered forever', () => {
  const r = new FrameReader('newline');
  assert.throws(() => r.push(Buffer.alloc(1024 * 65, 0x20)));
});

test('a bogus declared length is rejected', () => {
  const r = new FrameReader('length');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(0xffffff, 0);
  r.push(header);
  assert.throws(() => r.next());
});
