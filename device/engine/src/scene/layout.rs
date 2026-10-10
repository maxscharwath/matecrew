//! Responsive layout, computed at render time from the real data. A node's width and height are
//! pixels, its content (`hug`), a share of the free space (`fill`, weighted) or a percentage of
//! its parent; groups and panels with a `Layout` place their children as a flex line. Drawing,
//! input and image requests all ask this module, so they agree on every rectangle.
use super::{expr::truthy, typography::Resolved, Align, Node};
use crate::{limits::MAX_VIEWPORT, text, Theme};
use embedded_graphics::{prelude::*, primitives::Rectangle};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{cell::RefCell, collections::HashMap};

/// Size codes carried in a rect's width or height (above any pixel size).
pub const HUG: u32 = 0xFFFE;
/// `FILL + weight`, weight 1–255.
pub const FILL: u32 = 0xFE00;
/// `PERCENT + p`, p 1–100.
pub const PERCENT: u32 = 0xFD00;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Dim {
    Px(u32),
    Hug,
    Fill(u32),
    Percent(u32),
}
impl Dim {
    pub fn of(value: u32) -> Self {
        match value {
            HUG => Self::Hug,
            v if v > FILL && v <= FILL + 255 => Self::Fill(v - FILL),
            v if v > PERCENT && v <= PERCENT + 100 => Self::Percent(v - PERCENT),
            v => Self::Px(v.min(MAX_VIEWPORT)),
        }
    }
    pub fn valid(value: u32) -> bool {
        value <= MAX_VIEWPORT
            || value == HUG
            || (FILL + 1..=FILL + 255).contains(&value)
            || (PERCENT + 1..=PERCENT + 100).contains(&value)
    }
}

/// How a group or panel lays out its children: one flex line.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// 0 column, 1 row.
    pub direction: u8,
    /// Cross axis: 0 start, 1 center, 2 end, 3 stretch.
    pub align: u8,
    /// Main axis: 0 start, 1 center, 2 end, 3 space-between, 4 space-around, 5 space-evenly.
    pub justify: u8,
    pub gap: u16,
    /// Top, right, bottom, left.
    pub padding: [u16; 4],
}
impl Layout {
    pub fn valid(&self) -> bool {
        self.direction <= 1
            && self.align <= 3
            && self.justify <= 5
            && u32::from(self.gap) <= MAX_VIEWPORT
            && self.padding.iter().all(|p| u32::from(*p) <= MAX_VIEWPORT)
    }
    fn row(&self) -> bool {
        self.direction == 1
    }
    fn inner(&self, area: Rectangle) -> Rectangle {
        let [top, right, bottom, left] = self.padding.map(u32::from);
        Rectangle::new(
            area.top_left + Point::new(left as i32, top as i32),
            Size::new(
                area.size.width.saturating_sub(left + right),
                area.size.height.saturating_sub(top + bottom),
            ),
        )
    }
}

/// What layout needs from the scene: data for text and conditions, theme for fonts.
#[derive(Clone, Copy)]
pub struct Env<'a> {
    pub data: &'a Value,
    pub theme: Theme,
}

fn layout_of(node: &Node) -> Option<&Layout> {
    match node {
        Node::Group { layout, .. } | Node::Panel { layout, .. } => layout.as_ref(),
        _ => None,
    }
}

/// Hidden by its condition, or an empty list: takes no room and no gap in a flex line.
fn collapsed(node: &Node, env: Env, item: Option<&Value>) -> bool {
    match node {
        Node::When { value, .. } | Node::Modal { value, .. } => !truthy(&value.resolve(env.data, item)),
        Node::Repeat { value, .. } => value.resolve(env.data, item).as_array().is_none_or(|a| a.is_empty()),
        _ => false,
    }
}

/// The node's rectangle when its parent gives it `bounds` (absolute placement: rect x/y offset).
pub fn absolute(node: &Node, bounds: Rectangle, env: Env, item: Option<&Value>) -> Rectangle {
    let rect = node.rect();
    let room = Size::new(
        bounds.size.width.saturating_sub(rect.x.max(0) as u32),
        bounds.size.height.saturating_sub(rect.y.max(0) as u32),
    );
    let size = size_in(node, room, env, item);
    Rectangle::new(bounds.top_left + Point::new(rect.x, rect.y), size)
}

/// The node's size inside a box of `room`: pixels, percent and fill resolve against it.
fn size_in(node: &Node, room: Size, env: Env, item: Option<&Value>) -> Size {
    let rect = node.rect();
    let width = match Dim::of(rect.width) {
        Dim::Px(v) => v,
        Dim::Percent(p) => room.width * p / 100,
        Dim::Fill(_) => room.width,
        Dim::Hug => content(node, Some(room.width), env, item).width.min(room.width),
    };
    let height = match Dim::of(rect.height) {
        Dim::Px(v) => v,
        Dim::Percent(p) => room.height * p / 100,
        Dim::Fill(_) => room.height,
        Dim::Hug => content(node, Some(width), env, item).height,
    };
    Size::new(width, height)
}

fn text_metrics(node: &Node, theme: Theme) -> Option<(Resolved, i32)> {
    let Node::Text { font, typography, .. } = node else { return None };
    let resolved = typography
        .as_ref()
        .map_or_else(|| Resolved::plain(theme.font(*font)), |style| style.resolve(theme, *font));
    Some(with_line(resolved))
}

fn with_line(resolved: Resolved) -> (Resolved, i32) {
    let height = resolved.font.get_font_bounding_box(u8g2_fonts::types::VerticalPosition::Baseline).size.height as i32;
    (resolved, height + 2)
}

/// The font a text node draws `string` with in `width` pixels: its own, or for `fit` the largest
/// size of its family that holds every word on its lines. With its line pitch.
pub(super) fn text_font(node: &Node, theme: Theme, string: &str, width: i32) -> Option<(Resolved, i32)> {
    let Node::Text { font, typography, max_lines, .. } = node else { return None };
    let Some(style) = typography.as_ref().filter(|style| style.fit) else { return text_metrics(node, theme) };
    let max = usize::from((*max_lines).clamp(1, 8));
    let ink = |s: &str| s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
    let whole = ink(string);
    let fits = |r: &Resolved| {
        let room = (width - r.extra()).max(0);
        let lines = text::spaced_lines(r.font, string, room, max, r.tracking);
        lines.iter().all(|l| text::spaced_width(r.font, l, r.tracking) <= room) && ink(&lines.concat()) == whole
    };
    Some(with_line(style.fitted(theme, *font, fits)))
}

/// Empty rows a text box keeps above its capitals (room for accents) and below its baseline
/// (room for descenders). Centring weighs the capitals, not the box. 0 for other nodes.
fn slack(node: &Node, theme: Theme) -> (i32, i32) {
    match node {
        Node::When { child, .. } => slack(child, theme),
        _ => text_metrics(node, theme).map_or((0, 0), |(resolved, _)| {
            use u8g2_fonts::types::VerticalPosition::Baseline;
            let bounds = resolved.font.get_font_bounding_box(Baseline);
            let ascent = -bounds.top_left.y;
            let descent = bounds.size.height as i32 - ascent;
            let cap = resolved
                .font
                .get_rendered_dimensions("0", Point::zero(), Baseline)
                .ok()
                .and_then(|d| d.bounding_box)
                .map_or(ascent, |b| -b.top_left.y);
            ((ascent - cap).max(0), descent.max(0))
        }),
    }
}

/// Where a box of `size` starts to centre it in `room`, by its ink: a text's slack may overhang.
/// Real overflow stays at the start (CSS's safe centring), clipped at the end.
fn centre(room: u32, size: u32, (above, below): (i32, i32)) -> i32 {
    let free = room as i32 - size as i32;
    if free + above + below < 0 {
        return 0;
    }
    (free + below - above).div_euclid(2)
}

/// The engine's line pitch for a text node, as drawing uses it.
pub fn line_height(node: &Node, theme: Theme) -> i32 {
    text_metrics(node, theme).map_or(0, |(_, line)| line)
}

thread_local! {
    /// Content sizes measured during the paint under way (`remembering`), by node, width and
    /// item. A flex group measures its children at every level above them, so without this a
    /// deep tree measures its leaves over and over: two thirds of a paint on the terminal.
    static SIZES: RefCell<Option<HashMap<(usize, Option<u32>, usize), Size>>> = const { RefCell::new(None) };
}

/// Runs `paint` with content sizes remembered until it ends: data and theme do not change
/// within a paint, so a node's size for a width is measured once.
pub(super) fn remembering<T>(paint: impl FnOnce() -> T) -> T {
    let outer = SIZES.with(|sizes| sizes.replace(Some(HashMap::new())));
    let painted = paint();
    SIZES.with(|sizes| *sizes.borrow_mut() = outer);
    painted
}

/// Natural size of what the node shows, given the width it may use (`None`: unconstrained).
/// Measured once per paint (`remembering`).
pub fn content(node: &Node, width: Option<u32>, env: Env, item: Option<&Value>) -> Size {
    let key = (node as *const Node as usize, width, item.map_or(0, |item| item as *const Value as usize));
    if let Some(size) = SIZES.with(|sizes| sizes.borrow().as_ref().and_then(|sizes| sizes.get(&key).copied())) {
        return size;
    }
    let size = measure(node, width, env, item);
    SIZES.with(|sizes| {
        if let Some(sizes) = sizes.borrow_mut().as_mut() {
            sizes.insert(key, size);
        }
    });
    size
}

fn measure(node: &Node, width: Option<u32>, env: Env, item: Option<&Value>) -> Size {
    match node {
        Node::Text { value, max_lines, .. } => {
            let string = super::expr::text(&value.resolve(env.data, item));
            if string.is_empty() {
                return Size::zero();
            }
            let fitted = match width {
                Some(w) => text_font(node, env.theme, &string, w as i32),
                None => text_metrics(node, env.theme),
            };
            let Some((resolved, line)) = fitted else { return Size::zero() };
            let extra = resolved.extra();
            let lines = match width {
                Some(w) => text::spaced_lines(resolved.font, &string, (w as i32 - extra).max(0), usize::from((*max_lines).clamp(1, 8)), resolved.tracking),
                None => vec![text::fit_spaced(resolved.font, &string, MAX_VIEWPORT as i32, resolved.tracking)],
            };
            let widest = lines.iter().map(|l| text::spaced_width(resolved.font, l, resolved.tracking)).max().unwrap_or(0);
            let count = lines.len().max(1) as i32;
            Size::new((widest + extra).max(0) as u32, (count * line - 2).max(0) as u32)
        }
        Node::Button { label, icon, dock, ghost, .. } => {
            if *ghost {
                return Size::zero();
            }
            let font = env.theme.font(super::Font::Body);
            let label = super::expr::text(&label.resolve(env.data, item));
            let height = font.get_font_bounding_box(u8g2_fonts::types::VerticalPosition::Baseline).size.height;
            let icon_width = icon.as_ref().map_or(0, |i| i.width + 6);
            Size::new(
                text::width(font, &label).max(0) as u32 + icon_width + 32 + if *dock { 14 } else { 0 },
                (height + 16).max(icon.as_ref().map_or(0, |i| i.height + 12)),
            )
        }
        Node::Image { source_width, source_height, .. } => Size::new(*source_width, *source_height),
        Node::Group { children, .. } | Node::Panel { children, .. } => match layout_of(node) {
            Some(layout) => flex_content(children, layout, width, env, item),
            None => extent(children, width, env, item),
        },
        Node::When { child, .. } | Node::Modal { child, .. } => {
            if collapsed(node, env, item) {
                Size::zero()
            } else {
                extent(std::slice::from_ref(child.as_ref()), width, env, item)
            }
        }
        Node::Repeat { value, child, gap, .. } => {
            let list = value.resolve(env.data, item);
            let items = list.as_array().map(|a| &a[..a.len().min(32)]).unwrap_or_default();
            let mut size = Size::zero();
            for (i, entry) in items.iter().enumerate() {
                let one = size_in(child, Size::new(width.unwrap_or(MAX_VIEWPORT), MAX_VIEWPORT), env, Some(entry));
                size.width = size.width.max(one.width);
                size.height += one.height + if i > 0 { *gap } else { 0 };
            }
            size
        }
        Node::Router { .. } => node
            .active_route(env.data)
            .map_or(Size::zero(), |route| extent(std::slice::from_ref(route), width, env, item)),
        _ => Size::zero(),
    }
}

/// Bounding size of absolutely placed children (offset plus size). Children sized from their
/// parent (`fill`, percent) follow it rather than define it, like CSS `inset: 0` overlays.
fn extent(children: &[Node], width: Option<u32>, env: Env, item: Option<&Value>) -> Size {
    let room = Size::new(width.unwrap_or(MAX_VIEWPORT), MAX_VIEWPORT);
    let own = |code: u32| matches!(Dim::of(code), Dim::Px(_) | Dim::Hug);
    children.iter().fold(Size::zero(), |size, child| {
        let rect = child.rect();
        let one = size_in(child, room, env, item);
        Size::new(
            if own(rect.width) { size.width.max((rect.x.max(0) as u32).saturating_add(one.width)) } else { size.width },
            if own(rect.height) { size.height.max((rect.y.max(0) as u32).saturating_add(one.height)) } else { size.height },
        )
    })
}

/// Content size of a flex line: children at their natural sizes, gaps and padding.
fn flex_content(children: &[Node], layout: &Layout, width: Option<u32>, env: Env, item: Option<&Value>) -> Size {
    let [top, right, bottom, left] = layout.padding.map(u32::from);
    let inner = width.map(|w| w.saturating_sub(left + right));
    let mut main = 0u32;
    let mut cross = 0u32;
    let mut count = 0u32;
    let shown: Vec<&Node> = children.iter().filter(|c| !collapsed(c, env, item)).collect();
    // A row of known width: its `fill` children get the room the others leave, as `flex` gives
    // it, and wrap their text to that width (their natural width still counts as the content's).
    let natural: Vec<u32> = if layout.row() {
        shown
            .iter()
            .map(|child| match Dim::of(child.rect().width) {
                Dim::Px(v) => v,
                Dim::Percent(p) => inner.unwrap_or(0) * p / 100,
                Dim::Fill(_) | Dim::Hug => content(child, None, env, item).width,
            })
            .collect()
    } else {
        vec![]
    };
    let weight = |child: &Node| if let Dim::Fill(w) = Dim::of(child.rect().width) { w } else { 0 };
    let weights: u32 = shown.iter().map(|c| weight(c)).sum();
    let room = inner.filter(|_| layout.row() && weights > 0).map(|inner| {
        let others: u32 = shown.iter().zip(&natural).filter(|(c, _)| weight(c) == 0).map(|(_, w)| *w).sum();
        inner.saturating_sub(others + u32::from(layout.gap) * (shown.len() as u32).saturating_sub(1))
    });
    for (index, child) in shown.iter().enumerate() {
        let rect = child.rect();
        let (w, h) = if layout.row() {
            let w = natural[index];
            let wraps_at = match room {
                Some(room) if weight(child) > 0 => room * weight(child) / weights,
                _ => w,
            };
            let h = match Dim::of(rect.height) {
                Dim::Px(v) => v,
                _ => content(child, Some(wraps_at), env, item).height,
            };
            (w, h)
        } else {
            let w = match Dim::of(rect.width) {
                Dim::Px(v) => v,
                Dim::Percent(p) => inner.unwrap_or(0) * p / 100,
                Dim::Fill(_) => inner.unwrap_or_else(|| content(child, None, env, item).width),
                Dim::Hug if layout.align == 3 => inner.unwrap_or_else(|| content(child, None, env, item).width),
                Dim::Hug => content(child, inner, env, item).width,
            };
            let h = match Dim::of(rect.height) {
                Dim::Px(v) => v,
                _ => content(child, Some(w), env, item).height,
            };
            (w, h)
        };
        let (m, c) = if layout.row() { (w, h) } else { (h, w) };
        main += m;
        cross = cross.max(c);
        count += 1;
    }
    main += u32::from(layout.gap) * count.saturating_sub(1);
    if layout.row() {
        Size::new(main + left + right, cross + top + bottom)
    } else {
        Size::new(cross + left + right, main + top + bottom)
    }
}

/// Rectangles of a container's children, in order (zero-sized for collapsed ones).
pub fn place(node: &Node, area: Rectangle, env: Env, item: Option<&Value>) -> Vec<Rectangle> {
    match node {
        Node::Group { children, .. } | Node::Panel { children, .. } => match layout_of(node) {
            Some(layout) => flex(children, layout, area, env, item),
            None => children.iter().map(|c| absolute(c, area, env, item)).collect(),
        },
        _ => vec![],
    }
}

/// One flex line: sizes on both axes, free space to `fill` children or shared out by `justify`,
/// overflow taken back from content-sized children (text then wraps or ellipsizes).
fn flex(children: &[Node], layout: &Layout, area: Rectangle, env: Env, item: Option<&Value>) -> Vec<Rectangle> {
    let inner = layout.inner(area);
    let row = layout.row();
    let (inner_main, inner_cross) = if row { (inner.size.width, inner.size.height) } else { (inner.size.height, inner.size.width) };
    struct Item {
        main: u32,
        cross: u32,
        weight: u32,
        hug_main: bool,
        hug_cross: bool,
        visible: bool,
    }
    let dims = |child: &Node| {
        let rect = child.rect();
        if row { (Dim::of(rect.width), Dim::of(rect.height)) } else { (Dim::of(rect.height), Dim::of(rect.width)) }
    };
    let mut items: Vec<Item> = children
        .iter()
        .map(|child| {
            if collapsed(child, env, item) {
                return Item { main: 0, cross: 0, weight: 0, hug_main: false, hug_cross: false, visible: false };
            }
            let (main_dim, cross_dim) = dims(child);
            let cross = match cross_dim {
                Dim::Px(v) => v,
                Dim::Percent(p) => inner_cross * p / 100,
                Dim::Fill(_) => inner_cross,
                Dim::Hug if layout.align == 3 => inner_cross,
                // Centred text in a centred column takes the column's width and centres its ink
                // there: one rounding instead of two (box in column, then ink in box).
                Dim::Hug if !row && layout.align == 1 && matches!(child, Node::Text { align: Align::Center, .. }) => inner_cross,
                // A column knows its children's width before their height; a row the reverse.
                Dim::Hug if !row => content(child, Some(inner_cross), env, item).width.min(inner_cross),
                Dim::Hug => 0, // after the width is known
            };
            let main = match main_dim {
                Dim::Px(v) => v,
                Dim::Percent(p) => inner_main * p / 100,
                Dim::Fill(_) => 0,
                Dim::Hug if row => content(child, None, env, item).width,
                Dim::Hug => content(child, Some(cross), env, item).height,
            };
            Item {
                main,
                cross,
                weight: if let Dim::Fill(w) = main_dim { w } else { 0 },
                hug_main: main_dim == Dim::Hug,
                hug_cross: cross_dim == Dim::Hug && layout.align != 3,
                visible: true,
            }
        })
        .collect();
    let visible = items.iter().filter(|i| i.visible).count() as u32;
    let gaps = u32::from(layout.gap) * visible.saturating_sub(1);
    let used: u32 = items.iter().map(|i| i.main).sum::<u32>() + gaps;
    let mut free = inner_main as i64 - used as i64;
    let weights: u32 = items.iter().map(|i| i.weight).sum();
    if free > 0 && weights > 0 {
        let mut left = free as u32;
        let last = items.iter().rposition(|i| i.weight > 0);
        for (index, it) in items.iter_mut().enumerate() {
            if it.weight > 0 {
                let share = if Some(index) == last { left } else { free as u32 * it.weight / weights };
                it.main += share;
                left -= share.min(left);
            }
        }
        free = 0;
    } else if free < 0 && row {
        // Overflow in a row: content-sized children give width back in proportion to their size
        // (text wraps or ellipsizes). A column never squeezes its children below their content:
        // what does not fit is clipped at the end, as CSS's `min-height: auto` keeps it.
        let shrinkable: u64 = items.iter().filter(|i| i.hug_main).map(|i| u64::from(i.main)).sum();
        if shrinkable > 0 {
            let excess = (-free) as u64;
            for it in items.iter_mut().filter(|i| i.hug_main) {
                let cut = (excess * u64::from(it.main)).div_ceil(shrinkable) as u32;
                it.main = it.main.saturating_sub(cut);
            }
        }
        free = 0;
    }
    // Rows learn their children's heights once widths are final (text wraps to its width).
    if row {
        for (child, it) in children.iter().zip(items.iter_mut()) {
            if it.visible && it.hug_cross {
                let natural = content(child, Some(it.main), env, item).height;
                // One line keeps its full box: centring lets its slack overhang the row.
                let line = line_height(child, env.theme).max(0) as u32;
                it.cross = if line > 0 && natural < line { natural } else { natural.min(inner_cross.max(1)) };
            }
        }
    }
    // A centred column weighs its first child's capitals and its last child's baseline.
    let ends = || {
        let mut shown = children.iter().zip(items.iter()).filter(|(_, it)| it.visible);
        let first = shown.next().map_or((0, 0), |(c, _)| slack(c, env.theme));
        let last = shown.last().map_or(first, |(c, _)| slack(c, env.theme));
        (first.0, last.1)
    };
    let start = if layout.justify == 1 && !row && weights == 0 && free < inner_main as i64 {
        centre(inner_main, (inner_main as i64 - free) as u32, ends())
    } else {
        0
    };
    let free = free.max(0) as u32;
    let (mut cursor, spacing) = match layout.justify {
        1 if row => (free / 2, 0),
        1 => (0, 0),
        2 => (free, 0),
        3 if visible > 1 => (0, free / (visible - 1)),
        4 if visible > 0 => (free / visible / 2, free / visible),
        5 if visible > 0 => (free / (visible + 1), free / (visible + 1)),
        _ => (0, 0),
    };
    children
        .iter()
        .zip(items)
        .map(|(child, it)| {
            let offset = Point::new(child.rect().x, child.rect().y);
            if !it.visible {
                let at = if row { Point::new(start + cursor as i32, 0) } else { Point::new(0, start + cursor as i32) };
                return Rectangle::new(inner.top_left + at, Size::zero());
            }
            let cross_at = match layout.align {
                1 if row => centre(inner_cross, it.cross, slack(child, env.theme)),
                1 => (inner_cross.saturating_sub(it.cross) / 2) as i32,
                2 => inner_cross.saturating_sub(it.cross) as i32,
                _ => 0,
            };
            let main_at = start + cursor as i32;
            let (at, size) = if row {
                (Point::new(main_at, cross_at), Size::new(it.main, it.cross))
            } else {
                (Point::new(cross_at, main_at), Size::new(it.cross, it.main))
            };
            cursor += it.main + u32::from(layout.gap) + spacing;
            Rectangle::new(inner.top_left + at + offset, size)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{Binding, Rect};
    use serde_json::json;
    fn text(value: &str, width: u32) -> Node {
        Node::Text {
            rect: Rect { x: 0, y: 0, width, height: HUG },
            value: Binding::Literal { literal: json!(value) },
            font: super::super::Font::Body,
            align: super::super::Align::Left,
            inverted: false,
            max_lines: 3,
            typography: None,
        }
    }
    fn group(layout: Layout, width: u32, height: u32, children: Vec<Node>) -> Node {
        Node::Group { rect: Rect { x: 0, y: 0, width, height }, children, layout: Some(layout) }
    }
    #[test]
    fn rows_share_free_space_and_columns_stack_wrapped_text() {
        let env = Env { data: &json!({}), theme: Theme::Paper };
        let area = Rectangle::new(Point::zero(), Size::new(400, 100));
        let spacer = |weight| Node::Group { rect: Rect { x: 0, y: 0, width: FILL + weight, height: 10 }, children: vec![], layout: None };
        let row = group(Layout { direction: 1, gap: 10, padding: [0, 20, 0, 20], ..Layout::default() }, 400, 100, vec![spacer(1), text("Ok", HUG), spacer(3)]);
        let placed = place(&row, area, env, None);
        let ok = placed[1];
        // 360 inner, minus the gaps and "Ok": the spacers split the rest 1:3.
        assert_eq!(placed[0].top_left.x, 20);
        assert_eq!(placed[1].top_left.x, 20 + placed[0].size.width as i32 + 10);
        // 1:3, the rounding remainder going to the last one.
        assert!((placed[2].size.width as i32 - 3 * placed[0].size.width as i32).abs() <= 3);
        assert_eq!(placed[2].top_left.x + placed[2].size.width as i32, 380);
        assert!(ok.size.width > 0 && ok.size.height > 0);
        // A column stretches text to its width; long text wraps onto more lines.
        let column = group(Layout { direction: 0, align: 3, gap: 4, ..Layout::default() }, 120, HUG, vec![text("court", HUG), text("un texte bien plus long qui revient à la ligne", HUG)]);
        let placed = place(&column, area, env, None);
        assert_eq!(placed[0].size.width, 400);
        assert!(content(&column, Some(120), env, None).height > placed[0].size.height * 2);
        assert_eq!(placed[1].top_left.y, placed[0].size.height as i32 + 4);
    }
    #[test]
    fn fit_text_takes_a_smaller_size_of_its_family_instead_of_an_ellipsis() {
        let env = Env { data: &json!({}), theme: Theme::Paper };
        let label = |fit| Node::Text {
            rect: Rect { x: 0, y: 0, width: HUG, height: HUG },
            value: Binding::Literal { literal: json!("AUJOURD'HUI") },
            font: super::super::Font::Caption,
            align: super::super::Align::Left,
            inverted: false,
            max_lines: 1,
            typography: Some(super::super::typography::Typography {
                family: super::super::typography::GROTESK,
                size: 14,
                weight: 2,
                italic: false,
                tracking: 2,
                fit,
            }),
        };
        let natural = content(&label(true), None, env, None);
        let narrow = natural.width - 20;
        // Without `fit` the line keeps its size (and ellipsizes when drawn); with it, a smaller
        // size holds every letter in the narrow box.
        let (cut, _) = text_font(&label(false), env.theme, "AUJOURD'HUI", narrow as i32).unwrap();
        let (fitted, line) = text_font(&label(true), env.theme, "AUJOURD'HUI", narrow as i32).unwrap();
        assert!(text::spaced_width(cut.font, "AUJOURD'HUI", 2) > narrow as i32);
        assert!(text::spaced_width(fitted.font, "AUJOURD'HUI", 2) <= narrow as i32);
        assert!(content(&label(true), Some(narrow), env, None).height < natural.height);
        assert!(line < line_height(&label(false), env.theme));
    }
    #[test]
    fn hidden_children_collapse_and_justify_centres_the_rest() {
        let data = json!({"show": false});
        let env = Env { data: &data, theme: Theme::Paper };
        let hidden = Node::When {
            rect: Rect { x: 0, y: 0, width: 50, height: 50 },
            value: Binding::Bound { bind: "show".into(), fallback: json!(false) },
            child: Box::new(text("caché", HUG)),
        };
        let box50 = || Node::Group { rect: Rect { x: 0, y: 0, width: 50, height: 50 }, children: vec![], layout: None };
        let row = group(Layout { direction: 1, justify: 1, gap: 10, ..Layout::default() }, 200, 50, vec![box50(), hidden, box50()]);
        let placed = place(&row, Rectangle::new(Point::zero(), Size::new(200, 50)), env, None);
        // Two visible boxes and one gap: 110 wide, centred in 200.
        assert_eq!(placed[0].top_left.x, 45);
        assert_eq!(placed[1].size, Size::zero());
        assert_eq!(placed[2].top_left.x, 105);
    }
}
