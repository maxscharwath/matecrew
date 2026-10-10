//! Portable scene definitions; drawing, validation and input live in separate modules.
use embedded_graphics::{prelude::*, primitives::Rectangle};
use serde::{Deserialize, Serialize};
use serde_json::Value;
mod button;
mod charts;
mod input;
mod render;
mod surface;
mod typography;
pub use surface::{SurfaceStyle, Shadow};
pub use typography::Typography;
mod validation;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Scene {
    pub version: u8,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub resources: Vec<Resource>,
    #[serde(default)]
    pub state: Value,
    #[serde(default)]
    pub actions: std::collections::BTreeMap<String, Action>,
    pub root: Node,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub path: String,
    #[serde(default)]
    pub refresh_ms: u64,
    #[serde(default)]
    pub on_wake: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    Toast {
        message: String,
        #[serde(rename = "durationMs")]
        duration_ms: u32,
    },
    Dialog {
        title: String,
        message: String,
        #[serde(rename = "confirmLabel")]
        confirm_label: String,
        #[serde(rename = "cancelLabel")]
        cancel_label: String,
        #[serde(rename = "onConfirm")]
        on_confirm: String,
    },
    DialogChoice {
        confirm: bool,
    },
    SetState {
        key: String,
        value: Value,
    },
    Fetch {
        resource: String,
    },
    Navigate {
        operation: Navigation,
        route: String,
    },
    Beep {
        tone: BeepTone,
    },
    /// A portable event handled by the app's host: buttons, navigation or domain mutations.
    Emit {
        name: String,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
impl Rect {
    fn area(self, origin: Point) -> Rectangle {
        Rectangle::new(
            origin + Point::new(self.x, self.y),
            Size::new(self.width, self.height),
        )
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Binding {
    Bound {
        bind: String,
        #[serde(default)]
        fallback: Value,
    },
    Literal {
        literal: Value,
    },
}
impl Binding {
    pub(crate) fn resolve<'a>(&'a self, data: &'a Value, item: Option<&'a Value>) -> &'a Value {
        match self {
            Self::Literal { literal } => literal,
            Self::Bound { bind, fallback } => {
                let (root, path) = if let Some(path) = bind.strip_prefix("item.") {
                    (item.unwrap_or(fallback), path)
                } else {
                    (data, bind.as_str())
                };
                path.split('.')
                    .try_fold(root, |v, k| {
                        if let Ok(i) = k.parse::<usize>() {
                            v.get(i)
                        } else {
                            v.get(k)
                        }
                    })
                    .unwrap_or(fallback)
            }
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Font {
    Caption,
    #[default]
    Body,
    Title,
    Display,
}
#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    #[default]
    Left,
    Center,
    Right,
}
fn one() -> u8 {
    1
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ButtonIcon {
    pub width: u32,
    pub height: u32,
    pub bits: Vec<u8>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Node {
    Modal {
        rect: Rect,
        value: Binding,
        child: Box<Node>,
    },
    Router {
        rect: Rect,
        initial: String,
        routes: Vec<Route>,
    },
    Group {
        rect: Rect,
        #[serde(default)]
        children: Vec<Node>,
    },
    Row {
        rect: Rect,
        #[serde(default)]
        gap: u32,
        #[serde(default)]
        children: Vec<Node>,
    },
    Column {
        rect: Rect,
        #[serde(default)]
        gap: u32,
        #[serde(default)]
        children: Vec<Node>,
    },
    Panel {
        rect: Rect,
        #[serde(default)]
        inverted: bool,
        #[serde(default)]
        style: Option<SurfaceStyle>,
        #[serde(default)]
        children: Vec<Node>,
    },
    Text {
        rect: Rect,
        value: Binding,
        #[serde(default)]
        font: Font,
        #[serde(default)]
        align: Align,
        #[serde(default)]
        inverted: bool,
        #[serde(default = "one", rename = "maxLines")]
        max_lines: u8,
        #[serde(default)]
        typography: Option<Typography>,
    },
    Progress {
        rect: Rect,
        value: Binding,
    },
    Chart {
        rect: Rect,
        value: Binding,
        max: Binding,
    },
    Plot {
        rect: Rect,
        value: Binding,
        max: Binding,
        stroke: u8,
        axes: bool,
    },
    Button {
        rect: Rect,
        label: Binding,
        action: String,
        #[serde(default)]
        input: Option<String>,
        #[serde(default)]
        dock: bool,
        #[serde(default)]
        icon: Option<ButtonIcon>,
    },
    When {
        rect: Rect,
        value: Binding,
        child: Box<Node>,
    },
    Image {
        rect: Rect,
        value: Binding,
        source_width: u32,
        source_height: u32,
    },
    CartesianChart {
        rect: Rect,
        data: Binding,
        max: Binding,
        series: Vec<ChartSeries>,
        x_key: String,
        axes: bool,
        grid: bool,
        legend: bool,
    },
    WebImage {
        rect: Rect,
        src: Binding,
        #[serde(default)]
        cover: bool,
    },
    Qr {
        rect: Rect,
        value: Binding,
    },
    Repeat {
        rect: Rect,
        value: Binding,
        child: Box<Node>,
        #[serde(default)]
        gap: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChartSeries {
    pub data_key: String,
    pub label: String,
    /// 0 = line, 1 = bar, 2 = area.
    pub style: u8,
    /// 0 = solid, 1 = dotted, 2 = dashed.
    pub stroke: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BeepTone {
    Key,
    Success,
    Error,
    Notification,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Route {
    pub name: String,
    pub root: Node,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Navigation {
    Push,
    Replace,
    Back,
    Reset,
}
