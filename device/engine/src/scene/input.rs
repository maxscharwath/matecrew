use super::*;
use super::layout;
#[derive(Clone, Copy)]
enum InputQuery<'a> {
    Pointer(Point),
    Hardware(&'a str),
}
impl Scene {
    /// Generic pointer/touch input. Hardware keys map to their hint positions in the host adapter.
    pub fn action_at(&self, point: Point) -> Option<String> {
        self.action_at_with_data(point, &Value::Null)
    }
    pub fn action_at_with_data(&self, point: Point, data: &Value) -> Option<String> {
        self.find_action(InputQuery::Pointer(point), data)
    }
    /// Named physical/keyboard input; only visible, unclipped buttons are eligible.
    pub fn action_for_input(&self, input: &str, data: &Value) -> Option<String> {
        self.find_action(InputQuery::Hardware(input), data)
    }
    fn find_action(&self, query: InputQuery<'_>, data: &Value) -> Option<String> {
        /// `area` is the node's own rectangle from layout; `clip` what its parents leave visible.
        #[allow(clippy::too_many_arguments)]
        fn find(
            node: &Node,
            area: Rectangle,
            query: InputQuery<'_>,
            clip: Rectangle,
            data: &Value,
            item: Option<&Value>,
            env: layout::Env,
            remaining: &mut usize,
        ) -> Option<String> {
            if *remaining == 0 {
                return None;
            }
            *remaining -= 1;
            let visible = area.intersection(&clip);
            if visible.size.width == 0
                || visible.size.height == 0
                || matches!(query, InputQuery::Pointer(point) if !visible.contains(point))
            {
                return None;
            }
            match node {
                Node::Router { .. } => node.active_route(data).and_then(|route| {
                    find(route, layout::absolute(route, area, env, item), query, visible, data, item, env, remaining)
                }),
                Node::Button { action, input, .. } => match query {
                    InputQuery::Pointer(_) => Some(action.clone()),
                    InputQuery::Hardware(name) => {
                        (input.as_deref() == Some(name)).then(|| action.clone())
                    }
                },
                Node::Group { children, .. } | Node::Panel { children, .. } => {
                    // The last match wins: later siblings draw on top.
                    let mut found = None;
                    for (child, placed) in children.iter().zip(layout::place(node, area, env, item)) {
                        if let Some(action) = find(child, placed, query, visible, data, item, env, remaining) {
                            found = Some(action);
                        }
                    }
                    found
                }
                Node::When { value, child, .. } | Node::Modal { value, child, .. } => {
                    if super::expr::truthy(&value.resolve(data, item)) {
                        let placed = layout::absolute(child, area, env, item);
                        let action = find(child, placed, query, visible, data, item, env, remaining);
                        if matches!(node, Node::Modal { .. }) {
                            Some(action.unwrap_or_default())
                        } else {
                            action
                        }
                    } else {
                        None
                    }
                }
                Node::Repeat { value, child, gap, .. } => {
                    let list = value.resolve(data, item);
                    let items = list.as_array()?;
                    let mut y = 0i32;
                    let mut found = None;
                    for entry in items.iter().take(32) {
                        let bounds = Rectangle::new(
                            area.top_left + Point::new(0, y),
                            Size::new(area.size.width, area.size.height.saturating_sub(y.max(0) as u32)),
                        );
                        let placed = layout::absolute(child, bounds, env, Some(entry));
                        if found.is_none() {
                            found = find(child, placed, query, visible, data, Some(entry), env, remaining);
                        }
                        y = y.saturating_add(placed.size.height as i32 + (*gap).min(4096) as i32);
                    }
                    found
                }
                _ => None,
            }
        }
        if self.validate().is_err() {
            return None;
        }
        let env = layout::Env { data, theme: self.theme_for(data) };
        let screen = Rectangle::new(Point::zero(), Size::new(self.width, self.height));
        let area = layout::absolute(&self.root, screen, env, None);
        find(&self.root, area, query, screen, data, None, env, &mut 2048)
    }
}

#[cfg(test)]
mod input_tests {
    use super::*;
    use crate::{Effect, Runtime};
    use serde_json::json;
    #[test]
    fn conditional_and_repeated_buttons_use_the_same_data_and_clips_as_rendering() {
        let scene: Scene = serde_json::from_value(json!({
            "version":1,"width":100,"height":80,"state":{"visible":false},
            "actions":{"select":{"kind":"emit","name":"select"}},
            "root":{"kind":"repeat","rect":{"width":100,"height":80},
                "value":{"literal":[1,2]},"gap":5,
                "child":{"kind":"when","rect":{"width":100,"height":20},
                    "value":{"bind":"local.visible"},
                    "child":{"kind":"button","rect":{"x":10,"width":60,"height":20},
                        "label":{"literal":"Select"},"action":"select"}}}
        }))
        .unwrap();
        let mut runtime = Runtime::new(scene).unwrap();
        assert!(runtime.press(Point::new(20, 30)).is_empty());
        runtime.restore(&json!({"local":{"visible":true}}));
        assert_eq!(
            runtime.press(Point::new(20, 30)),
            vec![Effect::Emit {
                name: "select".into()
            }]
        );
        assert!(runtime.press(Point::new(20, 22)).is_empty()); // gap
        assert!(runtime.press(Point::new(80, 30)).is_empty()); // outside button
        assert!(runtime.press(Point::new(20, 60)).is_empty()); // no third item
    }
}
