//! Portable scene definitions; drawing, validation and input live in separate modules.
use embedded_graphics::{prelude::*, primitives::Rectangle};
use serde::{Deserialize, Serialize};
use serde_json::Value;
mod button;
mod charts;
pub mod expr;
pub mod layout;
pub mod i18n;
pub use layout::Layout;
mod input;
mod qr;
mod render;
mod surface;
pub(crate) mod typography;
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
    /// Several actions on one press, in order; effects are concatenated.
    Sequence {
        actions: Vec<String>,
    },
    /// Local state set to a value computed from the app's data at the moment of the press.
    #[serde(rename = "setStateBound")]
    SetStateBound {
        key: String,
        value: Binding,
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
    /// An operator (see `expr::op`) over bindings, computed when read.
    Expr {
        expr: u8,
        #[serde(default)]
        args: Vec<Binding>,
    },
    /// A translated message: `(locale, message)`, default locale first, and its arguments.
    Message {
        messages: Vec<(String, String)>,
        #[serde(default)]
        params: Vec<(String, Binding)>,
    },
}
impl Binding {
    pub(crate) fn resolve<'a>(&'a self, data: &'a Value, item: Option<&'a Value>) -> std::borrow::Cow<'a, Value> {
        use std::borrow::Cow;
        match self {
            Self::Literal { literal } => Cow::Borrowed(literal),
            Self::Expr { expr, args } => Cow::Owned(expr::eval(*expr, args, data, item)),
            Self::Message { messages, params } => {
                let locale = i18n::locale(data, messages.iter().map(|(l, _)| l.as_str())).unwrap_or("");
                let message = messages
                    .iter()
                    .find(|(l, m)| l == locale && !m.is_empty())
                    .or_else(|| messages.first())
                    .map_or("", |(_, m)| m.as_str());
                let params: Vec<(String, Value)> =
                    params.iter().map(|(name, b)| (name.clone(), b.resolve(data, item).into_owned())).collect();
                Cow::Owned(Value::String(i18n::format(message, &params, locale)))
            }
            Self::Bound { bind, fallback } => Cow::Borrowed({
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
            }),
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
fn four() -> u8 {
    4
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
        /// Children as a flex line; absolute (rect x/y) without it.
        #[serde(default)]
        layout: Option<Layout>,
    },
    Panel {
        rect: Rect,
        #[serde(default)]
        inverted: bool,
        #[serde(default)]
        style: Option<SurfaceStyle>,
        #[serde(default)]
        children: Vec<Node>,
        #[serde(default)]
        layout: Option<Layout>,
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
        /// Line width in pixels (1–4).
        #[serde(default = "one")]
        weight: u8,
        /// Dithered tone under the line, 0 for none.
        #[serde(default)]
        fill: u8,
    },
    Button {
        rect: Rect,
        label: Binding,
        action: String,
        #[serde(default)]
        input: Option<String>,
        #[serde(default)]
        dock: bool,
        /// Hit area and hardware input only: the app draws the control itself.
        #[serde(default)]
        ghost: bool,
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
        /// Draw the sprite's ink in paper, for icons on ink surfaces.
        #[serde(default)]
        inverted: bool,
        /// Compiled art, packed rows (MSB first): used instead of `value`.
        #[serde(default)]
        packed: Option<Vec<u8>>,
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
        /// Bar series pile up in one column per category, darkest at the bottom.
        #[serde(default)]
        stacked: bool,
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
        /// 0 square modules, 1 dots, 2 rounded squares; finder patterns follow the style.
        #[serde(default)]
        style: u8,
        /// Error correction: 0 low, 1 medium, 2 quartile, 3 high (needed under a logo).
        #[serde(default)]
        ecc: u8,
        /// Quiet zone in modules.
        #[serde(default = "four")]
        quiet: u8,
        /// Mark drawn in a cleared square at the centre.
        #[serde(default)]
        logo: Option<ButtonIcon>,
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
    Badge,
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
