//! Declarative hooks. The host executes effects using its own network, clock, storage and input drivers.
mod images;
mod navigation;
mod overlays;
use crate::limits::{MAX_BYTES, MAX_LOCAL_STATE};
use crate::scene::{Action, Scene};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Effect {
    Fetch { id: String, path: String },
    Emit { name: String },
    Beep { tone: crate::scene::BeepTone },
}
pub struct Runtime {
    scene: Scene,
    data: Value,
    due: BTreeMap<String, u64>,
    now_ms: u64,
    toast_deadline: Option<u64>,
}
impl Runtime {
    pub fn new(scene: Scene) -> Result<Self, &'static str> {
        scene.validate()?;
        let data =
            json!({"local": if scene.state.is_object() {scene.state.clone()} else {json!({})} });
        let mut runtime = Self {
            scene,
            data,
            due: BTreeMap::new(),
            now_ms: 0,
            toast_deadline: None,
        };
        runtime.data["$overlay"] = json!({});
        runtime.restore_navigation(&Value::Null);
        Ok(runtime)
    }
    /// Hosts may override the theme without rebuilding the definition.
    pub fn set_theme(&mut self, theme: crate::Theme) {
        if self.scene.state.get("theme").is_some() {
            self.data["local"]["theme"] = Value::String(theme.name().into());
        }
    }
    /// Read-only platform metadata/sensors. App actions cannot mutate this namespace.
    pub fn update_device(&mut self, info: Value) -> bool {
        if !info.is_object()
            || serde_json::to_vec(&info).map_or(true, |bytes| bytes.len() > MAX_LOCAL_STATE)
            || self.data["$device"] == info
        {
            return false;
        }
        self.data["$device"] = info;
        true
    }
    pub fn scene(&self) -> &Scene {
        &self.scene
    }
    pub fn data(&self) -> &Value {
        &self.data
    }
    /// Called on startup, wake, or a host timer; polling pauses naturally when the device sleeps.
    pub fn advance(&mut self, now_ms: u64, on_wake: bool) -> Vec<Effect> {
        self.tick(now_ms);
        self.scene
            .resources
            .iter()
            .filter_map(|r| {
                let ready = self.due.get(&r.id).copied();
                if ready.is_none()
                    || (on_wake && r.on_wake)
                    || (r.refresh_ms > 0 && ready.is_some_and(|at| now_ms >= at))
                {
                    self.due
                        .insert(r.id.clone(), now_ms.saturating_add(r.refresh_ms));
                    Some(Effect::Fetch {
                        id: r.id.clone(),
                        path: r.path.clone(),
                    })
                } else {
                    None
                }
            })
            .collect()
    }
    /// Existing data stays available when a fetch fails. Invalid or oversized updates are ignored.
    pub fn update(&mut self, id: &str, value: Value) -> bool {
        if !self.scene.resources.iter().any(|r| r.id == id)
            || serde_json::to_vec(&value).map_or(true, |v| v.len() > MAX_BYTES)
        {
            return false;
        }
        if self.data.get(id) == Some(&value) {
            return false;
        }
        self.data[id] = value;
        true
    }
    pub fn handle(&mut self, action: &str) -> Vec<Effect> {
        match self.scene.actions.get(action) {
            Some(Action::Toast {
                message,
                duration_ms,
            }) => {
                let (message, duration) = (message.clone(), *duration_ms);
                self.notify(&message, duration, self.now_ms);
                vec![Effect::Beep {
                    tone: crate::scene::BeepTone::Notification,
                }]
            }
            Some(Action::Dialog {
                title,
                message,
                confirm_label,
                cancel_label,
                on_confirm,
            }) => {
                self.data["$overlay"]["dialog"] = json!({"visible":true,"title":title,"message":message,"confirmLabel":confirm_label,"cancelLabel":cancel_label,"onConfirm":on_confirm});
                vec![]
            }
            Some(Action::DialogChoice { confirm }) => {
                let confirm = *confirm;
                self.choose_dialog(confirm)
            }
            Some(Action::SetState { key, value }) => {
                let mut local = self.data["local"].clone();
                local[key] = value.clone();
                if serde_json::to_vec(&local).is_ok_and(|bytes| bytes.len() <= MAX_LOCAL_STATE) {
                    self.data["local"] = local;
                }
                vec![]
            }
            Some(Action::Fetch { resource }) => self
                .scene
                .resources
                .iter()
                .find(|r| &r.id == resource)
                .map(|r| {
                    vec![Effect::Fetch {
                        id: r.id.clone(),
                        path: r.path.clone(),
                    }]
                })
                .unwrap_or_default(),
            Some(Action::Navigate { operation, route }) => {
                let (operation, route) = (*operation, route.clone());
                self.navigate(operation, &route);
                vec![]
            }
            Some(Action::Beep { tone }) => vec![Effect::Beep { tone: *tone }],
            Some(Action::Emit { name }) => vec![Effect::Emit { name: name.clone() }],
            None => vec![],
        }
    }
}

impl Runtime {
    /// Portable API-hook adapter. Hosts provide authenticated HTTP, BLE, serial or local resources.
    /// A failed request leaves its last successful value intact; rendering remains fully local.
    pub fn fetch_with<E>(
        &mut self,
        now_ms: u64,
        on_wake: bool,
        mut fetch: impl FnMut(&str) -> Result<Value, E>,
    ) -> Result<bool, E> {
        let mut changed = self.tick(now_ms);
        let mut first_error = None;
        for effect in self.advance(now_ms, on_wake) {
            if let Effect::Fetch { id, path } = effect {
                match fetch(&path) {
                    Ok(value) => {
                        changed |= self.update(&id, value);
                    }
                    Err(error) => {
                        // Retry on the next host tick; a failed resource never starves its neighbours.
                        self.due.remove(&id);
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                    }
                }
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(changed),
        }
    }
}

impl Runtime {
    /// None means unbound, allowing hosts to support legacy pointer-mapped apps.
    pub fn input(&mut self, name: &str) -> Option<Vec<Effect>> {
        self.scene
            .action_for_input(name, &self.data)
            .map(|action| self.handle(&action))
    }
    pub fn press(&mut self, point: embedded_graphics::geometry::Point) -> Vec<Effect> {
        self.scene
            .action_at_with_data(point, &self.data)
            .map(|action| self.handle(&action))
            .unwrap_or_default()
    }
}

impl Runtime {
    /// Host-managed offline cache; restores only resources declared by this app.
    pub fn restore(&mut self, cache: &Value) {
        let ids: Vec<_> = self
            .scene
            .resources
            .iter()
            .map(|resource| resource.id.clone())
            .collect();
        for id in ids {
            if let Some(value) = cache.get(&id) {
                self.update(&id, value.clone());
            }
        }
        if let Some(cached) = cache.get("local").and_then(Value::as_object) {
            let mut local = self.scene.state.clone();
            for key in self
                .scene
                .state
                .as_object()
                .expect("validated state")
                .keys()
            {
                if let Some(value) = cached.get(key) {
                    local[key] = value.clone();
                }
            }
            if serde_json::to_vec(&local).is_ok_and(|bytes| bytes.len() <= MAX_LOCAL_STATE) {
                self.data["local"] = local;
            }
        }
        self.restore_navigation(cache);
        self.restore_images(cache);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn runtime() -> Runtime {
        let mut scene = Scene::from_bytecode(include_bytes!("../tests/fixtures/app.dui")).unwrap();
        scene.resources = vec![
            crate::scene::Resource {
                id: "first".into(),
                path: "/first".into(),
                refresh_ms: 1000,
                on_wake: false,
            },
            crate::scene::Resource {
                id: "second".into(),
                path: "/second".into(),
                refresh_ms: 1000,
                on_wake: false,
            },
        ];
        Runtime::new(scene).unwrap()
    }
    #[test]
    fn failed_fetch_does_not_starve_other_resources_and_is_retried() {
        let mut app = runtime();
        app.update("first", json!({"cached":true}));
        let mut requested = vec![];
        let result = app.fetch_with(0, false, |path| {
            requested.push(path.to_owned());
            if path == "/first" {
                Err("offline")
            } else {
                Ok(json!({"fresh":true}))
            }
        });
        assert_eq!(result, Err("offline"));
        assert_eq!(requested, vec!["/first", "/second"]);
        assert_eq!(app.data()["first"], json!({"cached":true}));
        assert_eq!(app.data()["second"], json!({"fresh":true}));
        assert_eq!(
            app.advance(100, false),
            vec![Effect::Fetch {
                id: "first".into(),
                path: "/first".into()
            }]
        );
    }
    #[test]
    fn partial_cache_preserves_defaults_and_ignores_unknown_state_and_resources() {
        let mut app = runtime();
        app.restore(&json!({"local":{"notice":"Cached","unknown":true},"outside":{"secret":true}}));
        assert_eq!(app.data()["local"]["notice"], "Cached");
        assert_eq!(app.data()["local"]["theme"], "flipper");
        assert!(app.data()["local"].get("unknown").is_none());
        assert!(app.data().get("outside").is_none());
        let before = app.data()["local"].clone();
        app.restore(&json!({"local":{"notice":"x".repeat(MAX_LOCAL_STATE)}}));
        assert_eq!(app.data()["local"], before);
    }
}
