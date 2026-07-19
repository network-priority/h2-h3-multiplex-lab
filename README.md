# HTTP/2 &amp; HTTP/3 Multiplex Lab

An interactive, zero-dependency lab that loads the **same set of page assets** three
ways — over **HTTP/1.1**, **HTTP/2** and **HTTP/3 (QUIC)** — and shows, side by side,
why the newer protocols usually win. It makes visible the things that are otherwise
invisible: connection setup cost, the HTTP/1.1 six-connections-per-origin limit,
multiplexing over a single connection, transport-level head-of-line blocking under
packet loss, and stream prioritization.

## What it is

Three animated waterfall timelines for one workload, plus a metrics panel per protocol
(total load time, connections used, head-of-line stall time, and when the LCP asset
finishes) with the winner highlighted, and an auto-generated plain-language summary of
what just happened for your current settings. It is a **teaching model**, deliberately
simplified — see [How the simulation model works](#how-the-simulation-model-works).

Everything runs client-side in vanilla HTML/CSS/JS. There is **no build step, no
framework, and no runtime dependency**, and the page makes **no external network
requests**.

## Try it

- **Locally:** clone or download this repository and open `index.html` directly in a
  modern browser. Because it uses ES modules, some browsers restrict `file://` module
  loading, so serving statically is more reliable:
  - `npm start` (runs `python3 -m http.server 8080`, then visit
    [localhost:8080](http://localhost:8080)), or
  - `npx --yes serve` if you prefer Node, or any other static file server.
- **Hosted:** the project is a static site and can be published as-is to
  [GitHub Pages](https://pages.github.com/) — the included workflow does exactly that.
  A `.nojekyll` file is present so Pages serves the files unprocessed.

## Screenshots — what you see

- A **controls** card: choose a preset workload, then tune network RTT, bandwidth,
  packet loss, server TTFB, the loss seed, and toggles for HTTP/2 &amp; HTTP/3 stream
  priority, HTTP/1.1 domain sharding, and HTTP/3 0-RTT resumption.
- An editable **assets** table — add, remove, and edit rows (name, type, size, priority,
  origin).
- **Playback** controls: play, pause, step, reset, a speed slider, and a scrubber, with
  a live millisecond clock.
- Three **waterfall panels** (one per protocol). Each bar shows the connection handshake,
  the wait for the first byte, and the download, coloured by resource type. Stall
  segments (head-of-line blocking / retransmits) are marked in red, and the LCP asset is
  flagged. A moving cursor sweeps across all three on the same time scale so the
  comparison is fair.
- A **metrics** panel per protocol with the best value badged, a **What happened**
  narrative, and a **How the model works** explainer.

## The controls

| Control | What it does |
| --- | --- |
| Preset workload | Loads one of three sample asset sets (Typical blog, Heavy SPA, Media gallery) and sensible network defaults. |
| Network RTT | Round-trip time in milliseconds. Drives handshake and stall costs. |
| Bandwidth | Shared client link capacity in Mbps. The bottleneck all streams share. |
| Packet loss | Loss percentage. Above 0% this triggers the head-of-line-blocking demonstration. |
| Server TTFB | Server "think time" before the first byte. |
| Loss seed | Seeds the deterministic loss pattern so results are reproducible and all three protocols see the same losses. |
| H1 domain shards | Multiplies HTTP/1.1's connection budget to show domain sharding. |
| Stream priority | Turns priority weighting on for HTTP/2 &amp; HTTP/3 (ignored by HTTP/1.1). |
| 0-RTT resumption | Lets HTTP/3 skip the QUIC handshake round trip. |
| Assets table | Edit the workload: name, type, size (KB), priority, origin. |
| Playback | Play / pause / step / reset, speed, and a timeline scrubber. |

## How the simulation model works

This is a **teaching model**, not a packet-accurate emulator. It reproduces the
*qualitative* behaviour that distinguishes the protocols so you can build intuition, and
it is fully deterministic.

- **Connection setup.** HTTP/1.1 and HTTP/2 run over TCP + TLS and pay about two round
  trips before the first request. HTTP/3 runs over QUIC and needs one round trip, or zero
  with 0-RTT resumption. HTTP/1.1 opens up to six connections per origin (more with
  domain sharding); HTTP/2 and HTTP/3 multiplex everything over a single connection per
  origin.
- **Bandwidth sharing.** The client link is the bottleneck. Every stream downloading at a
  given instant splits the available bandwidth; a stream finishes once its bytes have been
  transferred. With prioritization on, higher-priority streams take a larger share.
- **Head-of-line blocking.** Packet loss is converted into discrete loss events placed
  deterministically from the seed, so every protocol sees the **same** pattern. On
  HTTP/1.1 a stalled response blocks that connection's queue. On HTTP/2 a loss stalls the
  whole TCP connection for one RTT — every multiplexed stream freezes, because TCP
  delivers bytes in order. On HTTP/3 a loss stalls only its own QUIC stream; the others
  keep flowing. That contrast is the heart of the lab.
- **Priority.** With prioritization on, high-priority assets finish first on HTTP/2 and
  HTTP/3. HTTP/1.1 ignores priority — it is first-come, first-served per connection.
- **Determinism.** A seeded pseudo-random generator (mulberry32) fixes the loss pattern,
  so the three protocols are always compared under identical conditions and every run is
  reproducible.

Real networks add congestion control, TLS false start, HPACK/QPACK header compression,
server push, connection coalescing and much more. Use this lab to understand the *shape*
of the differences, not to predict exact load times.

## The three protocols compared

- **HTTP/1.1** — up to six parallel TCP connections per origin, one request at a time per
  connection. A slow or lost response blocks everything queued behind it (head-of-line
  blocking), and priority hints barely matter. Domain sharding buys more connections at
  the cost of more handshakes — see
  [Connection coalescing vs domain sharding](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/connection-coalescing-domain-sharding/).
- **HTTP/2** — multiplexes every request as an independent stream over a single TCP
  connection and can weight streams by
  [priority](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/http2-stream-prioritization-weighting/).
  But because TCP guarantees in-order delivery, a single lost packet stalls **all** streams
  until it is retransmitted — transport-level head-of-line blocking. See
  [Mitigating head-of-line blocking](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/mitigating-head-of-line-blocking/).
- **HTTP/3 (QUIC)** — sets up in a single round trip (or zero on resumption) and gives
  every stream independent delivery, so a lost packet only stalls its own stream. That
  removes transport-level head-of-line blocking — explored in
  [Does HTTP/3 eliminate head-of-line blocking?](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/mitigating-head-of-line-blocking/does-http3-eliminate-head-of-line-blocking/).

For the big picture, start with the
[HTTP/2 &amp; HTTP/3 multiplexing overview](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/).

## Accessibility

- Every control has a label or `aria-label`, and toggle buttons expose `aria-pressed`
  state.
- The waterfall canvases carry an `aria-label` summarising each protocol's result in
  words for screen readers.
- Colour is never the only signal — metrics, the narrative, and text labels convey the
  same information as the bars.
- Full keyboard operation: all controls are native form elements and buttons.
- `prefers-reduced-motion` is respected: when set, the animation is disabled and the
  timelines are shown fully loaded as a static comparison.
- A light theme and a dark-mode toggle are both provided, and the initial theme follows
  the system `prefers-color-scheme`.

## Development / tests

The simulation engine (`js/engine.js`) is pure and DOM-free, and importable in both Node
and the browser as an ES module. Its invariants are covered by
[`node:test`](https://nodejs.org/api/test.html):

```bash
node --test          # run the engine tests
node --check js/*.js  # syntax-check the sources
```

The tests assert the properties that make the lab honest: HTTP/3's total time never
exceeds HTTP/2's under packet loss, HTTP/1.1 opens more connections than the multiplexed
protocols, stream priority reorders finish order, and identical inputs (including the
seed) produce identical output. There are **no dependencies to install**.

Continuous integration runs the tests on Node 18, 20 and 22 and can deploy the static
site to GitHub Pages — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Contributing

Issues and pull requests are welcome. Please keep the engine pure and DOM-free, add or
update a `node:test` case for any behaviour change, and run `node --test` and
`node --check` before opening a pull request. Keep the project dependency-free and free of
external network requests.

## Further reading

Deeper explanations of everything this lab demonstrates, from
[network-priority.com](https://www.network-priority.com):

- [HTTP/2 &amp; HTTP/3 multiplexing (overview)](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/)
- [HTTP/2 stream prioritization &amp; weighting](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/http2-stream-prioritization-weighting/)
- [Mitigating head-of-line blocking](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/mitigating-head-of-line-blocking/)
- [Does HTTP/3 eliminate head-of-line blocking?](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/mitigating-head-of-line-blocking/does-http3-eliminate-head-of-line-blocking/)
- [Connection coalescing vs domain sharding](https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/connection-coalescing-domain-sharding/)

## License

[MIT](LICENSE) © 2026 Network Priority.

---

An educational lab by [network-priority.com](https://www.network-priority.com).
