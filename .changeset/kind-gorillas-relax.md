---
"@consulta-dev/qr-engine": minor
---

Add a pinned, reproducible QR-only ZXing-C++ candidate recipe, a browser adapter with baseline fallback, CI artifact verification, a public synthetic parity check against `zxing-wasm`, and a Chromium performance/memory gate. QR extraction in the hosted embed now runs in an origin-owned Worker with transferred and cleared RGBA buffers. The candidate remains opt-in until promotion gates pass.
