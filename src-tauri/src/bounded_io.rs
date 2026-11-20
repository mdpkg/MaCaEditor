use std::io::{self, Read};
use std::path::Path;

pub(crate) const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
pub(crate) const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const MAX_DOCUMENT_FILES: usize = 10_000;

/// Enforce the limit on bytes actually read, including files that grow after metadata().
pub(crate) fn read_limited(reader: impl Read, limit: u64) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file exceeds the size limit",
        ));
    }
    Ok(bytes)
}

pub(crate) fn read_file(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    if file.metadata()?.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file exceeds the size limit",
        ));
    }
    read_limited(file, limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_stream_at_the_actual_byte_limit() {
        assert_eq!(read_limited(&b"1234"[..], 4).unwrap(), b"1234");
        assert!(read_limited(&b"12345"[..], 4).is_err());
        assert!(read_limited(std::io::repeat(0), 4).is_err());
    }
}
