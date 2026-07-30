use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

// The Android video server has a small, scarce connection budget (see
// video_server.rs). Every re-render of the home page re-fetches a video frame
// over HTTP just to draw a thumbnail, which is what saturates that budget
// after a few in/out navigations. Caching the decoded thumbnail here — behind
// a plain Tauri IPC call, not the HTTP server — means repeat visits stop
// consuming connection slots for videos already seen once.
const MAX_THUMBNAILS: usize = 50;

struct Cache {
    map: HashMap<String, String>,
    order: VecDeque<String>,
}

impl Cache {
    fn new() -> Self {
        Self { map: HashMap::new(), order: VecDeque::new() }
    }

    fn get(&mut self, key: &str) -> Option<String> {
        let value = self.map.get(key).cloned()?;
        self.touch(key);
        Some(value)
    }

    fn touch(&mut self, key: &str) {
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            self.order.remove(pos);
        }
        self.order.push_back(key.to_string());
    }

    fn put(&mut self, key: String, value: String) {
        if self.map.contains_key(&key) {
            self.map.insert(key.clone(), value);
            self.touch(&key);
            return;
        }
        if self.order.len() >= MAX_THUMBNAILS {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.map.insert(key, value);
    }
}

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Cache::new()))
}

#[tauri::command]
pub fn get_cached_thumbnail(path: String) -> Option<String> {
    cache().lock().unwrap().get(&path)
}

#[tauri::command]
pub fn cache_thumbnail(path: String, data_url: String) {
    cache().lock().unwrap().put(path, data_url);
}
