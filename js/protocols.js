// protocols.js
// Static, DOM-free descriptions of the three protocols and shared visual metadata.
// Imported by the pure engine (Node + browser) and by the UI/renderer.

/**
 * Relative bandwidth weight per resource priority.
 * Higher weight => larger share of the shared link when prioritization is on.
 */
export const PRIORITY_WEIGHT = Object.freeze({ high: 3, med: 2, low: 1 });

export const PRIORITY_LABEL = Object.freeze({
  high: 'High',
  med: 'Medium',
  low: 'Low',
});

/**
 * Article links back to network-priority.com. Each is a { href, text } pair so
 * the UI can always render a proper anchor with visible text (never a bare URL).
 */
export const ARTICLES = Object.freeze({
  overview: {
    href: 'https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/',
    text: 'HTTP/2 & HTTP/3 multiplexing (overview)',
  },
  prioritization: {
    href: 'https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/http2-stream-prioritization-weighting/',
    text: 'HTTP/2 stream prioritization & weighting',
  },
  hol: {
    href: 'https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/mitigating-head-of-line-blocking/',
    text: 'Mitigating head-of-line blocking',
  },
  http3hol: {
    href: 'https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/mitigating-head-of-line-blocking/does-http3-eliminate-head-of-line-blocking/',
    text: 'Does HTTP/3 eliminate head-of-line blocking?',
  },
  sharding: {
    href: 'https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/connection-coalescing-domain-sharding/',
    text: 'Connection coalescing vs domain sharding',
  },
});

/**
 * Protocol behaviour switches consumed by the engine.
 *
 * handshakeRTT   number of round trips before the connection can carry a request
 * maxConnPerOrigin  parallel connections the client will open to one origin
 * multiplex      many concurrent streams share a single connection
 * tcpHol         a lost packet stalls the *whole* connection (in-order TCP delivery)
 * priority       server honours per-stream priority (bandwidth weighting)
 */
export const PROTOCOLS = Object.freeze({
  h1: {
    key: 'h1',
    label: 'HTTP/1.1',
    short: 'H1',
    transport: 'TCP + TLS',
    handshakeRTT: 2,
    maxConnPerOrigin: 6,
    multiplex: false,
    tcpHol: true,
    priority: false,
    color: '#b87333',
    blurb:
      'Opens up to 6 parallel TCP connections per origin. Each connection carries one request at a time, so a slow or lost response blocks everything queued behind it (head-of-line blocking). Priority hints barely matter - it is effectively first-come, first-served per connection.',
    article: ARTICLES.sharding,
  },
  h2: {
    key: 'h2',
    label: 'HTTP/2',
    short: 'H2',
    transport: 'TCP + TLS',
    handshakeRTT: 2,
    maxConnPerOrigin: 1,
    multiplex: true,
    tcpHol: true,
    priority: true,
    color: '#6b8e23',
    blurb:
      'Multiplexes every request as an independent stream over a single TCP connection and can weight streams by priority. But because TCP guarantees in-order delivery, a single lost packet stalls ALL streams until it is retransmitted - transport-level head-of-line blocking.',
    article: ARTICLES.prioritization,
  },
  h3: {
    key: 'h3',
    label: 'HTTP/3 (QUIC)',
    short: 'H3',
    transport: 'QUIC / UDP',
    handshakeRTT: 1,
    maxConnPerOrigin: 1,
    multiplex: true,
    tcpHol: false,
    priority: true,
    color: '#c9a227',
    blurb:
      'Runs over QUIC, which sets up in a single round trip (or zero on resumption) and gives every stream its own independent delivery. A lost packet only stalls the one stream it belongs to; the others keep flowing. That removes transport-level head-of-line blocking.',
    article: ARTICLES.http3hol,
  },
});

export const PROTOCOL_ORDER = Object.freeze(['h1', 'h2', 'h3']);

/** Fill colour per resource type for the waterfall bars. */
export const TYPE_COLORS = Object.freeze({
  html: '#c9a227', // gold
  css: '#6b8e23', // moss
  js: '#b87333', // copper
  font: '#8a7f5c', // taupe
  img: '#5f7d3a', // olive-green
  xhr: '#4a8078', // teal
});

export const RESOURCE_TYPES = Object.freeze(['html', 'css', 'js', 'font', 'img', 'xhr']);
export const PRIORITIES = Object.freeze(['high', 'med', 'low']);
