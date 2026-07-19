// ui.js
// DOM wiring: builds the editable asset table, reads the controls, runs the
// engine for all three protocols, renders the waterfalls and metrics, drives the
// animation, and writes the auto-generated narrative. No third-party code.

import { simulateAll, DEFAULT_SETTINGS } from './engine.js';
import { PROTOCOLS, PROTOCOL_ORDER, PRIORITY_LABEL, ARTICLES } from './protocols.js';
import { PRESETS, PRESET_ORDER, DEFAULT_PRESET, clonePresetAssets } from './presets.js';
import { Waterfall, legendItems } from './waterfall.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const reduceMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const RESOURCE_TYPES = ['html', 'css', 'js', 'font', 'img', 'xhr'];
const PRIORITIES = ['high', 'med', 'low'];

const state = {
  assets: clonePresetAssets(DEFAULT_PRESET),
  results: null,
  waterfalls: {},
  playing: false,
  cursor: 0, // ms
  speed: 1,
  maxTime: 1,
  rafId: null,
  lastTs: 0,
};

// ---------------------------------------------------------------------------
// Settings <-> controls
// ---------------------------------------------------------------------------
function readSettings() {
  return {
    rttMs: numVal('#rtt'),
    bandwidthMbps: numVal('#bandwidth'),
    lossPct: numVal('#loss'),
    serverTtfbMs: numVal('#ttfb'),
    seed: Math.round(numVal('#seed')),
    shardCount: Math.round(numVal('#shardCount')),
    h2Priority: $('#h2Priority').checked,
    sharding: $('#sharding').checked,
    zeroRtt: $('#zeroRtt').checked,
  };
}

function numVal(sel) {
  const el = $(sel);
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
}

function syncSliderOutputs() {
  $('#rttOut').textContent = `${numVal('#rtt')} ms`;
  $('#bandwidthOut').textContent = `${numVal('#bandwidth')} Mbps`;
  $('#lossOut').textContent = `${numVal('#loss')} %`;
  $('#ttfbOut').textContent = `${numVal('#ttfb')} ms`;
  $('#shardCountOut').textContent = `${Math.round(numVal('#shardCount'))}x`;
  $('#shardRow').style.opacity = $('#sharding').checked ? '1' : '0.45';
}

// ---------------------------------------------------------------------------
// Asset table
// ---------------------------------------------------------------------------
function buildAssetTable() {
  const tbody = $('#assetBody');
  tbody.textContent = '';
  state.assets.forEach((asset, i) => {
    const tr = document.createElement('tr');

    tr.appendChild(inputCell(asset.name, 'text', (v) => (state.assets[i].name = v), 'Asset name'));
    tr.appendChild(selectCell(RESOURCE_TYPES, asset.type, (v) => (state.assets[i].type = v), 'Type'));
    tr.appendChild(
      inputCell(
        String(asset.size),
        'number',
        (v) => (state.assets[i].size = Math.max(0.1, parseFloat(v) || 0)),
        'Size in KB',
        { min: '1', step: '1' },
      ),
    );
    tr.appendChild(
      selectCell(
        PRIORITIES,
        asset.priority,
        (v) => (state.assets[i].priority = v),
        'Priority',
        (p) => PRIORITY_LABEL[p],
      ),
    );
    tr.appendChild(inputCell(asset.origin, 'text', (v) => (state.assets[i].origin = v), 'Origin'));

    const rm = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.textContent = '✕';
    btn.setAttribute('aria-label', `Remove ${asset.name}`);
    btn.addEventListener('click', () => {
      if (state.assets.length <= 1) return;
      state.assets.splice(i, 1);
      buildAssetTable();
      run();
    });
    rm.appendChild(btn);
    tr.appendChild(rm);

    tbody.appendChild(tr);
  });
}

function inputCell(value, type, onChange, label, attrs = {}) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.setAttribute('aria-label', label);
  for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
  input.addEventListener('change', () => {
    onChange(input.value);
    run();
  });
  td.appendChild(input);
  return td;
}

function selectCell(options, value, onChange, label, labeller = (x) => x) {
  const td = document.createElement('td');
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', label);
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = labeller(opt);
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    onChange(sel.value);
    run();
  });
  td.appendChild(sel);
  return td;
}

// ---------------------------------------------------------------------------
// Protocol panels (built once)
// ---------------------------------------------------------------------------
function buildPanels() {
  const wrap = $('#panels');
  wrap.textContent = '';
  for (const key of PROTOCOL_ORDER) {
    const proto = PROTOCOLS[key];
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.proto = key;
    panel.setAttribute('aria-label', `${proto.label} timeline`);

    const head = document.createElement('header');
    head.className = 'panel-head';
    head.innerHTML = `
      <div>
        <h3 style="--accent:${proto.color}">${proto.label}</h3>
        <p class="transport">${proto.transport}</p>
      </div>`;
    panel.appendChild(head);

    const metrics = document.createElement('div');
    metrics.className = 'metrics';
    metrics.id = `metrics-${key}`;
    panel.appendChild(metrics);

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.id = `canvas-${key}`;
    canvas.setAttribute('role', 'img');
    canvasWrap.appendChild(canvas);
    panel.appendChild(canvasWrap);

    const blurb = document.createElement('p');
    blurb.className = 'blurb';
    blurb.textContent = proto.blurb;
    panel.appendChild(blurb);

    const more = document.createElement('p');
    more.className = 'learn-more';
    const a = document.createElement('a');
    a.href = proto.article.href;
    a.textContent = `Learn more: ${proto.article.text}`;
    a.target = '_blank';
    a.rel = 'noopener';
    more.appendChild(a);
    panel.appendChild(more);

    wrap.appendChild(panel);
    state.waterfalls[key] = new Waterfall(canvas);
  }
}

// ---------------------------------------------------------------------------
// Simulate + render
// ---------------------------------------------------------------------------
function run() {
  const settings = readSettings();
  syncSliderOutputs();
  state.results = simulateAll(state.assets, settings);
  state.maxTime = Math.max(
    1,
    ...PROTOCOL_ORDER.map((k) => state.results[k].metrics.totalTime),
  );

  for (const key of PROTOCOL_ORDER) {
    const wf = state.waterfalls[key];
    wf.setResult(state.results[key], state.maxTime);
    const res = state.results[key];
    wf.canvas.setAttribute(
      'aria-label',
      `${res.label} loads ${res.streams.length} assets in ${Math.round(
        res.metrics.totalTime,
      )} milliseconds using ${res.metrics.connectionsUsed} connection(s).`,
    );
  }

  renderMetrics();
  renderNarrative();
  resetCursor();
  if (reduceMotion) {
    drawAll(Infinity);
  } else {
    drawAll(state.cursor);
  }
}

function renderMetrics() {
  const r = state.results;
  const best = {
    totalTime: Math.min(...PROTOCOL_ORDER.map((k) => r[k].metrics.totalTime)),
    lcpFinish: Math.min(...PROTOCOL_ORDER.map((k) => r[k].metrics.lcpFinish)),
    holStallTime: Math.min(...PROTOCOL_ORDER.map((k) => r[k].metrics.holStallTime)),
  };
  for (const key of PROTOCOL_ORDER) {
    const m = r[key].metrics;
    const rows = [
      metricRow('Total load time', ms(m.totalTime), m.totalTime === best.totalTime),
      metricRow('LCP asset finishes', ms(m.lcpFinish), m.lcpFinish === best.lcpFinish),
      metricRow('Connections used', String(m.connectionsUsed), false),
      metricRow(
        'HOL stall time',
        ms(m.holStallTime),
        m.holStallTime === best.holStallTime,
        m.holStallTime === 0 ? 'none' : null,
      ),
    ];
    $(`#metrics-${key}`).innerHTML = rows.join('');
  }
}

function metricRow(label, value, isBest, note) {
  const badge = isBest ? '<span class="win" title="Best of the three">best</span>' : '';
  const noteHtml = note ? `<span class="note">${note}</span>` : '';
  return `<div class="metric${isBest ? ' is-best' : ''}">
      <span class="m-label">${label}</span>
      <span class="m-value">${value}${noteHtml}${badge}</span>
    </div>`;
}

function ms(v) {
  return `${Math.round(v)} ms`;
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------
function renderNarrative() {
  const { h1, h2, h3 } = state.results;
  const settings = readSettings();
  const parts = [];

  const winner = [h1, h2, h3].reduce((a, b) =>
    b.metrics.totalTime < a.metrics.totalTime ? b : a,
  );
  parts.push(
    `With these settings, <strong>${winner.label}</strong> finishes the workload first (${ms(
      winner.metrics.totalTime,
    )}).`,
  );

  const nAssets = state.assets.length;
  if (h1.metrics.connectionsUsed > h2.metrics.connectionsUsed) {
    parts.push(
      `HTTP/1.1 opened <strong>${h1.metrics.connectionsUsed} connections</strong> to move ${nAssets} assets` +
        (settings.sharding ? ' (boosted by domain sharding)' : '') +
        `, while HTTP/2 and HTTP/3 multiplexed everything over ${h2.metrics.connectionsUsed} connection` +
        (h2.metrics.connectionsUsed === 1 ? '' : 's') +
        '.',
    );
  }

  if (settings.lossPct > 0) {
    const saved = Math.round(h2.metrics.totalTime - h3.metrics.totalTime);
    parts.push(
      `At ${settings.lossPct}% packet loss, HTTP/2 lost <strong>${ms(
        h2.metrics.holStallTime,
      )}</strong> to TCP head-of-line blocking - one dropped packet freezes every multiplexed stream. ` +
        `HTTP/3 rides QUIC, so a loss only stalls its own stream` +
        (saved > 0 ? `, finishing about <strong>${saved} ms</strong> sooner.` : '.'),
    );
  } else {
    parts.push(
      'Packet loss is at 0%, so there is no head-of-line blocking to see yet - raise the loss slider to watch HTTP/2 stall while HTTP/3 keeps flowing.',
    );
  }

  if (settings.h2Priority) {
    parts.push(
      'Stream prioritization is on: high-priority assets get a larger share of the link on HTTP/2 and HTTP/3 and finish ahead of low-priority ones. On HTTP/1.1 priority is ignored - requests are served first-come, first-served per connection.',
    );
  } else {
    parts.push('Stream prioritization is off: every stream shares the link equally on HTTP/2 and HTTP/3.');
  }

  if (settings.zeroRtt) {
    parts.push('HTTP/3 is using 0-RTT resumption, so it skips the QUIC handshake round trip and starts fetching immediately.');
  }

  $('#narrative').innerHTML = parts.map((p) => `<p>${p}</p>`).join('');
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------
function drawAll(cursor) {
  for (const key of PROTOCOL_ORDER) state.waterfalls[key].draw(cursor);
  const pct = state.maxTime ? Math.min(1, cursor / state.maxTime) : 0;
  $('#scrubber').value = String(Math.round(pct * 1000));
  $('#clock').textContent =
    cursor === Infinity ? `${Math.round(state.maxTime)} ms` : `${Math.round(cursor)} ms`;
}

function resetCursor() {
  state.cursor = 0;
  stop();
  if (!reduceMotion) drawAll(0);
}

function play() {
  if (reduceMotion || state.playing) return;
  if (state.cursor >= state.maxTime) state.cursor = 0;
  state.playing = true;
  $('#playPause').textContent = 'Pause';
  $('#playPause').setAttribute('aria-pressed', 'true');
  state.lastTs = 0;
  state.rafId = requestAnimationFrame(tick);
}

function stop() {
  state.playing = false;
  $('#playPause').textContent = 'Play';
  $('#playPause').setAttribute('aria-pressed', 'false');
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
}

function tick(ts) {
  if (!state.playing) return;
  if (!state.lastTs) state.lastTs = ts;
  const dtReal = ts - state.lastTs;
  state.lastTs = ts;
  // Map the whole timeline to ~6 seconds at 1x speed.
  const simPerReal = (state.maxTime / 6000) * state.speed;
  state.cursor += dtReal * simPerReal;
  if (state.cursor >= state.maxTime) {
    state.cursor = state.maxTime;
    drawAll(state.cursor);
    stop();
    return;
  }
  drawAll(state.cursor);
  state.rafId = requestAnimationFrame(tick);
}

function step() {
  stop();
  state.cursor = Math.min(state.maxTime, state.cursor + state.maxTime / 24);
  drawAll(state.cursor);
}

// ---------------------------------------------------------------------------
// Legend + static setup
// ---------------------------------------------------------------------------
function buildLegend() {
  const { types, phases } = legendItems();
  const el = $('#legend');
  const swatch = (item) =>
    `<span class="lg"><span class="sw" style="background:${item.color}"></span>${item.label}</span>`;
  el.innerHTML =
    '<span class="lg-group">Types:</span>' +
    types.map(swatch).join('') +
    '<span class="lg-group">Phases:</span>' +
    phases.map(swatch).join('');
}

function buildPresetOptions() {
  const sel = $('#preset');
  for (const id of PRESET_ORDER) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = PRESETS[id].label;
    sel.appendChild(o);
  }
  sel.value = DEFAULT_PRESET;
  $('#presetDesc').textContent = PRESETS[DEFAULT_PRESET].description;
}

function applyPreset(id) {
  const preset = PRESETS[id];
  if (!preset) return;
  state.assets = clonePresetAssets(id);
  if (preset.settings) {
    if (preset.settings.rttMs != null) setControl('#rtt', preset.settings.rttMs);
    if (preset.settings.bandwidthMbps != null) setControl('#bandwidth', preset.settings.bandwidthMbps);
    if (preset.settings.lossPct != null) setControl('#loss', preset.settings.lossPct);
  }
  $('#presetDesc').textContent = preset.description;
  buildAssetTable();
  run();
}

function setControl(sel, value) {
  $(sel).value = String(value);
}

// ---------------------------------------------------------------------------
// Further reading links (populated from ARTICLES so there are never bare URLs)
// ---------------------------------------------------------------------------
function buildFurtherReading() {
  const el = $('#furtherReading');
  if (!el) return;
  const order = ['overview', 'prioritization', 'hol', 'http3hol', 'sharding'];
  el.innerHTML = order
    .map((k) => {
      const a = ARTICLES[k];
      return `<li><a href="${a.href}" target="_blank" rel="noopener">${a.text}</a></li>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------
function initTheme() {
  const btn = $('#themeToggle');
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    btn.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  };
  const prefersDark =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  apply(prefersDark ? 'dark' : 'light');
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    // Re-read theme colours into the canvases.
    if (state.results) drawAll(reduceMotion ? Infinity : state.cursor);
  });
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
function init() {
  buildPresetOptions();
  buildPanels();
  buildLegend();
  buildFurtherReading();
  buildAssetTable();
  initTheme();

  // Control listeners.
  for (const id of ['#rtt', '#bandwidth', '#loss', '#ttfb', '#seed', '#shardCount']) {
    $(id).addEventListener('input', () => {
      syncSliderOutputs();
      run();
    });
  }
  for (const id of ['#h2Priority', '#sharding', '#zeroRtt']) {
    $(id).addEventListener('change', run);
  }
  $('#preset').addEventListener('change', (e) => applyPreset(e.target.value));
  $('#addRow').addEventListener('click', () => {
    state.assets.push({ name: 'new-asset.js', type: 'js', size: 60, priority: 'med', origin: 'www' });
    buildAssetTable();
    run();
  });

  // Playback.
  $('#playPause').addEventListener('click', () => (state.playing ? stop() : play()));
  $('#stepBtn').addEventListener('click', step);
  $('#resetBtn').addEventListener('click', resetCursor);
  $('#speed').addEventListener('input', () => {
    state.speed = parseFloat($('#speed').value);
    $('#speedOut').textContent = `${state.speed}x`;
  });
  $('#scrubber').addEventListener('input', () => {
    stop();
    state.cursor = (parseFloat($('#scrubber').value) / 1000) * state.maxTime;
    drawAll(state.cursor);
  });

  // Reduced motion: hide playback, show the static full chart.
  if (reduceMotion) {
    $('#playback').setAttribute('hidden', '');
    $('#reducedNote').removeAttribute('hidden');
  }

  window.addEventListener('resize', () => {
    for (const key of PROTOCOL_ORDER) state.waterfalls[key].resize();
    drawAll(reduceMotion ? Infinity : state.cursor);
  });

  syncSliderOutputs();
  run();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
