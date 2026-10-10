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
        match self.u8()? {
            0 => Ok(Binding::Literal {
                literal: self.value(0)?,
            }),
            1 => Ok(Binding::Bound {
                bind: self.string()?,
                fallback: self.value(0)?,
            }),
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
            },
            1 | 2 => {
                let gap = self.u16()? as u32;
                let children = self.children(depth)?;
                if kind == 1 {
                    Node::Row {
                        rect,
                        gap,
                        children,
                    }
                } else {
                    Node::Column {
                        rect,
                        gap,
                        children,
                    }
                }
            }
            3 | 20 => Node::Panel {
                rect,
                inverted: self.flag()?,
                style: if kind == 20 {
                    Some(SurfaceStyle {
                        radius: self.u8()?, border_width: self.u8()?, border_style: self.u8()?,
                        background: self.u8()?, opacity: self.u8()?,
                        shadow: if self.flag()? { Some(Shadow { x: self.i16()?, y: self.i16()?, opacity: self.u8()? }) } else { None },
                    })
                } else { None },
                children: self.children(depth)?,
            },
            4 | 21 => {
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
                    typography: if kind == 21 { Some(Typography { family: self.u8()?, size: self.u8()?, weight: self.u8()?, italic: self.flag()? }) } else { None },
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
            9 => Node::Image {
                rect,
                value: self.binding()?,
                source_width: self.u16()? as u32,
                source_height: self.u16()? as u32,
            },
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
                let legend = self.flag()?;
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
                }
            }
            13 => Node::WebImage {
                rect,
                src: self.binding()?,
                cover: self.flag()?,
            },
            12 => Node::Plot {
                rect,
                value: self.binding()?,
                max: self.binding()?,
                stroke: self.u8()?,
                axes: self.flag()?,
            },
            11 => Node::When {
                rect,
                value: self.binding()?,
                child: Box::new(self.node(depth + 1)?),
            },
            10 => Node::Qr {
                rect,
                value: self.binding()?,
            },
            _ => return Err("unknown node opcode"),
        })
    }
}
impl Scene {
    pub fn from_bytecode(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_BYTES {
            return Err("bytecode size limit");
        }
        let mut r = Reader {
            bytes,
            at: 0,
            strings: Vec::new(),
            values: 0,
            nodes: 0,
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
                _ => return Err("bad action"),
            };
            if actions.insert(id, action).is_some() {
                return Err("duplicate action identifier");
            }
        }
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
        scene.render(&mut frame, runtime.data(), 2).unwrap();
        assert!(frame.bits.iter().any(|&b| b != 0));
        let before = frame.bits.clone();
        runtime.press(crate::Point::new(336, 226)); // Compiled useDeviceState setter behind the help button.
        scene.render(&mut frame, runtime.data(), 2).unwrap();
        assert!(before != frame.bits);
        let mut small = Frame::new(400, 240).unwrap();
        scene.render(&mut small, runtime.data(), 1).unwrap();
        assert!(small.bits.iter().any(|&b| b != 0));
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
