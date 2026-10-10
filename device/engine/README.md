# Portable TSX device engine

Rust renders all layouts on the device. It consumes compact DUI1 definitions produced by the TSX SDK in `../sdk`. See [the SDK guide](../sdk/README.md) for syntax, apps, limits and examples.

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

The current 21 maté screens occupy roughly 16 KiB compressed. The nine-page Showcase is roughly 6 KiB. `../apps/mate` and `../apps/showcase` share the same engine and public SDK. Built-in application selection belongs to the terminal host.

## Format and compatibility

DUI1 uses numeric node/action opcodes, a shared UTF-8 string table, fixed-width geometry, typed literals (including packed bytes), bindings and resource descriptors. The decoder validates all lengths, enum values, route/action references and limits. Unknown opcodes are rejected. New image/chart/router/input/beep/docked-button features require the matching engine/firmware build; an older DUI1 engine cannot execute newly introduced opcodes.

The native kit added: 22 text with letter spacing, 23 button with a variant (`ghost`: hit area only), 24 styled QR (module style, error correction, quiet zone, centre logo), 25 plot with weight and dithered fill, 26 image drawn in paper, 27 packed sprite (raw rows instead of one value per byte), 28 group with a flex layout, 29 panel with style and layout. Typography families 4 (grotesk, 11–49: Montserrat, and Space Grotesk for bold from 20) and 5 (numeric, Logisoso 20–92) and the `paper` theme need this engine too. A scene holds up to 512 nodes.

Later additions, all in this engine:

- **Layout**: dimensions are pixels, `HUG` (0xFFFE), `FILL` (0xFE00 + weight) or percent (0xFD00 + p); a layout carries direction, align, justify, gap and padding (`scene/layout.rs`). Text is centred on its capitals.
- **Expressions**: binding tag 2, an operator and its arguments (concat, comparisons, logic, arithmetic, `cond`, `fixed`, `pad`, `t`…; `scene/expr.rs`), at most 16 arguments and 8 levels deep.
- **Messages**: section `0xFF` before the root holds the translations a scene uses; `t` becomes a `Message` binding formatted on the device (`scene/i18n.rs`, an ICU subset: arguments, `plural` with `=n`, `select`, `#`).
- **Actions**: 8 sequence, 9 state setter from a binding or an expression.
- **Text style byte**: bit 0 italic, bit 1 `fit` (the family's smaller sizes before an ellipsis).
- **Charts**: the legend byte's bit 1 stacks bar series; x labels sit under each category, as many as fit.
- **Beeps**: tone 4 is `badge`.
- **DUIZ**: `"DUIZ"`, the DUI1 size (u32 LE), then a raw DEFLATE stream; `from_bytecode` inflates it (miniz_oxide) and checks the size.

Optional image support currently decodes non-interlaced PNG rows through the [png decoder](https://docs.rs/png/0.18.1/png/struct.Decoder.html), avoiding a complete RGBA framebuffer. Max source 512 × 512, download 64 KiB, destination 256 × 256, eight cache entries / 16 KiB packed pixels. Transparent pixels composite onto white. The platform adapter owns HTTPS and credentials.

## Fonts

The `paper` and `dark` themes write in OWT's faces, as on owt.swiss: Montserrat for text, Space Grotesk for
bold titles (`grotesk` bold from 20 px), both under the SIL Open Font License (`src/fonts/OFL-*.txt`).
`src/fonts/*.u8g2font` are bitmap fonts in the `u8g2-fonts` format, drawn from the variable fonts in
`../tools/fonts/` by `bun device/tools/fonts/build.ts` (`--sheet` also draws every size to
`device/out/fonts.png`): printable ASCII, Latin-1, French punctuation, thin spaces and arrows, one bit per
pixel with a light grid fit. Each size keeps the line box of the Free Universal font it replaced, so layouts
keep their rhythm; Montserrat's weights (500, 650) and capital height (94 % of the size) keep the old stroke
widths and x-height. Logisoso (figures) and the `flipper` and `macos` fonts come from the crate.

## Validate and measure

```sh
cargo test --manifest-path device/engine/Cargo.toml
cargo clippy --manifest-path device/engine/Cargo.toml --all-targets -- -D warnings
cargo test --release --manifest-path device/engine/Cargo.toml --test bench -- --ignored --nocapture
```

`tests/bench.rs` renders every maté preview (`../apps/mate/previews.json`, `../dist/mate`) and prints the
CPU time per screen: what the terminal stays awake for. `BENCH_ONLY=<preview>` and `BENCH_ROUNDS` keep
one screen on the CPU for a profiler (`sample <pid>` on macOS).

The render path is tuned for energy, pixel for pixel identical (the 55 snapshots guard it): at 1× the
pixelating wrapper passes pixels through; opaque surfaces and solid bars fill whole scanlines through
`fill_solid` (bytes, not pixels); dithered surfaces walk the shape's scanlines and emit only the
lit Bayer columns; clipping tests precomputed edges (`clip.rs`); text measurements are memoized by font
and string (`text.rs`); QR codes are kept encoded between redraws (`scene/qr.rs`). On a desktop the
mean render went from about 1.4 ms to 0.3 ms (−79 %), the summary screen from 3.4 ms to 0.3 ms. This is
a host measurement, not a hardware frame-rate guarantee; e-ink refresh and network operations have
separate costs. Use the same executable and environment for comparisons.
