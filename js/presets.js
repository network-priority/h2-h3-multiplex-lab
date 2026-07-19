// presets.js
// Sample workloads. Each asset: { name, type, size (KB), priority, origin }.
// DOM-free so the engine tests can import these directly.

export const PRESETS = Object.freeze({
  blog: {
    id: 'blog',
    label: 'Typical blog',
    description: 'A content page: HTML, one stylesheet, a couple of scripts, a web font, a hero image and some analytics.',
    settings: { rttMs: 60, bandwidthMbps: 20, lossPct: 1 },
    assets: [
      { name: 'index.html', type: 'html', size: 28, priority: 'high', origin: 'www' },
      { name: 'main.css', type: 'css', size: 46, priority: 'high', origin: 'www' },
      { name: 'app.js', type: 'js', size: 120, priority: 'med', origin: 'www' },
      { name: 'brand.woff2', type: 'font', size: 34, priority: 'high', origin: 'www' },
      { name: 'hero.jpg', type: 'img', size: 240, priority: 'high', origin: 'cdn' },
      { name: 'thumb-1.jpg', type: 'img', size: 60, priority: 'low', origin: 'cdn' },
      { name: 'thumb-2.jpg', type: 'img', size: 58, priority: 'low', origin: 'cdn' },
      { name: 'analytics.js', type: 'xhr', size: 22, priority: 'low', origin: 'cdn' },
    ],
  },

  spa: {
    id: 'spa',
    label: 'Heavy SPA',
    description: 'A single-page app: a big JS bundle split into chunks, CSS, fonts and several API calls before first paint.',
    settings: { rttMs: 80, bandwidthMbps: 15, lossPct: 1.5 },
    assets: [
      { name: 'index.html', type: 'html', size: 14, priority: 'high', origin: 'app' },
      { name: 'runtime.js', type: 'js', size: 38, priority: 'high', origin: 'app' },
      { name: 'vendor.js', type: 'js', size: 520, priority: 'high', origin: 'app' },
      { name: 'main.js', type: 'js', size: 300, priority: 'high', origin: 'app' },
      { name: 'route-dashboard.js', type: 'js', size: 180, priority: 'med', origin: 'app' },
      { name: 'app.css', type: 'css', size: 90, priority: 'high', origin: 'app' },
      { name: 'inter.woff2', type: 'font', size: 42, priority: 'med', origin: 'app' },
      { name: 'GET /api/session', type: 'xhr', size: 6, priority: 'high', origin: 'api' },
      { name: 'GET /api/feed', type: 'xhr', size: 48, priority: 'med', origin: 'api' },
      { name: 'GET /api/config', type: 'xhr', size: 12, priority: 'med', origin: 'api' },
      { name: 'avatar.png', type: 'img', size: 36, priority: 'low', origin: 'cdn' },
    ],
  },

  gallery: {
    id: 'gallery',
    label: 'Media gallery',
    description: 'An image-heavy grid: a light shell plus many similarly sized photos - great for seeing connection limits and multiplexing.',
    settings: { rttMs: 70, bandwidthMbps: 25, lossPct: 2 },
    assets: [
      { name: 'index.html', type: 'html', size: 18, priority: 'high', origin: 'www' },
      { name: 'gallery.css', type: 'css', size: 40, priority: 'high', origin: 'www' },
      { name: 'gallery.js', type: 'js', size: 96, priority: 'med', origin: 'www' },
      { name: 'photo-01.jpg', type: 'img', size: 320, priority: 'high', origin: 'cdn' },
      { name: 'photo-02.jpg', type: 'img', size: 280, priority: 'med', origin: 'cdn' },
      { name: 'photo-03.jpg', type: 'img', size: 300, priority: 'med', origin: 'cdn' },
      { name: 'photo-04.jpg', type: 'img', size: 260, priority: 'low', origin: 'cdn' },
      { name: 'photo-05.jpg', type: 'img', size: 290, priority: 'low', origin: 'cdn' },
      { name: 'photo-06.jpg', type: 'img', size: 270, priority: 'low', origin: 'cdn' },
      { name: 'photo-07.jpg', type: 'img', size: 250, priority: 'low', origin: 'cdn' },
      { name: 'photo-08.jpg', type: 'img', size: 310, priority: 'low', origin: 'cdn' },
      { name: 'photo-09.jpg', type: 'img', size: 240, priority: 'low', origin: 'cdn' },
    ],
  },
});

export const PRESET_ORDER = Object.freeze(['blog', 'spa', 'gallery']);
export const DEFAULT_PRESET = 'blog';

/** Return a deep copy of a preset's assets so callers can edit freely. */
export function clonePresetAssets(id) {
  const preset = PRESETS[id] || PRESETS[DEFAULT_PRESET];
  return preset.assets.map((a) => ({ ...a }));
}
