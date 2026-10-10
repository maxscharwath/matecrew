# Portable TSX device engine

Rust renders all layouts on the device. It consumes compact DUI1 definitions produced by the TSX SDK in `../authoring`. See [the SDK guide](../authoring/README.md) for syntax, apps, limits and examples.

The crate is independent of matécrew, HTTP and ESP-IDF. A host supplies `embedded_graphics::DrawTarget<BinaryColor>`, input, authenticated network transport, storage and hardware effects. Viewport dimensions and integer scale are configurable. `Frame` supports non-byte-aligned monochrome panels. This implementation uses `std` and allocation; `no_std` and color targets are not provided.

## Host lifecycle

1. Decode `Scene::from_bytecode` and construct `Runtime::new`.
2. Restore `runtime.restore(cache)` and supply current platform metadata with `update_device`.
3. Call `advance(now_ms, on_wake)`, execute `Fetch` effects, then `update(id, value)`. `fetch_with` is a synchronous convenience adapter which attempts every resource even if one fails.
4. Process `input("left")` or `press(Point)`. Execute returned `Beep`, `Fetch`, or application `Emit` effects. State setters and navigation execute directly in the runtime. Named input returns `None` when unbound so a host can retain legacy pointer mapping.
5. After resource/input updates, inspect `image_requests()`. Download each original PNG and call `update_image(request, bytes)`. Decode, fit and dither happen inside Rust. Invalid or stale replies cannot replace the cache.
6. Render with `runtime.scene().render(target, runtime.data(), scale)`. Drawing itself performs no I/O.
7. Persist `data()` within the host's storage budget. Restore filters declared resources/state, validates the navigation stack and image cache, and preserves scene defaults. Platform metadata must be supplied fresh by the host.

Navigation has one router, up to 16 routes and a 16-entry push/replace/back/reset stack. Local state is shared across routes. Only active routes participate in input and image discovery. Traversal, node count, downloads, local state, images and literal sizes are bounded. JSON is the data/cache format; screen layouts travel as binary.

The current 20 maté screens occupy roughly 16 KiB. The nine-page Showcase is roughly 8 KiB. `../apps/mate` and `../apps/showcase` share the same engine and public SDK. Built-in application selection belongs to the terminal host.

## Format and compatibility

DUI1 uses numeric node/action opcodes, a shared UTF-8 string table, fixed-width geometry, typed literals (including packed bytes), bindings and resource descriptors. The decoder validates all lengths, enum values, route/action references and limits. Unknown opcodes are rejected. New image/chart/router/input/beep/docked-button features require the matching engine/firmware build; an older DUI1 engine cannot execute newly introduced opcodes.

Optional image support currently decodes non-interlaced PNG rows through the [png decoder](https://docs.rs/png/0.18.1/png/struct.Decoder.html), avoiding a complete RGBA framebuffer. Max source 512 × 512, download 64 KiB, destination 256 × 256, eight cache entries / 16 KiB packed pixels. Transparent pixels composite onto white. The platform adapter owns HTTPS and credentials.

## Validate and measure

```sh
cargo test --manifest-path device/engine/Cargo.toml
cargo clippy --manifest-path device/engine/Cargo.toml --all-targets -- -D warnings
cargo run --release --manifest-path device/engine/Cargo.toml --example render-bench
```

The benchmark performs a resource update plus an 800 × 480 render, after warm-up. In a local desktop run, the text-fitting fast path reduced the mean from about 77 µs to about 40 µs. This is a host measurement, not a hardware frame-rate guarantee; e-ink refresh and network operations have separate costs. Use the same executable and environment for comparisons.
