//! Bounded web-image decoding. HTTP stays in the host; PNG pixels are converted locally.
use crate::scene::Node;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Cursor;

pub const MAX_DOWNLOAD_BYTES: usize = 64 * 1024;
pub const MAX_SIDE: u32 = 256;
pub const MAX_IMAGES: usize = 8;
pub const MAX_CACHE_BYTES: usize = 16 * 1024;
pub(crate) const CACHE_KEY: &str = "$images";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageRequest {
    pub src: String,
    pub width: u32,
    pub height: u32,
    pub cover: bool,
}
impl ImageRequest {
    pub fn key(&self) -> String {
        format!(
            "{}x{}:{}:{}",
            self.width,
            self.height,
            u8::from(self.cover),
            self.src
        )
    }
    pub fn valid(&self) -> bool {
        valid_source(&self.src)
            && (1..=MAX_SIDE).contains(&self.width)
            && (1..=MAX_SIDE).contains(&self.height)
    }
    pub fn packed_len(&self) -> usize {
        (self.width as usize * self.height as usize).div_ceil(8)
    }
}

/// Relative API paths may use host authentication. Absolute HTTPS images are public.
pub fn valid_source(src: &str) -> bool {
    if src.is_empty()
        || src.len() > 1024
        || src
            .bytes()
            .any(|b| b <= 32 || b == 127 || b == b'\\' || b == b'#')
    {
        return false;
    }
    if src.starts_with('/') {
        return src.len() <= 256 && !src.starts_with("//");
    }
    let Some(rest) = src.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?']).next().unwrap_or_default();
    let (host, port) = authority
        .split_once(':')
        .map_or((authority, None), |(host, port)| (host, Some(port)));
    !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        && port
            .is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()))
}

/// Resolve image URLs and sizes from the same data, list scopes and layout as the renderer.
pub(crate) fn requests(scene: &crate::Scene, data: &Value) -> Vec<ImageRequest> {
    use crate::scene::layout::{self, Env};
    use embedded_graphics::{prelude::*, primitives::Rectangle};
    #[allow(clippy::too_many_arguments)]
    fn visit(
        node: &Node,
        area: Rectangle,
        env: Env,
        item: Option<&Value>,
        out: &mut Vec<ImageRequest>,
        remaining: &mut usize,
    ) {
        if *remaining == 0 || out.len() >= MAX_IMAGES {
            return;
        }
        *remaining -= 1;
        match node {
            Node::Router { .. } => {
                if let Some(route) = node.active_route(env.data) {
                    visit(route, layout::absolute(route, area, env, item), env, item, out, remaining);
                }
            }
            Node::WebImage { src, cover, .. } => {
                if let Some(src) = src.resolve(env.data, item).as_str() {
                    let request = ImageRequest {
                        src: src.into(),
                        width: area.size.width,
                        height: area.size.height,
                        cover: *cover,
                    };
                    if request.valid()
                        && !out.contains(&request)
                        && out.iter().map(ImageRequest::packed_len).sum::<usize>()
                            + request.packed_len()
                            <= MAX_CACHE_BYTES
                    {
                        out.push(request);
                    }
                }
            }
            Node::Group { children, .. }
            | Node::Panel { children, .. }
            | Node::Row { children, .. }
            | Node::Column { children, .. } => {
                for (child, placed) in children.iter().zip(layout::place(node, area, env, item)) {
                    visit(child, placed, env, item, out, remaining);
                }
            }
            Node::When { value, child, .. } | Node::Modal { value, child, .. } => {
                if crate::scene::expr::truthy(&value.resolve(env.data, item)) {
                    visit(child, layout::absolute(child, area, env, item), env, item, out, remaining);
                }
            }
            Node::Repeat { value, child, gap, .. } => {
                let list = value.resolve(env.data, item);
                if let Some(items) = list.as_array() {
                    let mut y = 0i32;
                    for entry in items.iter().take(32) {
                        let bounds = Rectangle::new(
                            area.top_left + Point::new(0, y),
                            Size::new(area.size.width, area.size.height.saturating_sub(y.max(0) as u32)),
                        );
                        let placed = layout::absolute(child, bounds, env, Some(entry));
                        visit(child, placed, env, Some(entry), out, remaining);
                        y = y.saturating_add(placed.size.height as i32 + (*gap).min(4096) as i32);
                    }
                }
            }
            _ => {}
        }
    }
    let env = Env { data, theme: scene.theme_for(data) };
    let screen = Rectangle::new(Point::zero(), Size::new(scene.width, scene.height));
    let mut out = Vec::new();
    visit(&scene.root, layout::absolute(&scene.root, screen, env, None), env, None, &mut out, &mut 2048);
    out
}

/// Decode one non-interlaced PNG a row at a time, without allocating a full RGBA frame.
/// Palette/gray/RGB/RGBA and 1/2/4/8/16-bit sources become dithered, packed monochrome.
pub fn decode_png(request: &ImageRequest, bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    if !request.valid() || bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err("image limit exceeded");
    }
    let mut decoder =
        png::Decoder::new_with_limits(Cursor::new(bytes), png::Limits { bytes: 64 * 1024 });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let info = decoder
        .read_header_info()
        .map_err(|_| "invalid PNG header")?;
    let (sw, sh) = (info.width, info.height);
    if sw == 0 || sh == 0 || sw > 512 || sh > 512 || info.interlaced {
        return Err("PNG must be non-interlaced and at most 512x512");
    }
    let mut reader = decoder.read_info().map_err(|_| "invalid PNG")?;
    if reader.info().animation_control.is_some() {
        return Err("animated PNG is unsupported");
    }
    let color = reader.output_color_type().0;
    let channels = color.samples();
    let (w, h) = (request.width, request.height);
    let width_constrained = (sw * h >= sh * w) != request.cover;
    let (dw, dh) = if width_constrained {
        (w, (sh * w / sw).max(1))
    } else {
        ((sw * h / sh).max(1), h)
    };
    let (left, top) = ((w as i32 - dw as i32) / 2, (h as i32 - dh as i32) / 2);
    let mut bits = vec![0; request.packed_len()];
    const BAYER: [[u32; 4]; 4] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    for sy in 0..sh {
        let row = reader
            .next_row()
            .map_err(|_| "damaged PNG")?
            .ok_or("truncated PNG")?;
        for y in 0..h {
            let dy = y as i32 - top;
            if dy < 0 || dy >= dh as i32 || dy as u32 * sh / dh != sy {
                continue;
            }
            for x in 0..w {
                let dx = x as i32 - left;
                if dx < 0 || dx >= dw as i32 {
                    continue;
                }
                let offset = (dx as u32 * sw / dw) as usize * channels;
                let p = &row.data()[offset..offset + channels];
                let (gray, alpha) = match color {
                    png::ColorType::Grayscale => (u32::from(p[0]), 255),
                    png::ColorType::GrayscaleAlpha => (u32::from(p[0]), u32::from(p[1])),
                    png::ColorType::Rgb | png::ColorType::Rgba => (
                        (u32::from(p[0]) * 77 + u32::from(p[1]) * 150 + u32::from(p[2]) * 29) / 256,
                        if channels == 4 { u32::from(p[3]) } else { 255 },
                    ),
                    _ => return Err("unsupported PNG color"),
                };
                let luma = (gray * alpha + 255 * (255 - alpha)) / 255;
                if luma < BAYER[y as usize % 4][x as usize % 4] * 16 + 8 {
                    let i = (y * w + x) as usize;
                    bits[i / 8] |= 0x80 >> (i % 8);
                }
            }
        }
    }
    reader.finish().map_err(|_| "damaged PNG trailer")?;
    Ok(bits)
}

pub(crate) fn pack_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 15) as usize] as char);
    }
    out
}
pub(crate) fn unpack_hex(value: &Value, length: usize) -> Option<Vec<u8>> {
    let text = value.as_str()?;
    if text.len() != length.checked_mul(2)? || length > MAX_CACHE_BYTES {
        return None;
    }
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let digit = |b: u8| match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(b - b'a' + 10),
                _ => None,
            };
            Some(digit(pair[0])? * 16 + digit(pair[1])?)
        })
        .collect()
}
