// engine.js
// Pure, DOM-free, deterministic simulation engine for the HTTP/1.1 vs HTTP/2 vs
// HTTP/3 multiplexing lab. Importable in both Node (tests) and the browser (UI).
//
// IMPORTANT: this is a TEACHING MODEL, not a packet-accurate network emulator.
// It captures the *qualitative* behaviour that distinguishes the protocols:
//   - connection setup cost (TCP+TLS vs QUIC),
//   - the HTTP/1.1 six-connections-per-origin limit and per-connection queueing,
//   - HTTP/2 / HTTP/3 multiplexing over a single connection,
//   - transport-level head-of-line (HOL) blocking under packet loss
//     (TCP stalls every stream; QUIC stalls only the affected stream),
//   - priority-weighted bandwidth sharing.
// See the "How the model works" panel and the README for the full write-up.

import { PROTOCOLS, PRIORITY_WEIGHT } from './protocols.js';

/** Approximate payload carried by one packet, in KB (~1460 bytes). */
const MSS_KB = 1.46;
/** Hard cap on simulation steps so a pathological input can never hang. */
const MAX_STEPS = 500000;

export const DEFAULT_SETTINGS = Object.freeze({
  rttMs: 60, // round-trip time, milliseconds
  bandwidthMbps: 20, // shared client link bandwidth
  lossPct: 1, // packet loss percentage (drives HOL demonstration)
  serverTtfbMs: 40, // server "think time" before first byte
  seed: 12345, // PRNG seed -> identical loss pattern for a fair comparison
  h2Priority: true, // honour stream priority on H2/H3
  sharding: false, // domain sharding for H1 (more parallel connections)
  shardCount: 2, // number of shard hostnames when sharding is on
  zeroRtt: false, // H3 0-RTT resumption (skips the QUIC handshake round trip)
});

/** Small, fast, fully-deterministic PRNG (mulberry32). Returns [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function priorityWeight(priority, usePriority) {
  if (!usePriority) return 1;
  return PRIORITY_WEIGHT[priority] ?? 1;
}

/** Pick an index in proportion to `weights`, using r in [0, 1). */
function weightedPick(weights, r) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Deterministically place loss events. The SAME event list is produced for every
 * protocol given identical settings, so H1/H2/H3 are compared on one loss pattern.
 * Each event names a stream (weighted by size) and the progress fraction at which
 * the loss is felt. Each event costs one RTT to recover.
 */
function generateLossEvents(streams, settings) {
  const loss = Math.max(0, settings.lossPct);
  if (loss <= 0) return [];
  const rand = mulberry32((settings.seed >>> 0) ^ 0x9e3779b9);
  const totalKB = streams.reduce((a, s) => a + s.size, 0);
  const totalPackets = Math.max(1, Math.ceil(totalKB / MSS_KB));
  const num = Math.round((totalPackets * loss) / 100);
  const weights = streams.map((s) => s.size);
  const events = [];
  for (let i = 0; i < num; i++) {
    const streamIndex = weightedPick(weights, rand());
    const frac = Math.min(0.999, rand());
    events.push({ streamIndex, frac });
  }
  return events;
}

/** Choose the "LCP" (largest contentful paint) asset for the milestone metric. */
function pickLcp(streams) {
  const imgs = streams.filter((s) => s.type === 'img');
  const pool = imgs.length
    ? imgs.filter((s) => s.priority === 'high').length
      ? imgs.filter((s) => s.priority === 'high')
      : imgs
    : streams;
  if (!pool.length) return null;
  return pool.reduce((a, b) => (b.size > a.size ? b : a));
}

/**
 * Simulate one protocol over a workload.
 *
 * @param {'h1'|'h2'|'h3'} protocolKey
 * @param {Array<{name,type,size,priority,origin}>} workload
 * @param {object} settingsIn  partial overrides of DEFAULT_SETTINGS
 * @returns {object} result with per-stream timing, metrics and milestones
 */
export function simulate(protocolKey, workload, settingsIn = {}) {
  const proto = PROTOCOLS[protocolKey];
  if (!proto) throw new Error(`Unknown protocol: ${protocolKey}`);
  if (!Array.isArray(workload) || workload.length === 0) {
    throw new Error('Workload must be a non-empty array of assets');
  }

  const settings = { ...DEFAULT_SETTINGS, ...settingsIn };
  const rtt = Math.max(1, settings.rttMs);
  const ttfb = Math.max(0, settings.serverTtfbMs);
  const bw = Math.max(0.01, settings.bandwidthMbps * 0.125); // Mbps -> KB/ms
  const usePriority = proto.priority && settings.h2Priority;

  // Handshake cost. QUIC 0-RTT resumption skips the round trip entirely.
  let handshakeRtt = proto.handshakeRTT;
  if (proto.key === 'h3' && settings.zeroRtt) handshakeRtt = 0;
  const handshakeMs = handshakeRtt * rtt;

  // HTTP/1.1 can multiply its connection budget through domain sharding.
  const shardFactor =
    proto.key === 'h1' && settings.sharding ? Math.max(1, Math.round(settings.shardCount)) : 1;
  const maxConnPerOrigin = proto.maxConnPerOrigin * shardFactor;

  // Build mutable stream state.
  const streams = workload.map((a, i) => ({
    index: i,
    name: a.name,
    type: a.type,
    priority: a.priority,
    origin: a.origin || 'origin',
    size: Math.max(0.1, a.size),
    weight: priorityWeight(a.priority, usePriority),
    remaining: Math.max(0.1, a.size),
    connId: null,
    connectStart: null,
    connectEnd: null,
    waitStart: null,
    waitEnd: null,
    downloadStart: null,
    downloadEnd: null,
    stalls: [],
    stallUntil: 0,
    lossFracs: [],
    lossPtr: 0,
    isLcp: false,
    done: false,
  }));

  // Deterministic loss events, attached to their streams.
  const lossEvents = generateLossEvents(streams, settings);
  for (const ev of lossEvents) streams[ev.streamIndex].lossFracs.push(ev.frac);
  for (const s of streams) s.lossFracs.sort((x, y) => x - y);

  // Connection pools, one per distinct origin.
  const origins = [...new Set(streams.map((s) => s.origin))];
  const conns = new Map();
  const originConns = new Map();
  const queues = new Map();
  let connSeq = 0;
  for (const o of origins) {
    originConns.set(o, []);
    queues.set(
      o,
      streams.filter((s) => s.origin === o).map((s) => s.index),
    );
  }

  function newConn(origin) {
    const id = `c${connSeq++}`;
    const c = {
      id,
      origin,
      opened: false,
      connectStart: null,
      connectEnd: null,
      active: new Set(),
      stallUntil: 0,
      // multiplexed protocols carry unlimited concurrent streams per connection
      freeSlots: proto.multiplex ? Infinity : 1,
    };
    conns.set(id, c);
    originConns.get(origin).push(id);
    return c;
  }

  // Assign queued streams to connections whenever capacity is available.
  function assign(now) {
    for (const o of origins) {
      const q = queues.get(o);
      const cids = originConns.get(o);
      let progressed = true;
      while (q.length && progressed) {
        progressed = false;
        let target = null;
        for (const cid of cids) {
          const c = conns.get(cid);
          if (c.freeSlots > 0) {
            target = c;
            break;
          }
        }
        if (!target && cids.length < maxConnPerOrigin) target = newConn(o);
        if (!target) break;

        const s = streams[q.shift()];
        if (!target.opened) {
          // This request pays for the connection handshake.
          target.opened = true;
          target.connectStart = now;
          target.connectEnd = now + handshakeMs;
          s.connectStart = now;
          s.connectEnd = target.connectEnd;
        } else {
          // Reused connection: no handshake bar for this request.
          s.connectStart = null;
          s.connectEnd = null;
        }
        s.connId = target.id;
        const reqAt = Math.max(now, target.connectEnd ?? now);
        s.waitStart = reqAt;
        s.waitEnd = reqAt + rtt + ttfb; // request travel + server think time
        s.downloadStart = s.waitEnd;
        target.active.add(s.index);
        if (target.freeSlots !== Infinity) target.freeSlots -= 1;
        progressed = true;
      }
    }
  }

  // Time step: small enough to resolve RTT-scale stalls, bounded for performance.
  const totalKB = streams.reduce((a, s) => a + s.size, 0);
  const estTotal = handshakeMs + rtt + ttfb + totalKB / bw + 6 * rtt;
  let dt = clamp(estTotal / 3000, 0.5, 20);
  dt = Math.min(dt, Math.max(0.5, rtt / 3), Math.max(0.5, (ttfb + rtt) / 4));

  let now = 0;
  let steps = 0;
  let holStallTime = 0; // connection-level (head-of-line) stall time

  while (steps < MAX_STEPS) {
    assign(now);
    if (streams.every((s) => s.done)) break;

    // --- Loss triggering: fire any events whose progress threshold is reached.
    for (const s of streams) {
      if (s.done || s.downloadStart == null || now < s.downloadStart) continue;
      const c = conns.get(s.connId);
      if (now < s.stallUntil || now < c.stallUntil) continue;
      const progress = 1 - s.remaining / s.size;
      while (s.lossPtr < s.lossFracs.length && progress >= s.lossFracs[s.lossPtr]) {
        s.lossPtr += 1;
        if (proto.tcpHol) {
          // TCP in-order delivery: the whole connection stalls for one RTT.
          c.stallUntil = Math.max(c.stallUntil, now + rtt);
          holStallTime += rtt;
          for (const oi of c.active) {
            const os = streams[oi];
            if (!os.done && os.downloadStart != null && now >= os.downloadStart) {
              os.stalls.push({ start: now, end: now + rtt, reason: 'tcp-hol' });
            }
          }
        } else {
          // QUIC independent streams: only THIS stream waits for retransmit.
          s.stallUntil = Math.max(s.stallUntil, now + rtt);
          s.stalls.push({ start: now, end: now + rtt, reason: 'quic-retransmit' });
        }
      }
    }

    // --- Gather active downloaders (past wait, not stalled, not finished).
    const active = [];
    for (const s of streams) {
      if (s.done || s.downloadStart == null || now < s.downloadStart) continue;
      const c = conns.get(s.connId);
      if (now < s.stallUntil || now < c.stallUntil) continue;
      active.push(s);
    }

    // --- Share the client link by priority weight and advance downloads.
    if (active.length) {
      let totalW = 0;
      for (const s of active) totalW += s.weight;
      for (const s of active) {
        const share = bw * (s.weight / totalW); // KB/ms for this stream
        const before = s.remaining;
        s.remaining -= share * dt;
        if (s.remaining <= 0) {
          s.downloadEnd = now + before / share; // exact finish within the step
          s.remaining = 0;
          s.done = true;
          const c = conns.get(s.connId);
          c.active.delete(s.index);
          if (c.freeSlots !== Infinity) c.freeSlots += 1;
        }
      }
    }

    now += dt;
    steps += 1;
  }

  // Any stream that somehow never finished (guarded by MAX_STEPS) ends "now".
  for (const s of streams) {
    if (s.downloadEnd == null) s.downloadEnd = now;
  }

  const lcp = pickLcp(streams);
  if (lcp) lcp.isLcp = true;

  const openConns = [...conns.values()].filter((c) => c.opened);
  const totalTime = Math.max(0, ...streams.map((s) => s.downloadEnd));
  const firstConnectionReady = openConns.length
    ? Math.min(...openConns.map((c) => c.connectEnd))
    : 0;
  const firstByte = Math.min(...streams.map((s) => s.downloadStart ?? Infinity));

  const outStreams = streams.map((s) => ({
    index: s.index,
    name: s.name,
    type: s.type,
    priority: s.priority,
    origin: s.origin,
    size: s.size,
    connId: s.connId,
    connectStart: s.connectStart,
    connectEnd: s.connectEnd,
    waitStart: s.waitStart,
    waitEnd: s.waitEnd,
    downloadStart: s.downloadStart,
    downloadEnd: s.downloadEnd,
    stalls: s.stalls.slice(),
    isLcp: s.isLcp,
  }));
  // Present streams in finish order for readable waterfalls / narratives.
  outStreams.sort((a, b) => a.downloadEnd - b.downloadEnd);

  return {
    protocol: proto.key,
    label: proto.label,
    streams: outStreams,
    connections: openConns.map((c) => ({
      id: c.id,
      origin: c.origin,
      connectStart: c.connectStart,
      connectEnd: c.connectEnd,
    })),
    origins,
    settings,
    dt,
    lossCount: lossEvents.length,
    metrics: {
      totalTime,
      connectionsUsed: openConns.length,
      holStallTime,
      lcpFinish: lcp ? lcp.downloadEnd : totalTime,
      firstConnectionReady,
      firstByte: Number.isFinite(firstByte) ? firstByte : 0,
      allDone: totalTime,
    },
  };
}

/** Run all three protocols on the same workload and settings. */
export function simulateAll(workload, settingsIn = {}) {
  return {
    h1: simulate('h1', workload, settingsIn),
    h2: simulate('h2', workload, settingsIn),
    h3: simulate('h3', workload, settingsIn),
  };
}
