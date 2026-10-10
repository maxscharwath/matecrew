use super::Runtime;
use crate::scene::{Navigation, Node};
use serde_json::{json, Value};

const KEY: &str = "$navigation";
const MAX_STACK: usize = 16;

impl Node {
    /// Called only after validating the scene's depth/node budgets.
    pub(crate) fn routers(&self) -> Vec<&Node> {
        let mut found = Vec::new();
        match self {
            Node::Router { routes, .. } => {
                found.push(self);
                for route in routes {
                    found.extend(route.root.routers());
                }
            }
            Node::Group { children, .. }
            | Node::Panel { children, .. }
            | Node::Row { children, .. }
            | Node::Column { children, .. } => {
                for child in children {
                    found.extend(child.routers());
                }
            }
            Node::Modal { child, .. } | Node::When { child, .. } | Node::Repeat { child, .. } => {
                found.extend(child.routers())
            }
            _ => {}
        }
        found
    }
    pub(crate) fn active_route<'a>(&'a self, data: &Value) -> Option<&'a Node> {
        let Node::Router {
            initial, routes, ..
        } = self
        else {
            return None;
        };
        let current = data[KEY]["current"].as_str().unwrap_or(initial);
        routes
            .iter()
            .find(|r| r.name == current)
            .or_else(|| routes.iter().find(|r| &r.name == initial))
            .map(|r| &r.root)
    }
}
impl Runtime {
    fn set_stack(&mut self, stack: Vec<String>) {
        self.data[KEY] = json!({"current":stack.last(), "canGoBack":stack.len() > 1,"stack":stack});
    }
    pub(super) fn restore_navigation(&mut self, cache: &Value) {
        let routers = self.scene.root.routers();
        let Some(Node::Router {
            initial, routes, ..
        }) = routers.first()
        else {
            return;
        };
        let stack = cache[KEY]["stack"]
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= MAX_STACK)
            .and_then(|a| {
                a.iter()
                    .map(|v| {
                        v.as_str()
                            .filter(|name| routes.iter().any(|r| r.name == *name))
                            .map(str::to_owned)
                    })
                    .collect::<Option<Vec<_>>>()
            })
            .unwrap_or_else(|| vec![initial.clone()]);
        self.set_stack(stack);
    }
    pub(super) fn navigate(&mut self, operation: Navigation, route: &str) {
        let mut stack: Vec<String> = self.data[KEY]["stack"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        match operation {
            Navigation::Push if stack.len() < MAX_STACK => stack.push(route.into()),
            Navigation::Replace => {
                stack.pop();
                stack.push(route.into());
            }
            Navigation::Back if stack.len() > 1 => {
                stack.pop();
            }
            Navigation::Reset => stack = vec![route.into()],
            _ => return,
        }
        self.set_stack(stack);
    }
}
