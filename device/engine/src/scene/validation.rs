use super::*;
use crate::limits::*;
impl Node {
    pub fn rect(&self) -> Rect {
        match self {
            Self::Router { rect, .. }
            | Self::Modal { rect, .. }
            | Self::Group { rect, .. }
            | Self::Row { rect, .. }
            | Self::Column { rect, .. }
            | Self::Panel { rect, .. }
            | Self::Text { rect, .. }
            | Self::Progress { rect, .. }
            | Self::Chart { rect, .. }
            | Self::Plot { rect, .. }
            | Self::Button { rect, .. }
            | Self::When { rect, .. }
            | Self::Image { rect, .. }
            | Self::CartesianChart { rect, .. }
            | Self::WebImage { rect, .. }
            | Self::Qr { rect, .. }
            | Self::Repeat { rect, .. } => *rect,
        }
    }
    fn valid(&self, depth: usize, nodes: &mut usize) -> bool {
        *nodes += 1;
        let r = self.rect();
        if depth > MAX_DEPTH
            || *nodes > MAX_NODES
            || r.width > MAX_VIEWPORT
            || r.height > MAX_VIEWPORT
            || r.x.unsigned_abs() > MAX_VIEWPORT
            || r.y.unsigned_abs() > MAX_VIEWPORT
        {
            return false;
        }
        if matches!(self,Self::Row {gap,..}|Self::Column {gap,..}|Self::Repeat {gap,..} if *gap>MAX_VIEWPORT)
        {
            return false;
        }
        match self {
            Self::Panel { children, style, .. } => style.as_ref().is_none_or(SurfaceStyle::valid)
                && children.iter().all(|n| n.valid(depth + 1, nodes)),
            Self::Button { icon, .. } => icon.as_ref().is_none_or(|icon| {
                (1..=64).contains(&icon.width)
                    && (1..=64).contains(&icon.height)
                    && icon.bits.len() == (icon.width * icon.height).div_ceil(8) as usize
            }),
            Self::Router {
                initial, routes, ..
            } => {
                let mut names = std::collections::BTreeSet::new();
                (1..=16).contains(&routes.len())
                    && routes.iter().any(|r| &r.name == initial)
                    && routes.iter().all(|r| {
                        valid_identifier(&r.name)
                            && names.insert(&r.name)
                            && r.root.valid(depth + 1, nodes)
                    })
            }
            Self::Group { children, .. }
            | Self::Row { children, .. }
            | Self::Column { children, .. } => children.iter().all(|n| n.valid(depth + 1, nodes)),
            Self::Modal { child, .. } | Self::When { child, .. } | Self::Repeat { child, .. } => {
                child.valid(depth + 1, nodes)
            }
            Self::CartesianChart { series, x_key, .. } => {
                (1..=4).contains(&series.len())
                    && (x_key.is_empty() || valid_identifier(x_key))
                    && series.iter().all(|s| {
                        valid_identifier(&s.data_key)
                            && s.label.len() <= 256
                            && s.style <= 2
                            && s.stroke <= 2
                    })
            }
            Self::WebImage { rect, src, .. } => {
                (1..=crate::image::MAX_SIDE).contains(&rect.width)
                    && (1..=crate::image::MAX_SIDE).contains(&rect.height)
                    && match src {
                        Binding::Literal { literal } => {
                            literal.as_str().is_some_and(crate::image::valid_source)
                        }
                        Binding::Bound { .. } => true,
                    }
            }
            Self::Plot { stroke, .. } => *stroke <= 2,
            Self::Text { max_lines, typography, .. } => (1..=8).contains(max_lines) && typography.as_ref().is_none_or(Typography::valid),
            Self::Image {
                source_width,
                source_height,
                ..
            } => {
                (1..=MAX_VIEWPORT).contains(source_width)
                    && (1..=MAX_VIEWPORT).contains(source_height)
            }
            _ => true,
        }
    }
    fn references_valid(&self, scene: &Scene) -> bool {
        match self {
            Self::Router { routes, .. } => routes.iter().all(|r| r.root.references_valid(scene)),
            Self::Button { action, input, .. } => {
                scene.actions.contains_key(action) && input.as_deref().is_none_or(valid_identifier)
            }
            Self::Group { children, .. }
            | Self::Panel { children, .. }
            | Self::Row { children, .. }
            | Self::Column { children, .. } => children.iter().all(|n| n.references_valid(scene)),
            Self::Modal { child, .. } | Self::When { child, .. } | Self::Repeat { child, .. } => {
                child.references_valid(scene)
            }
            _ => true,
        }
    }
}
impl Scene {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != 1
            || self.width == 0
            || self.height == 0
            || self.width > MAX_VIEWPORT
            || self.height > MAX_VIEWPORT
        {
            return Err("unsupported scene or viewport");
        }
        let mut resources = std::collections::BTreeSet::new();
        if self.resources.len() > MAX_RESOURCES
            || !self.resources.iter().all(|r| {
                valid_identifier(&r.id)
                    && r.id != "local"
                    && resources.insert(&r.id)
                    && valid_api_path(&r.path)
                    && r.refresh_ms <= u32::MAX as u64
            })
        {
            return Err("invalid or duplicate resources");
        }
        let state = self
            .state
            .as_object()
            .ok_or("local state must be an object")?;
        if state.keys().any(|key| !valid_identifier(key))
            || serde_json::to_vec(&self.state).map_or(true, |bytes| bytes.len() > MAX_LOCAL_STATE)
        {
            return Err("invalid or oversized local state");
        }
        if self.actions.len() > MAX_ACTIONS
            || !self.actions.iter().all(|(id, action)| {
                valid_identifier(id)
                    && match action {
                        Action::Toast {
                            message,
                            duration_ms,
                        } => {
                            !message.is_empty()
                                && message.len() <= 256
                                && (1000..=60000).contains(duration_ms)
                        }
                        Action::Dialog {
                            title,
                            message,
                            confirm_label,
                            cancel_label,
                            on_confirm,
                        } => {
                            [title, message, confirm_label, cancel_label]
                                .iter()
                                .all(|s| !s.is_empty() && s.len() <= 256)
                                && self.actions.contains_key(on_confirm)
                        }
                        Action::DialogChoice { .. } => true,
                        Action::Beep { .. } => true,
                        Action::Navigate { .. } => true,
                        Action::SetState { key, .. } => state.contains_key(key),
                        Action::Fetch { resource } => resources.contains(resource),
                        Action::Emit { name } => valid_identifier(name),
                    }
            })
        {
            return Err("invalid action reference");
        }
        // Bound traversal before following any nested action references.
        if !self.root.valid(0, &mut 0) {
            return Err("scene exceeds layout limits");
        }
        let routers = self.root.routers();
        if routers.len() > 1 {
            return Err("nested or multiple routers unsupported");
        }
        for action in self.actions.values() {
            if let Action::Navigate { operation, route } = action {
                let Some(Node::Router { routes, .. }) = routers.first() else {
                    return Err("navigation needs a router");
                };
                if *operation != Navigation::Back && !routes.iter().any(|r| &r.name == route) {
                    return Err("unknown navigation route");
                }
            }
        }
        if !self.root.references_valid(self) {
            return Err("invalid button action");
        }
        Ok(())
    }
}
