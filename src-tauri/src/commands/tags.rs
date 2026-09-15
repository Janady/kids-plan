use crate::db::AppState;
use chrono::Local;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

const PALETTE: &[&str] = &[
    "#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#fb923c", "#e879f9",
    "#22d3ee",
];

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(sqlx::FromRow)]
struct PlanTagRow {
    plan_id: i64,
    id: i64,
    name: String,
    color: String,
    created_at: String,
    updated_at: String,
}

fn now_str() -> String {
    Local::now().to_rfc3339()
}

fn normalize_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("标签名不能为空".to_string());
    }
    if name.chars().count() > 20 {
        return Err("标签名最多 20 个字".to_string());
    }
    Ok(name.to_string())
}

fn normalize_color(color: Option<&str>) -> Option<String> {
    let c = color?.trim();
    if c.len() == 7
        && c.starts_with('#')
        && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        Some(c.to_ascii_lowercase())
    } else {
        None
    }
}

async fn next_color(db: &SqlitePool) -> String {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tags")
        .fetch_one(db)
        .await
        .unwrap_or(0);
    PALETTE[(count as usize) % PALETTE.len()].to_string()
}

async fn find_duplicate_id(db: &SqlitePool, name: &str, exclude_id: Option<i64>) -> Result<Option<i64>, String> {
    let existing: Option<i64> = if let Some(id) = exclude_id {
        sqlx::query_scalar("SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?")
            .bind(name)
            .bind(id)
            .fetch_optional(db)
            .await
            .map_err(|e| e.to_string())?
    } else {
        sqlx::query_scalar("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
            .bind(name)
            .fetch_optional(db)
            .await
            .map_err(|e| e.to_string())?
    };
    Ok(existing)
}

pub async fn fetch_plan_tags(db: &SqlitePool, plan_id: i64) -> Result<Vec<Tag>, String> {
    sqlx::query_as(
        "SELECT t.id, t.name, t.color, t.created_at, t.updated_at
         FROM plan_tags pt
         JOIN tags t ON t.id = pt.tag_id
         WHERE pt.plan_id = ?
         ORDER BY t.name COLLATE NOCASE",
    )
    .bind(plan_id)
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())
}

pub async fn fetch_all_plan_tags(db: &SqlitePool) -> Result<HashMap<i64, Vec<Tag>>, String> {
    let rows: Vec<PlanTagRow> = sqlx::query_as(
        "SELECT pt.plan_id, t.id, t.name, t.color, t.created_at, t.updated_at
         FROM plan_tags pt
         JOIN tags t ON t.id = pt.tag_id
         ORDER BY t.name COLLATE NOCASE",
    )
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;

    let mut map: HashMap<i64, Vec<Tag>> = HashMap::new();
    for r in rows {
        map.entry(r.plan_id).or_default().push(Tag {
            id: r.id,
            name: r.name,
            color: r.color,
            created_at: r.created_at,
            updated_at: r.updated_at,
        });
    }
    Ok(map)
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    sqlx::query_as(
        "SELECT id, name, color, created_at, updated_at FROM tags ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    let name = normalize_name(&name)?;
    if find_duplicate_id(&state.db, &name, None).await?.is_some() {
        return Err("已有同名标签".to_string());
    }
    let color = normalize_color(color.as_deref()).unwrap_or(next_color(&state.db).await);
    let now = now_str();
    sqlx::query_as(
        "INSERT INTO tags (name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         RETURNING id, name, color, created_at, updated_at",
    )
    .bind(&name)
    .bind(&color)
    .bind(&now)
    .bind(&now)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        let s = e.to_string();
        if s.contains("UNIQUE") {
            "已有同名标签".to_string()
        } else {
            s
        }
    })
}

#[tauri::command]
pub async fn update_tag(
    state: State<'_, AppState>,
    tag_id: i64,
    name: String,
    color: String,
) -> Result<Tag, String> {
    let name = normalize_name(&name)?;
    if find_duplicate_id(&state.db, &name, Some(tag_id)).await?.is_some() {
        return Err("已有同名标签".to_string());
    }
    let color = normalize_color(Some(&color)).unwrap_or_else(|| "#38bdf8".to_string());
    let now = now_str();
    let res = sqlx::query("UPDATE tags SET name = ?, color = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(&color)
        .bind(&now)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            let s = e.to_string();
            if s.contains("UNIQUE") {
                "已有同名标签".to_string()
            } else {
                s
            }
        })?;
    if res.rows_affected() == 0 {
        return Err("标签不存在".to_string());
    }
    sqlx::query_as(
        "SELECT id, name, color, created_at, updated_at FROM tags WHERE id = ?",
    )
    .bind(tag_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, tag_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM plan_tags WHERE tag_id = ?")
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let res = sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    if res.rows_affected() == 0 {
        return Err("标签不存在".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn bind_plan_tag(
    state: State<'_, AppState>,
    plan_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let plan_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM plans WHERE id = ?")
        .bind(plan_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    if plan_exists.is_none() {
        return Err("计划不存在".to_string());
    }
    let tag_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM tags WHERE id = ?")
        .bind(tag_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    if tag_exists.is_none() {
        return Err("标签不存在".to_string());
    }
    sqlx::query("INSERT OR IGNORE INTO plan_tags (plan_id, tag_id) VALUES (?, ?)")
        .bind(plan_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn unbind_plan_tag(
    state: State<'_, AppState>,
    plan_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM plan_tags WHERE plan_id = ? AND tag_id = ?")
        .bind(plan_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
