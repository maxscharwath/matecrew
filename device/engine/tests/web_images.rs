use device_engine::{
    image::{decode_png, valid_source, ImageRequest, MAX_DOWNLOAD_BYTES},
    Runtime, Scene,
};
use serde_json::json;

const PNG: &[u8] = include_bytes!("fixtures/colors.png");
fn request(width: u32, height: u32, cover: bool) -> ImageRequest {
    ImageRequest {
        src: "https://cdn.example.com/icon.png?v=1".into(),
        width,
        height,
        cover,
    }
}
fn runtime() -> Runtime {
    let scene: Scene = serde_json::from_value(json!({
        "version":1,"width":200,"height":120,"state":{"url":"https://cdn.example.com/icon.png?v=1"},
        "root":{"kind":"webImage","rect":{"width":2,"height":2},"src":{"bind":"local.url"},"cover":false}
    })).unwrap();
    Runtime::new(scene).unwrap()
}

#[test]
fn png_alpha_fit_and_crop_are_converted_on_device() {
    assert_eq!(decode_png(&request(2, 2, false), PNG).unwrap(), vec![0x90]);
    assert_eq!(decode_png(&request(4, 2, false), PNG).unwrap(), vec![0x42]);
    assert_eq!(decode_png(&request(4, 2, true), PNG).unwrap(), vec![0xc3]);
    for end in 0..PNG.len() {
        assert!(
            decode_png(&request(2, 2, false), &PNG[..end]).is_err(),
            "prefix {end}"
        );
    }
    assert!(decode_png(&request(257, 2, false), PNG).is_err());
    assert!(decode_png(&request(2, 2, false), &vec![0; MAX_DOWNLOAD_BYTES + 1]).is_err());
    assert!(decode_png(&request(2, 2, false), b"<svg></svg>").is_err());
}

#[test]
fn cached_images_survive_offline_restart_and_failed_or_stale_updates() {
    let mut app = runtime();
    let request = app.image_requests().remove(0);
    assert!(app.update_image(&request, PNG).unwrap());
    assert!(app.image_requests().is_empty());
    let saved = app.data().clone();
    assert!(app.update_image(&request, b"bad image").is_err());
    assert_eq!(app.data(), &saved);
    let mut restarted = runtime();
    restarted.restore(&saved);
    assert!(restarted.image_requests().is_empty());
    assert_eq!(restarted.data(), app.data());
    let mut stale = request.clone();
    stale.src = "https://example.com/old.png".into();
    assert!(restarted.update_image(&stale, PNG).is_err());
    let mut invalid = saved.clone();
    invalid["$images"][request.key()] = json!("xx");
    let mut fresh = runtime();
    fresh.restore(&invalid);
    assert_eq!(fresh.image_requests(), vec![request]);
}

#[test]
fn image_urls_cannot_be_protocol_relative_or_embed_credentials() {
    for src in [
        "/assets/logo.png",
        "https://images.example.com/pic.png?v=2",
        "https://localhost:443/image.png",
    ] {
        assert!(valid_source(src), "{src}");
    }
    for src in [
        "//evil.test/x",
        "/\\evil.test/x",
        "http://example.com/x",
        "https://a@b/x",
        "https://a/x#part",
        "https://a/\nx",
        "data:image/png,abc",
        "file:///tmp/x",
        "https://",
    ] {
        assert!(!valid_source(src), "{src}");
    }
}
