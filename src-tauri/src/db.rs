use sqlx::SqlitePool;
use tokio::sync::Mutex;

pub struct AppState {
    pub db: SqlitePool,
    // Serializes record_watch_tick's read-last-tick-then-insert sequence so two
    // ticks arriving close together can't both read the same "last tick" and
    // both decide to insert, which would defeat the gap-based dedup there.
    pub tick_lock: Mutex<()>,
}
