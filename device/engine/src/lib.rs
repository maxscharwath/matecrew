//! Generic, hardware-independent app renderer. Screens, resources and bindings are data, never JavaScript.
pub mod clip;
pub mod frame;
mod limits;
pub mod pixelated;
pub mod runtime;
pub mod scene;
pub mod sprite;
pub mod style;
pub mod theme;
pub use theme::Theme;
pub mod text;
pub use runtime::{Effect, Runtime};
pub use scene::{Node, Scene};
pub mod bytecode;
pub use embedded_graphics::geometry::Point;
pub mod image;
