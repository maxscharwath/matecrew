use super::*;
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
        fn find(
            node: &Node,
            origin: Point,
            query: InputQuery<'_>,
            clip: Rectangle,
            data: &Value,
            item: Option<&Value>,
            remaining: &mut usize,
        ) -> Option<String> {
            if *remaining == 0 {
                return None;
            }
            *remaining -= 1;
            let area = node.rect().area(origin).intersection(&clip);
            if area.size.width == 0
                || area.size.height == 0
                || matches!(query, InputQuery::Pointer(point) if !area.contains(point))
            {
                return None;
            }
            match node {
                Node::Router { .. } => node.active_route(data).and_then(|route| {
                    find(
                        route,
                        node.rect().area(origin).top_left,
                        query,
                        area,
                        data,
                        item,
                        remaining,
                    )
                }),
                Node::Button { action, input, .. } => match query {
                    InputQuery::Pointer(_) => Some(action.clone()),
                    InputQuery::Hardware(name) => {
                        (input.as_deref() == Some(name)).then(|| action.clone())
                    }
                },
                Node::Group { children, .. }
                | Node::Panel { children, .. }
                | Node::Row { children, .. }
                | Node::Column { children, .. } => {
                    let mut offset = node.rect().area(origin).top_left;
                    let mut found = None;
                    for child in children {
                        if let Some(action) =
                            find(child, offset, query, area, data, item, remaining)
                        {
                            found = Some(action);
                        }
                        match node {
                            Node::Row { gap, .. } => {
                                offset.x += child.rect().width as i32 + (*gap).min(4096) as i32
                            }
                            Node::Column { gap, .. } => {
                                offset.y += child.rect().height as i32 + (*gap).min(4096) as i32
                            }
                            _ => {}
                        }
                    }
                    found
                }
                Node::When { value, child, .. } | Node::Modal { value, child, .. } => {
                    if value.resolve(data, item).as_bool().unwrap_or(false) {
                        let action = find(
                            child,
                            node.rect().area(origin).top_left,
                            query,
                            area,
                            data,
                            item,
                            remaining,
                        );
                        if matches!(node, Node::Modal { .. }) {
                            Some(action.unwrap_or_default())
                        } else {
                            action
                        }
                    } else {
                        None
                    }
                }
                Node::Repeat {
                    value, child, gap, ..
                } => {
                    let origin = node.rect().area(origin).top_left;
                    let stride = child.rect().height as i32 + (*gap).min(4096) as i32;
                    value.resolve(data, item).as_array().and_then(|items| {
                        items.iter().take(32).enumerate().find_map(|(i, entry)| {
                            find(
                                child,
                                origin + Point::new(0, i as i32 * stride),
                                query,
                                area,
                                data,
                                Some(entry),
                                remaining,
                            )
                        })
                    })
                }
                _ => None,
            }
        }
        if self.validate().is_err() {
            return None;
        }
        find(
            &self.root,
            Point::zero(),
            query,
            Rectangle::new(Point::zero(), Size::new(self.width, self.height)),
            data,
            None,
            &mut 2048,
        )
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
