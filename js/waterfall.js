// waterfall.js
// Canvas renderer for one protocol's timeline. Draws per-stream bars with
// connect / wait / download / stall phases, milestone markers and a moving time
// cursor. Honours prefers-reduced-motion by drawing the fully-revealed chart.

import { TYPE_COLORS, PROTOCOLS } from './protocols.js';

const PHASE_COLORS = {
  connect: 'rgba(120,120,120,0.45)', // handshake
  wait: 'rgba(160,160,160,0.30)', // TTFB / server think
  stall: '#c1440e', // HOL / retransmit stall (rustic red-copper)
};

// Read a CSS custom property so the canvas matches the active theme.
function cssVar(name, fallback) {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export class Waterfall {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts { rowHeight, gap, padLeft, padRight, padTop }
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rowHeight = opts.rowHeight ?? 22;
    this.gap = opts.gap ?? 6;
    this.padLeft = opts.padLeft ?? 148;
    this.padRight = opts.padRight ?? 16;
    this.padTop = opts.padTop ?? 30;
    this.padBottom = opts.padBottom ?? 26;
    this.result = null;
    this.timeScaleMax = 1; // shared across protocols for fair comparison
  }

  setResult(result, timeScaleMax) {
    this.result = result;
    this.timeScaleMax = Math.max(1, timeScaleMax || result.metrics.totalTime);
    this.resize();
  }

  resize() {
    if (!this.result) return;
    const rows = this.result.streams.length;
    const cssHeight = this.padTop + this.padBottom + rows * (this.rowHeight + this.gap);
    const cssWidth = this.canvas.clientWidth || 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
  }

  x(t) {
    const w = this.cssWidth - this.padLeft - this.padRight;
    return this.padLeft + (t / this.timeScaleMax) * w;
  }

  /** Draw the chart revealed up to `cursorTime` (ms). Pass Infinity for full. */
  draw(cursorTime = Infinity) {
    if (!this.result) return;
    const ctx = this.ctx;
    const ink = cssVar('--ink', '#2b2a20');
    const muted = cssVar('--muted', '#6b6552');
    const gridColor = cssVar('--grid', 'rgba(0,0,0,0.08)');
    const rowAlt = cssVar('--row-alt', 'rgba(0,0,0,0.03)');

    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.textBaseline = 'middle';
    ctx.font = '12px system-ui, sans-serif';

    // Time grid (every ~1/5th of the scale, rounded).
    const gridStep = niceStep(this.timeScaleMax / 5);
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = muted;
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    for (let t = 0; t <= this.timeScaleMax + 1; t += gridStep) {
      const gx = this.x(t);
      ctx.beginPath();
      ctx.moveTo(gx, this.padTop - 8);
      ctx.lineTo(gx, this.cssHeight - this.padBottom);
      ctx.stroke();
      ctx.fillText(`${Math.round(t)}ms`, gx, this.padTop - 16);
    }

    const streams = this.result.streams;
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i];
      const y = this.padTop + i * (this.rowHeight + this.gap);
      const h = this.rowHeight;

      // Row background stripe.
      if (i % 2 === 1) {
        ctx.fillStyle = rowAlt;
        ctx.fillRect(0, y, this.cssWidth, h);
      }

      // Label (name), truncated.
      ctx.fillStyle = ink;
      ctx.textAlign = 'left';
      ctx.font = s.isLcp ? '600 12px system-ui, sans-serif' : '12px system-ui, sans-serif';
      ctx.fillText(truncate(ctx, s.name, this.padLeft - 12), 8, y + h / 2);

      // Connect (handshake) phase.
      if (s.connectStart != null && s.connectEnd != null) {
        this.bar(s.connectStart, s.connectEnd, y, h, PHASE_COLORS.connect, cursorTime);
      }
      // Wait (TTFB) phase.
      if (s.waitStart != null && s.waitEnd != null) {
        this.bar(s.waitStart, s.waitEnd, y, h, PHASE_COLORS.wait, cursorTime);
      }
      // Download phase, coloured by resource type; brighter when high priority.
      const base = TYPE_COLORS[s.type] || '#888';
      const fill = s.priority === 'high' ? base : base;
      const alpha = s.priority === 'low' ? 0.72 : 1;
      ctx.globalAlpha = alpha;
      this.bar(s.downloadStart, s.downloadEnd, y, h, fill, cursorTime, true);
      ctx.globalAlpha = 1;

      // Stall segments drawn on top.
      for (const st of s.stalls) {
        this.bar(st.start, st.end, y + h - 5, 5, PHASE_COLORS.stall, cursorTime);
      }

      // LCP marker.
      if (s.isLcp && (cursorTime === Infinity || s.downloadEnd <= cursorTime)) {
        ctx.fillStyle = cssVar('--gold', '#c9a227');
        ctx.beginPath();
        const mx = this.x(s.downloadEnd);
        ctx.moveTo(mx, y - 2);
        ctx.lineTo(mx + 5, y - 8);
        ctx.lineTo(mx - 5, y - 8);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Moving time cursor.
    if (cursorTime !== Infinity && cursorTime <= this.timeScaleMax) {
      const cx = this.x(cursorTime);
      ctx.strokeStyle = cssVar('--copper', '#b87333');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, this.padTop - 8);
      ctx.lineTo(cx, this.cssHeight - this.padBottom);
      ctx.stroke();
    }
  }

  bar(t0, t1, y, h, color, cursorTime, rounded = false) {
    if (t0 == null || t1 == null) return;
    let end = t1;
    if (cursorTime !== Infinity) {
      if (t0 >= cursorTime) return; // not started yet
      end = Math.min(t1, cursorTime); // partially revealed
    }
    const x0 = this.x(t0);
    const x1 = this.x(end);
    const w = Math.max(1, x1 - x0);
    const ctx = this.ctx;
    ctx.fillStyle = color;
    if (rounded && ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x0, y, w, h, 3);
      ctx.fill();
    } else {
      ctx.fillRect(x0, y, w, h);
    }
  }
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const n = raw / pow;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * pow;
}

/** Legend data for the UI (resource types + phase swatches). */
export function legendItems() {
  const types = Object.entries(TYPE_COLORS).map(([type, color]) => ({
    label: type.toUpperCase(),
    color,
  }));
  return {
    types,
    phases: [
      { label: 'Handshake', color: PHASE_COLORS.connect },
      { label: 'Wait (TTFB)', color: PHASE_COLORS.wait },
      { label: 'HOL / retransmit stall', color: PHASE_COLORS.stall },
    ],
  };
}

export { PROTOCOLS };
