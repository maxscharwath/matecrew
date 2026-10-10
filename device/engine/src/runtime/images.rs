use super::Runtime;
use crate::image::{self, ImageRequest, CACHE_KEY, MAX_CACHE_BYTES, MAX_IMAGES};
use serde_json::{json, Value};

impl Runtime {
    /// Missing images for the current data. Hosts fetch these after API updates and local actions.
    /// URLs identify immutable assets; change the URL/version query to refresh an image.
    pub fn image_requests(&self) -> Vec<ImageRequest> {
        image::requests(&self.scene, &self.data)
            .into_iter()
            .filter(|r| image::unpack_hex(&self.data[CACHE_KEY][r.key()], r.packed_len()).is_none())
            .collect()
    }

    /// Ignore stale replies after a URL changes. Decode in Rust, shared by hardware and Wasm.
    pub fn update_image(
        &mut self,
        request: &ImageRequest,
        bytes: &[u8],
    ) -> Result<bool, &'static str> {
        if !image::requests(&self.scene, &self.data).contains(request) {
            return Err("image is no longer requested");
        }
        let bits = image::decode_png(request, bytes)?;
        Ok(self.cache_image(request, image::pack_hex(&bits)))
    }

    fn cache_image(&mut self, request: &ImageRequest, packed: String) -> bool {
        let key = request.key();
        if self.data[CACHE_KEY][&key].as_str() == Some(&packed) {
            return false;
        }
        if !self.data[CACHE_KEY].is_object() {
            self.data[CACHE_KEY] = json!({});
        }
        let cache = self.data[CACHE_KEY].as_object_mut().unwrap();
        cache.remove(&key);
        while cache.len() >= MAX_IMAGES
            || cache
                .values()
                .filter_map(Value::as_str)
                .map(str::len)
                .sum::<usize>()
                + packed.len()
                > MAX_CACHE_BYTES * 2
        {
            let Some(oldest) = cache.keys().next().cloned() else {
                break;
            };
            cache.remove(&oldest);
        }
        cache.insert(key, Value::String(packed));
        true
    }

    pub(super) fn restore_images(&mut self, cache: &Value) {
        for request in image::requests(&self.scene, &self.data) {
            let value = &cache[CACHE_KEY][request.key()];
            if image::unpack_hex(value, request.packed_len()).is_some() {
                self.cache_image(&request, value.as_str().unwrap().to_owned());
            }
        }
    }
}
