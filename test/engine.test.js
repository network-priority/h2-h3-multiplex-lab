// engine.test.js
// Invariant tests for the pure simulation engine. Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { simulate, simulateAll, mulberry32, DEFAULT_SETTINGS } from '../js/engine.js';
import { PRESETS } from '../js/presets.js';

const blog = PRESETS.blog.assets;
const gallery = PRESETS.gallery.assets;

test('mulberry32 is deterministic and stays in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
  // A different seed should diverge.
  const c = mulberry32(43);
  assert.notEqual(mulberry32(42)(), c());
});

test('simulate returns finite, ordered timing for every stream', () => {
  const r = simulate('h2', blog, { lossPct: 2 });
  assert.equal(r.streams.length, blog.length);
  for (const s of r.streams) {
    assert.ok(Number.isFinite(s.downloadStart), `${s.name} downloadStart finite`);
    assert.ok(Number.isFinite(s.downloadEnd), `${s.name} downloadEnd finite`);
    assert.ok(s.downloadEnd >= s.downloadStart, `${s.name} ends after it starts`);
    assert.ok(s.downloadStart >= 0);
  }
  assert.ok(r.metrics.totalTime > 0);
});

test('determinism: identical inputs (incl. seed) produce identical output', () => {
  const settings = { lossPct: 3, seed: 999, bandwidthMbps: 12 };
  const a = simulateAll(gallery, settings);
  const b = simulateAll(gallery, settings);
  assert.deepEqual(a, b);
});

test('the same seed drives the same loss pattern across protocols', () => {
  const settings = { lossPct: 2.5, seed: 7 };
  const a = simulate('h2', gallery, settings);
  const b = simulate('h3', gallery, settings);
  // Loss events are derived from workload + seed only, so the count matches.
  assert.equal(a.lossCount, b.lossCount);
  assert.ok(a.lossCount > 0, 'expected some loss events at 2.5% loss');
});

test('HTTP/1.1 opens more connections than the multiplexed protocols', () => {
  const { h1, h2, h3 } = simulateAll(gallery, { sharding: false });
  assert.ok(
    h1.metrics.connectionsUsed > h2.metrics.connectionsUsed,
    `h1 ${h1.metrics.connectionsUsed} should exceed h2 ${h2.metrics.connectionsUsed}`,
  );
  // Multiplexed protocols use exactly one connection per origin.
  const originCount = new Set(gallery.map((a) => a.origin)).size;
  assert.equal(h2.metrics.connectionsUsed, originCount);
  assert.equal(h3.metrics.connectionsUsed, originCount);
});

test('domain sharding lets HTTP/1.1 open even more connections', () => {
  const plain = simulate('h1', gallery, { sharding: false });
  const sharded = simulate('h1', gallery, { sharding: true, shardCount: 2 });
  assert.ok(
    sharded.metrics.connectionsUsed >= plain.metrics.connectionsUsed,
    'sharding should not reduce connection count',
  );
});

test('under packet loss, HTTP/3 total time <= HTTP/2 total time', () => {
  for (const seed of [1, 2, 42, 100, 2024]) {
    const { h2, h3 } = simulateAll(gallery, { lossPct: 3, seed });
    assert.ok(
      h3.metrics.totalTime <= h2.metrics.totalTime + 1e-6,
      `seed ${seed}: h3 ${h3.metrics.totalTime} should be <= h2 ${h2.metrics.totalTime}`,
    );
  }
});

test('HTTP/3 suffers no connection-level HOL stall; HTTP/2 does', () => {
  const { h2, h3 } = simulateAll(gallery, { lossPct: 3, seed: 5 });
  assert.equal(h3.metrics.holStallTime, 0, 'QUIC has no connection-wide HOL stall');
  assert.ok(h2.metrics.holStallTime > 0, 'TCP HOL blocking should cost time');
  assert.ok(h3.metrics.holStallTime <= h2.metrics.holStallTime);
});

test('with no loss there is no HOL stall on any protocol', () => {
  const { h1, h2, h3 } = simulateAll(blog, { lossPct: 0 });
  assert.equal(h1.metrics.holStallTime, 0);
  assert.equal(h2.metrics.holStallTime, 0);
  assert.equal(h3.metrics.holStallTime, 0);
});

test('QUIC 0-RTT resumption starts downloading sooner than a fresh QUIC handshake', () => {
  const fresh = simulate('h3', blog, { zeroRtt: false, lossPct: 0 });
  const resumed = simulate('h3', blog, { zeroRtt: true, lossPct: 0 });
  assert.ok(
    resumed.metrics.firstByte < fresh.metrics.firstByte,
    '0-RTT should reach first byte earlier',
  );
});

test('priority reorders finish order on HTTP/2', () => {
  // A small low-priority asset and a larger high-priority asset on one origin.
  // Without priority the small one finishes first; with priority the weighted
  // high-priority asset overtakes it.
  const workload = [
    { name: 'low.js', type: 'js', size: 120, priority: 'low', origin: 'www' },
    { name: 'high.js', type: 'js', size: 220, priority: 'high', origin: 'www' },
  ];
  const settings = { lossPct: 0, bandwidthMbps: 4, rttMs: 40 };

  const withPrio = simulate('h2', workload, { ...settings, h2Priority: true });
  const withoutPrio = simulate('h2', workload, { ...settings, h2Priority: false });

  const endOf = (res, name) => res.streams.find((s) => s.name === name).downloadEnd;

  // With priority: high finishes before low.
  assert.ok(
    endOf(withPrio, 'high.js') < endOf(withPrio, 'low.js'),
    'priority on: high-priority asset should finish first',
  );
  // Without priority (equal weight): the smaller low-priority asset finishes first.
  assert.ok(
    endOf(withoutPrio, 'low.js') < endOf(withoutPrio, 'high.js'),
    'priority off: smaller asset should finish first',
  );
});

test('priority has little effect on HTTP/1.1 finish order (FIFO per connection)', () => {
  const workload = [
    { name: 'low.js', type: 'js', size: 120, priority: 'low', origin: 'www' },
    { name: 'high.js', type: 'js', size: 220, priority: 'high', origin: 'www' },
  ];
  const settings = { lossPct: 0, bandwidthMbps: 4, rttMs: 40 };
  const on = simulate('h1', workload, { ...settings, h2Priority: true });
  const off = simulate('h1', workload, { ...settings, h2Priority: false });
  const endOf = (res, name) => res.streams.find((s) => s.name === name).downloadEnd;
  // H1 ignores priority, so the two runs are identical.
  assert.equal(endOf(on, 'high.js'), endOf(off, 'high.js'));
  assert.equal(endOf(on, 'low.js'), endOf(off, 'low.js'));
});

test('higher packet loss never makes a protocol faster', () => {
  const clean = simulate('h2', gallery, { lossPct: 0, seed: 3 });
  const lossy = simulate('h2', gallery, { lossPct: 4, seed: 3 });
  assert.ok(lossy.metrics.totalTime >= clean.metrics.totalTime - 1e-6);
});

test('an LCP asset is identified and its finish is recorded', () => {
  const r = simulate('h3', blog, {});
  const lcp = r.streams.find((s) => s.isLcp);
  assert.ok(lcp, 'expected an LCP asset to be flagged');
  assert.equal(r.metrics.lcpFinish, lcp.downloadEnd);
});

test('DEFAULT_SETTINGS is frozen and complete', () => {
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
  for (const key of ['rttMs', 'bandwidthMbps', 'lossPct', 'seed']) {
    assert.ok(key in DEFAULT_SETTINGS, `missing default: ${key}`);
  }
});
