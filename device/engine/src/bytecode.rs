//! DUI1 bytecode decoder. All offsets, counts, UTF-8 and opcodes are checked before rendering.
use crate::limits::*;
use crate::scene::*;
use serde_json::{Map, Number, Value};
use std::collections::BTreeMap;

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    strings: Vec<&'a str>,
    values: usize,
    nodes: usize,
    /// Locales (default first) and, per key, one message per locale.
    messages: Option<(Vec<String>, BTreeMap<String, Vec<String>>)>,
}
impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], &'static str> {
        let end = self.at.checked_add(n).ok_or("overflow")?;
        let b = self.bytes.get(self.at..end).ok_or("truncated bytecode")?;
        self.at = end;
        Ok(b)
    }
    fn u8(&mut self) -> Result<u8, &'static str> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, &'static str> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn i16(&mut self) -> Result<i16, &'static str> {
        Ok(i16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, &'static str> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn string(&mut self) -> Result<String, &'static str> {
        let index = self.u16()? as usize;
        Ok(self
            .strings
            .get(index)
            .ok_or("bad string index")?
            .to_string())
    }
    fn flag(&mut self) -> Result<bool, &'static str> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err("invalid flag"),
        }
    }
    fn value(&mut self, depth: usize) -> Result<Value, &'static str> {
        self.values += 1;
        if depth > MAX_DEPTH || self.values > MAX_VALUES {
            return Err("literal limit");
        }
        Ok(match self.u8()? {
            0 => Value::Null,
            1 => Value::Bool(false),
            2 => Value::Bool(true),
            3 => Value::Number(i64::from_le_bytes(self.take(8)?.try_into().unwrap()).into()),
            4 => Value::Number(
                Number::from_f64(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
                    .ok_or("non-finite value")?,
            ),
            5 => Value::String(self.string()?),
            6 => {
                let n = self.u16()?;
                let mut a = Vec::new();
                for _ in 0..n {
                    a.push(self.value(depth + 1)?);
                }
                Value::Array(a)
            }
            7 => {
                let n = self.u16()?;
                let mut m = Map::new();
                for _ in 0..n {
                    let k = self.string()?;
                    m.insert(k, self.value(depth + 1)?);
                }
                Value::Object(m)
            }
            8 => {
                let n = self.u16()? as usize;
                self.values += n;
                if self.values > MAX_VALUES {
                    return Err("literal limit");
                }
                Value::Array(
                    self.take(n)?
                        .iter()
                        .map(|&b| Value::Number(b.into()))
                        .collect(),
                )
            }
            _ => return Err("unknown value opcode"),
        })
    }
    fn binding(&mut self) -> Result<Binding, &'static str> {
        self.binding_at(0)
    }
    fn binding_at(&mut self, depth: usize) -> Result<Binding, &'static str> {
        match self.u8()? {
            0 => Ok(Binding::Literal {
                literal: self.value(0)?,
            }),
            1 => Ok(Binding::Bound {
                bind: self.string()?,
                fallback: self.value(0)?,
            }),
            2 => {
                let expr = self.u8()?;
                let count = self.u8()? as usize;
                let (min, max) = crate::scene::expr::arity(expr).ok_or("unknown expression")?;
                self.values += 1;
                if depth >= crate::scene::expr::MAX_DEPTH || !(min..=max).contains(&count) || self.values > MAX_VALUES {
                    return Err("invalid expression");
                }
                let args: Vec<Binding> = (0..count).map(|_| self.binding_at(depth + 1)).collect::<Result<_, _>>()?;
                if expr == crate::scene::expr::op::T {
                    return self.message(args);
                }
                Ok(Binding::Expr { expr, args })
            }
            _ => Err("bad binding"),
        }
    }
    fn children(&mut self, depth: usize) -> Result<Vec<Node>, &'static str> {
        let n = self.u16()?;
        if n as usize > MAX_NODES {
            return Err("child limit");
        }
        let mut a = Vec::new();
        for _ in 0..n {
            a.push(self.node(depth + 1)?);
        }
        Ok(a)
    }
    /// `t(key, name, value, ...)` with its messages from the table, decoded once.
    fn message(&self, args: Vec<Binding>) -> Result<Binding, &'static str> {
        let mut args = args.into_iter();
        let Some(Binding::Literal { literal: Value::String(key) }) = args.next() else {
            return Err("message key must be literal text");
        };
        let rest: Vec<Binding> = args.collect();
        if rest.len() % 2 != 0 {
            return Err("message arguments come in name/value pairs");
        }
        let mut params = Vec::new();
        for pair in rest.chunks(2) {
            let Binding::Literal { literal: Value::String(name) } = &pair[0] else {
                return Err("message argument names must be literal text");
            };
            params.push((name.clone(), pair[1].clone()));
        }
        let messages = match &self.messages {
            Some((locales, table)) => match table.get(key.as_str()) {
                Some(row) => locales.iter().cloned().zip(row.iter().cloned()).collect(),
                None => vec![(String::new(), key)],
            },
            None => vec![(String::new(), key)],
        };
        Ok(Binding::Message { messages, params })
    }
    /// Optional message table before the root: 0xFF, locales, then each key's messages.
    fn messages(&mut self) -> Result<(), &'static str> {
        if self.bytes.get(self.at) != Some(&0xFF) {
            return Ok(());
        }
        self.at += 1;
        let count = self.u8()? as usize;
        if !(1..=8).contains(&count) {
            return Err("locale limit");
        }
        let locales = (0..count).map(|_| self.string()).collect::<Result<Vec<_>, _>>()?;
        let keys = self.u16()? as usize;
        let mut table = BTreeMap::new();
        for _ in 0..keys {
            let key = self.string()?;
            let row = (0..count).map(|_| self.string()).collect::<Result<Vec<_>, _>>()?;
            self.values += count;
            if self.values > MAX_VALUES || table.insert(key, row).is_some() {
                return Err("invalid message table");
            }
        }
        self.messages = Some((locales, table));
        Ok(())
    }
    fn surface(&mut self) -> Result<SurfaceStyle, &'static str> {
        Ok(SurfaceStyle {
            radius: self.u8()?, border_width: self.u8()?, border_style: self.u8()?,
            background: self.u8()?, opacity: self.u8()?,
            shadow: if self.flag()? { Some(Shadow { x: self.i16()?, y: self.i16()?, opacity: self.u8()? }) } else { None },
        })
    }
    fn layout(&mut self) -> Result<Layout, &'static str> {
        let layout = Layout {
            direction: self.u8()?,
            align: self.u8()?,
            justify: self.u8()?,
            gap: self.u16()?,
            padding: [self.u16()?, self.u16()?, self.u16()?, self.u16()?],
        };
        if layout.valid() { Ok(layout) } else { Err("invalid layout") }
    }
    /// Optional packed sprite: width, height (0 = none), then its rows.
    fn sprite(&mut self, max: u32) -> Result<Option<ButtonIcon>, &'static str> {
        let width = self.u8()? as u32;
        let height = self.u8()? as u32;
        if width == 0 && height == 0 {
            return Ok(None);
        }
        if width == 0 || height == 0 || width > max || height > max {
            return Err("invalid sprite");
        }
        Ok(Some(ButtonIcon {
            width,
            height,
            bits: self.take((width * height).div_ceil(8) as usize)?.to_vec(),
        }))
    }
    fn node(&mut self, depth: usize) -> Result<Node, &'static str> {
        self.nodes += 1;
        if depth > MAX_DEPTH || self.nodes > MAX_NODES {
            return Err("node limit");
        }
        let kind = self.u8()?;
        let rect = Rect {
            x: self.i16()? as i32,
            y: self.i16()? as i32,
            width: self.u16()? as u32,
            height: self.u16()? as u32,
        };
        Ok(match kind {
            19 => Node::Modal {
                rect,
                value: self.binding()?,
                child: Box::new(self.node(depth + 1)?),
            },
            0 => Node::Group {
                rect,
                children: self.children(depth)?,
                layout: None,
            },
            28 => Node::Group {
                rect,
                layout: Some(self.layout()?),
                children: self.children(depth)?,
            },
            29 => {
                let inverted = self.flag()?;
                let style = if self.flag()? { Some(self.surface()?) } else { None };
                Node::Panel {
                    rect,
                    inverted,
                    style,
                    layout: Some(self.layout()?),
                    children: self.children(depth)?,
                }
            }
            3 | 20 => Node::Panel {
                rect,
                inverted: self.flag()?,
                style: if kind == 20 { Some(self.surface()?) } else { None },
                children: self.children(depth)?,
                layout: None,
            },
            4 | 21 | 22 => {
                let font = match self.u8()? {
                    0 => Font::Caption,
                    1 => Font::Body,
                    2 => Font::Title,
                    3 => Font::Display,
                    _ => return Err("bad font"),
                };
                let align = match self.u8()? {
                    0 => Align::Left,
                    1 => Align::Center,
                    2 => Align::Right,
                    _ => return Err("bad alignment"),
                };
                let inverted = self.flag()?;
                let max_lines = self.u8()?;
                Node::Text {
                    rect,
                    font,
                    align,
                    inverted,
                    max_lines,
                    typography: if kind >= 21 {
                        let (family, size, weight) = (self.u8()?, self.u8()?, self.u8()?);
                        // Bit 0: italic; bit 1: shrink to fit.
                        let style = self.u8()?;
                        if style > 3 {
                            return Err("invalid text style");
                        }
                        Some(Typography {
                            family,
                            size,
                            weight,
                            italic: style & 1 != 0,
                            tracking: if kind == 22 { self.u8()? } else { 0 },
                            fit: style & 2 != 0,
                        })
                    } else {
                        None
                    },
                    value: self.binding()?,
                }
            }
            5 => Node::Progress {
                rect,
                value: self.binding()?,
            },
            6 => Node::Chart {
                rect,
                value: self.binding()?,
                max: self.binding()?,
            },
            7 | 15 | 17 | 18 => Node::Button {
                rect,
                label: self.binding()?,
                action: self.string()?,
                input: if kind != 7 {
                    let name = self.string()?;
                    if name.is_empty() {
                        None
                    } else {
                        Some(name)
                    }
                } else {
                    None
                },
                dock: if kind == 18 { self.flag()? } else { kind == 17 },
                ghost: false,
                icon: if kind == 18 {
                    let width = self.u8()? as u32;
                    let height = self.u8()? as u32;
                    if width == 0 || height == 0 || width > 64 || height > 64 {
                        return Err("invalid button icon");
                    }
                    Some(ButtonIcon {
                        width,
                        height,
                        bits: self.take((width * height).div_ceil(8) as usize)?.to_vec(),
                    })
                } else {
                    None
                },
            },
            8 => Node::Repeat {
                rect,
                value: self.binding()?,
                gap: self.u16()? as u32,
                child: Box::new(self.node(depth + 1)?),
            },
            9 | 26 => Node::Image {
                rect,
                value: self.binding()?,
                source_width: self.u16()? as u32,
                source_height: self.u16()? as u32,
                inverted: kind == 26 && self.flag()?,
                packed: None,
            },
            27 => {
                let source_width = self.u16()? as u32;
                let source_height = self.u16()? as u32;
                if source_width == 0 || source_height == 0 || source_width > MAX_VIEWPORT || source_height > MAX_VIEWPORT {
                    return Err("invalid sprite size");
                }
                let inverted = self.flag()?;
                let packed = self.take((source_width * source_height).div_ceil(8) as usize)?.to_vec();
                Node::Image {
                    rect,
                    value: Binding::Literal { literal: Value::Null },
                    source_width,
                    source_height,
                    inverted,
                    packed: Some(packed),
                }
            }
            16 => {
                let initial = self.string()?;
                let count = self.u8()?;
                if !(1..=16).contains(&count) {
                    return Err("route limit");
                }
                let mut routes = Vec::new();
                for _ in 0..count {
                    routes.push(Route {
                        name: self.string()?,
                        root: self.node(depth + 1)?,
                    });
                }
                Node::Router {
                    rect,
                    initial,
                    routes,
                }
            }
            14 => {
                let data = self.binding()?;
                let max = self.binding()?;
                let x_key = self.string()?;
                let axes = self.flag()?;
                let grid = self.flag()?;
                // Bit 0: legend; bit 1: stacked bars.
                let options = self.u8()?;
                if options > 3 {
                    return Err("invalid chart options");
                }
                let (legend, stacked) = (options & 1 != 0, options & 2 != 0);
                let count = self.u8()?;
                if !(1..=4).contains(&count) {
                    return Err("chart series limit");
                }
                let mut series = Vec::new();
                for _ in 0..count {
                    series.push(ChartSeries {
                        data_key: self.string()?,
                        label: self.string()?,
                        style: self.u8()?,
                        stroke: self.u8()?,
                    });
                }
                Node::CartesianChart {
                    rect,
                    data,
                    max,
                    series,
                    x_key,
                    axes,
                    grid,
                    legend,
                    stacked,
                }
            }
            13 => Node::WebImage {
                rect,
                src: self.binding()?,
                cover: self.flag()?,
            },
            12 | 25 => Node::Plot {
                rect,
                value: self.binding()?,
                max: self.binding()?,
                stroke: self.u8()?,
                axes: self.flag()?,
                weight: if kind == 25 { self.u8()? } else { 1 },
                fill: if kind == 25 { self.u8()? } else { 0 },
            },
            11 => Node::When {
                rect,
                value: self.binding()?,
                child: Box::new(self.node(depth + 1)?),
            },
            23 => {
                let label = self.binding()?;
                let action = self.string()?;
                let input = Some(self.string()?).filter(|name| !name.is_empty());
                let variant = self.u8()?;
                if variant > 2 {
                    return Err("bad button variant");
                }
                Node::Button {
                    rect,
                    label,
                    action,
                    input,
                    dock: variant == 1,
                    ghost: variant == 2,
                    icon: self.sprite(64)?,
                }
            }
            10 => Node::Qr {
                rect,
                value: self.binding()?,
                style: 0,
                ecc: 0,
                quiet: 4,
                logo: None,
            },
            24 => {
                let value = self.binding()?;
                let style = self.u8()?;
                let ecc = self.u8()?;
                let quiet = self.u8()?;
                if style > 2 || ecc > 3 || quiet > 8 {
                    return Err("bad QR style");
                }
                Node::Qr {
                    rect,
                    value,
                    style,
                    ecc,
                    quiet,
                    logo: self.sprite(128)?,
                }
            }
            _ => return Err("unknown node opcode"),
        })
    }
}
/// The DUI1 bytes inside a DUIZ container: exactly the announced size, the whole stream used.
fn inflate(packed: &[u8]) -> Result<Vec<u8>, &'static str> {
    use miniz_oxide::inflate::core::{decompress, inflate_flags, DecompressorOxide};
    use miniz_oxide::inflate::TINFLStatus;
    let (size, stream) = packed.split_first_chunk::<4>().ok_or("truncated bytecode")?;
    let size = u32::from_le_bytes(*size) as usize;
    if size > MAX_BYTES || stream.len() > MAX_BYTES {
        return Err("bytecode size limit");
    }
    let mut out = vec![0; size];
    let mut state = DecompressorOxide::new();
    let (status, read, written) = decompress(
        &mut state,
        stream,
        &mut out,
        0,
        inflate_flags::TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
    );
    if status != TINFLStatus::Done || read != stream.len() || written != size || out.starts_with(b"DUIZ") {
        return Err("corrupt compressed bytecode");
    }
    Ok(out)
}

impl Scene {
    /// DUI1 bytecode, or DUIZ: the same, DEFLATE-compressed (`DUIZ`, u32 size, raw stream).
    pub fn from_bytecode(bytes: &[u8]) -> Result<Self, &'static str> {
        match bytes.strip_prefix(b"DUIZ") {
            Some(packed) => Self::from_dui1(&inflate(packed)?),
            None => Self::from_dui1(bytes),
        }
    }
    fn from_dui1(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_BYTES {
            return Err("bytecode size limit");
        }
        let mut r = Reader {
            bytes,
            at: 0,
            strings: Vec::new(),
            values: 0,
            nodes: 0,
            messages: None,
        };
        if r.take(4)? != b"DUI1" {
            return Err("unknown bytecode version");
        }
        let width = r.u16()? as u32;
        let height = r.u16()? as u32;
        let strings = r.u16()?;
        if strings as usize > MAX_STRINGS {
            return Err("string limit");
        }
        for _ in 0..strings {
            let len = r.u16()? as usize;
            let string = std::str::from_utf8(r.take(len)?).map_err(|_| "invalid UTF-8")?;
            r.strings.push(string);
        }
        let count = r.u8()?;
        if count as usize > MAX_RESOURCES {
            return Err("resource limit");
        }
        let mut resources = Vec::new();
        for _ in 0..count {
            resources.push(Resource {
                id: r.string()?,
                path: r.string()?,
                refresh_ms: r.u32()? as u64,
                on_wake: r.flag()?,
            });
        }
        let state = r.value(0)?;
        let count = r.u16()?;
        if count as usize > MAX_ACTIONS {
            return Err("action limit");
        }
        let mut actions = BTreeMap::new();
        for _ in 0..count {
            let id = r.string()?;
            let action = match r.u8()? {
                0 => Action::SetState {
                    key: r.string()?,
                    value: r.value(0)?,
                },
                1 => Action::Fetch {
                    resource: r.string()?,
                },
                2 => Action::Emit { name: r.string()? },
                3 => Action::Beep {
                    tone: match r.u8()? {
                        0 => BeepTone::Key,
                        1 => BeepTone::Success,
                        2 => BeepTone::Error,
                        3 => BeepTone::Notification,
                        4 => BeepTone::Badge,
                        _ => return Err("invalid beep tone"),
                    },
                },
                4 => Action::Navigate {
                    operation: match r.u8()? {
                        0 => Navigation::Push,
                        1 => Navigation::Replace,
                        2 => Navigation::Back,
                        3 => Navigation::Reset,
                        _ => return Err("bad navigation"),
                    },
                    route: r.string()?,
                },
                5 => Action::Toast {
                    message: r.string()?,
                    duration_ms: r.u32()?,
                },
                6 => Action::Dialog {
                    title: r.string()?,
                    message: r.string()?,
                    confirm_label: r.string()?,
                    cancel_label: r.string()?,
                    on_confirm: r.string()?,
                },
                7 => Action::DialogChoice { confirm: r.flag()? },
                8 => {
                    let count = r.u8()? as usize;
                    if !(1..=8).contains(&count) {
                        return Err("bad action sequence");
                    }
                    Action::Sequence {
                        actions: (0..count).map(|_| r.string()).collect::<Result<_, _>>()?,
                    }
                }
                9 => Action::SetStateBound {
                    key: r.string()?,
                    value: r.binding()?,
                },
                _ => return Err("bad action"),
            };
            if actions.insert(id, action).is_some() {
                return Err("duplicate action identifier");
            }
        }
        r.messages()?;
        let root = r.node(0)?;
        if r.at != bytes.len() {
            return Err("trailing bytecode");
        }
        let scene = Self {
            version: 1,
            width,
            height,
            resources,
            state,
            actions,
            root,
        };
        scene.validate()?;
        Ok(scene)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{frame::Frame, Effect, Runtime};
    use serde_json::json;
    const APP: &[u8] = include_bytes!("../tests/fixtures/app.dui");
    #[test]
    fn compiled_tsx_hooks_render_on_different_devices_and_update_without_a_server_renderer() {
        let scene = Scene::from_bytecode(APP).unwrap();
        let mut runtime = Runtime::new(scene.clone()).unwrap();
        assert_eq!(
            runtime.advance(0, true),
            vec![Effect::Fetch {
                id: "stock".into(),
                path: "/api/device/state".into()
            }]
        );
        assert!(runtime.advance(100, false).is_empty());
        assert!(runtime.update("stock",json!({"office":{"name":"Lausanne"},"items":[{"name":"Maté Classic","stock":36}],"screen":{"chart":{"series":[[48,44,36]],"max":50}}})));
        let mut frame = Frame::new(800, 480).unwrap();
        scene.render(&mut frame, runtime.data(), 1).unwrap();
        assert!(frame.bits.iter().any(|&b| b != 0));
        let before = frame.bits.clone();
        runtime.press(crate::Point::new(670, 452)); // Compiled useDeviceState setter behind the help key tab.
        scene.render(&mut frame, runtime.data(), 1).unwrap();
        assert!(before != frame.bits);
        // A larger panel draws the same scene at 2×.
        let mut large = Frame::new(1600, 960).unwrap();
        scene.render(&mut large, runtime.data(), 2).unwrap();
        assert!(large.bits.iter().any(|&b| b != 0));
        assert_eq!(runtime.advance(120_000, false).len(), 1);
    }
    #[test]
    fn malformed_bytecode_is_rejected_without_partial_execution() {
        for len in 0..APP.len() {
            assert!(
                Scene::from_bytecode(&APP[..len]).is_err(),
                "accepted prefix {len}"
            );
        }
        let mut extra = APP.to_vec();
        extra.push(0);
        assert!(Scene::from_bytecode(&extra).is_err());
        // Every byte can be corrupted without a decoder panic, including counts, indices and opcodes.
        for i in 0..APP.len() {
            let mut bad = APP.to_vec();
            bad[i] = 0xff;
            let _ = Scene::from_bytecode(&bad);
        }
    }
}
