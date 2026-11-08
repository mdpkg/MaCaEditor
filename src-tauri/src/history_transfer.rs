use std::sync::Mutex;

use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, State,
};
use uuid::Uuid;

use crate::{commands::history_database, saved_history};

pub const CHUNK_BYTES: usize = 3 * 1024 * 1024;

#[derive(Default)]
pub struct HistoryUpload(Mutex<Option<Upload>>);

struct Upload {
    token: String,
    sizes: Vec<usize>,
    attachments: Vec<Vec<u8>>,
}

impl HistoryUpload {
    pub fn take(&self, token: &str) -> Result<Vec<Vec<u8>>, String> {
        let mut slot = self.0.lock().map_err(|error| error.to_string())?;
        let upload = slot
            .take_if(|upload| upload.token == token)
            .ok_or("edit history upload is no longer available")?;
        if upload.attachments.iter().map(Vec::len).ne(upload.sizes) {
            return Err("edit history upload is incomplete".into());
        }
        Ok(upload.attachments)
    }
}

impl Upload {
    fn append(&mut self, index: usize, offset: usize, bytes: &[u8]) -> Result<(), String> {
        let (Some(target), Some(&size)) = (self.attachments.get_mut(index), self.sizes.get(index))
        else {
            return Err("invalid edit history attachment index".into());
        };
        if offset != target.len()
            || bytes.is_empty()
            || bytes.len() > CHUNK_BYTES
            || offset.checked_add(bytes.len()).is_none_or(|end| end > size)
        {
            return Err("invalid edit history chunk bounds".into());
        }
        if offset == 0 {
            target
                .try_reserve_exact(size)
                .map_err(|error| error.to_string())?;
        }
        target.extend_from_slice(bytes);
        Ok(())
    }
}

#[tauri::command]
pub fn begin_edit_history_upload(
    state: State<'_, HistoryUpload>,
    sizes: Vec<usize>,
) -> Result<String, String> {
    let token = Uuid::new_v4().to_string();
    let attachments = sizes.iter().map(|_| Vec::new()).collect();
    let mut slot = state.0.lock().map_err(|error| error.to_string())?;
    // The editor serializes saves. A fresh upload also releases an abandoned one.
    *slot = Some(Upload {
        token: token.clone(),
        sizes,
        attachments,
    });
    Ok(token)
}

#[tauri::command]
pub fn upload_edit_history_chunk(
    state: State<'_, HistoryUpload>,
    request: Request<'_>,
) -> Result<(), String> {
    let header = |key| {
        request
            .headers()
            .get(key)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| format!("missing edit history header: {key}"))
    };
    let token = header("x-history-upload")?;
    let index: usize = header("x-history-index")?
        .parse()
        .map_err(|_| "invalid edit history index")?;
    let offset: usize = header("x-history-offset")?
        .parse()
        .map_err(|_| "invalid edit history offset")?;
    let fallback;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(serde_json::Value::Array(values)) if values.len() <= CHUNK_BYTES => {
            fallback = values
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .and_then(|byte| u8::try_from(byte).ok())
                        .ok_or("invalid edit history chunk byte")
                })
                .collect::<Result<Vec<_>, _>>()?;
            &fallback
        }
        _ => return Err("invalid edit history chunk body".into()),
    };
    let mut slot = state.0.lock().map_err(|error| error.to_string())?;
    let upload = slot
        .as_mut()
        .filter(|upload| upload.token == token)
        .ok_or("edit history upload is no longer available")?;
    upload.append(index, offset, bytes)
}

#[tauri::command]
pub fn discard_edit_history_upload(
    state: State<'_, HistoryUpload>,
    token: String,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|error| error.to_string())?;
    if slot.as_ref().is_some_and(|upload| upload.token == token) {
        *slot = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn read_edit_history_chunk(
    app: AppHandle,
    id: i64,
    index: i64,
    offset: usize,
) -> Result<Response, String> {
    let database = history_database(&app)?;
    tokio::task::spawn_blocking(move || {
        saved_history::read_chunk(&database, id, index, offset, CHUNK_BYTES)
            .map(Response::new)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_complete_uploads_can_be_consumed() {
        let mut upload = Upload {
            token: "current".into(),
            sizes: vec![3],
            attachments: vec![Vec::new()],
        };
        assert!(upload.append(0, 1, &[2]).is_err());
        assert!(upload.append(0, 0, &[1, 2, 3, 4]).is_err());
        upload.append(0, 0, &[1, 2]).unwrap();
        let state = HistoryUpload(Mutex::new(Some(upload)));
        assert!(state.take("old").is_err());
        assert!(state.take("current").unwrap_err().contains("incomplete"));

        let mut upload = Upload {
            token: "next".into(),
            sizes: vec![3],
            attachments: vec![Vec::new()],
        };
        upload.append(0, 0, &[1, 2]).unwrap();
        upload.append(0, 2, &[3]).unwrap();
        *state.0.lock().unwrap() = Some(upload);
        assert_eq!(state.take("next").unwrap(), [vec![1, 2, 3]]);
        assert!(state.take("next").is_err());
    }
}
