// A tiny local HTTP file server for artifact previews. Serving workspace files
// over real http://127.0.0.1 with correct MIME lets the webview use its NATIVE
// viewers (WKWebView and WebView2 both render PDF, images, HTML, media inline) —
// no JS rendering engines, no format conversion. Std-only; GET/HEAD; sandboxed
// to the workspace root; loopback-bound so nothing off-machine can reach it.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};

use crate::artifact_file::{mime_for, resolve_under};
use crate::runtime::workspace_dir;

#[derive(Default)]
pub struct PreviewState(Mutex<Option<u16>>);

/// Percent-decode a URL path (%XX and '+' are the only forms we accept).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok());
                if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Percent-encode one path segment for a URL.
fn encode_segment(seg: &str) -> String {
    let mut out = String::new();
    for b in seg.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn write_response(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8], head_only: bool) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
}

fn handle(mut stream: TcpStream, root: PathBuf) {
    // Read the full request head (until \r\n\r\n) — it may arrive in several
    // TCP segments. We only serve GET/HEAD; bodies are ignored.
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16 * 1024 {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    if buf.is_empty() {
        return;
    }
    let head = String::from_utf8_lossy(&buf);
    let mut parts = head.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");
    let head_only = method == "HEAD";
    if method != "GET" && method != "HEAD" {
        write_response(&mut stream, "405 Method Not Allowed", "text/plain", b"method not allowed", false);
        return;
    }
    let rel = percent_decode(raw_path.split('?').next().unwrap_or("/").trim_start_matches('/'));
    let full = match resolve_under(&root, &rel) {
        Ok(p) if p.is_file() => p,
        _ => {
            write_response(&mut stream, "404 Not Found", "text/plain", b"not found", head_only);
            return;
        }
    };
    let ext = full.extension().and_then(|s| s.to_str()).unwrap_or("");
    let (mime, _) = mime_for(ext);
    match std::fs::read(&full) {
        Ok(body) => write_response(&mut stream, "200 OK", mime, &body, head_only),
        Err(_) => write_response(&mut stream, "500 Internal Server Error", "text/plain", b"read failed", head_only),
    }
}

/// Serve `root` on a fresh loopback port. Returns the port; runs for the app's lifetime.
pub fn serve_root(root: PathBuf) -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let root = root.clone();
            std::thread::spawn(move || handle(stream, root));
        }
    });
    Ok(port)
}

/// URL a workspace file is previewable at (starts the server on first use).
#[tauri::command]
pub fn preview_url(
    app: AppHandle,
    state: State<'_, PreviewState>,
    path: String,
) -> Result<String, String> {
    let mut guard = state.0.lock().unwrap();
    let port = match *guard {
        Some(p) => p,
        None => {
            let p = serve_root(workspace_dir(&app)?).map_err(|e| e.to_string())?;
            *guard = Some(p);
            p
        }
    };
    let encoded: Vec<String> = path.split('/').map(encode_segment).collect();
    Ok(format!("http://127.0.0.1:{port}/{}", encoded.join("/")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(port: u16, path: &str) -> (String, Vec<u8>) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes())
            .unwrap();
        let mut resp = Vec::new();
        s.read_to_end(&mut resp).unwrap();
        let split = resp.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        (
            String::from_utf8_lossy(&resp[..split]).into_owned(),
            resp[split + 4..].to_vec(),
        )
    }

    #[test]
    fn serves_files_with_mime_and_blocks_traversal() {
        let root = std::env::temp_dir().join(format!("ai4s-preview-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/a.pdf"), b"%PDF-1.4 fake").unwrap();
        std::fs::write(root.join("b.html"), b"<h1>hi</h1>").unwrap();

        let port = serve_root(root.clone()).unwrap();

        let (h, body) = get(port, "/sub/a.pdf");
        assert!(h.starts_with("HTTP/1.1 200"), "{h}");
        assert!(h.contains("Content-Type: application/pdf"), "{h}");
        assert_eq!(body, b"%PDF-1.4 fake");

        let (h, _) = get(port, "/b.html");
        assert!(h.contains("Content-Type: text/html"), "{h}");

        // Traversal out of the root must 404.
        let (h, _) = get(port, "/../../../etc/hosts");
        assert!(h.starts_with("HTTP/1.1 404"), "{h}");
        let (h, _) = get(port, "/%2e%2e/%2e%2e/etc/hosts");
        assert!(h.starts_with("HTTP/1.1 404"), "{h}");

        let (h, _) = get(port, "/missing.pdf");
        assert!(h.starts_with("HTTP/1.1 404"), "{h}");

        let _ = std::fs::remove_dir_all(root);
    }
}
