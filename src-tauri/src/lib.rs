use std::fmt::Write as _;
use std::fs;
use std::io::{Read, Write};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngCore;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

const UPDATER_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU2NzRFMzM5REE2NTlENzcKUldSM25XWGFPZU4wVnUwZTYyUXNDelZ2KzRaZWF6dWVVa1FnQmI4NGFVeVFJK0tBa0dHZVFLVVQK";

#[cfg(target_os = "macos")]
mod macos_input;

#[tauri::command]
fn save_note(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_note(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_note(path: String) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
async fn google_drive_oauth(client_id: String, client_secret: String, scope: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| format!("Could not start the Google sign-in callback: {error}"))?;
        let port = listener.local_addr().map_err(|error| error.to_string())?.port();
        let redirect_uri = format!("http://127.0.0.1:{port}");
        let mut state_bytes = [0u8; 32];
        let mut verifier_bytes = [0u8; 48];
        rand::rng().fill_bytes(&mut state_bytes);
        rand::rng().fill_bytes(&mut verifier_bytes);
        let state = URL_SAFE_NO_PAD.encode(state_bytes);
        let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut auth_url = reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|error| error.to_string())?;
        auth_url.query_pairs_mut().append_pair("client_id", client_id.trim()).append_pair("redirect_uri", &redirect_uri).append_pair("response_type", "code").append_pair("scope", &format!("openid email profile {scope}")).append_pair("access_type", "offline").append_pair("prompt", "consent").append_pair("state", &state).append_pair("code_challenge", &challenge).append_pair("code_challenge_method", "S256");
        let url = auth_url.to_string();
        #[cfg(target_os = "macos")]
        std::process::Command::new("open").arg(&url).status().map_err(|error| format!("Could not open the system browser: {error}"))?;
        #[cfg(target_os = "windows")]
        std::process::Command::new("cmd").args(["/C", "start", "", &url]).status().map_err(|error| format!("Could not open the system browser: {error}"))?;
        #[cfg(target_os = "linux")]
        std::process::Command::new("xdg-open").arg(&url).status().map_err(|error| format!("Could not open the system browser: {error}"))?;
        let (mut stream, _) = listener.accept().map_err(|error| format!("Google sign-in callback failed: {error}"))?;
        let mut request = [0u8; 8192];
        let size = stream.read(&mut request).map_err(|error| error.to_string())?;
        let request_text = String::from_utf8_lossy(&request[..size]);
        let first_line = request_text.lines().next().unwrap_or("");
        let callback_path = first_line.strip_prefix("GET ").and_then(|line| line.split_whitespace().next()).ok_or_else(|| "Invalid Google sign-in callback.".to_owned())?;
        let callback_url = reqwest::Url::parse(&format!("http://127.0.0.1{callback_path}")).map_err(|error| error.to_string())?;
        let params: std::collections::HashMap<_, _> = callback_url.query_pairs().into_owned().collect();
        let response_body = "<h2>Sign-in complete</h2><p>You can close this window and return to BoSketchObs.</p>";
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", response_body.len(), response_body);
        let _ = stream.write_all(response.as_bytes());
        if params.get("state") != Some(&state) { return Err("Google sign-in state validation failed.".to_owned()); }
        if let Some(error) = params.get("error") { return Err(format!("Google sign-in failed: {error}")); }
        let code = params.get("code").ok_or_else(|| "Google did not return an authorization code.".to_owned())?;
        let token = reqwest::blocking::Client::new().post("https://oauth2.googleapis.com/token").form(&[("client_id", client_id.trim()), ("client_secret", client_secret.trim()), ("code", code), ("code_verifier", verifier.as_str()), ("grant_type", "authorization_code"), ("redirect_uri", redirect_uri.as_str())]).send().map_err(|error| format!("Could not exchange the Google authorization code: {error}"))?;
        let status = token.status();
        let token_body: Value = token.json().map_err(|error| error.to_string())?;
        if !status.is_success() { return Err(token_body.get("error_description").and_then(Value::as_str).unwrap_or("Google token exchange failed.").to_owned()); }
        let access_token = token_body.get("access_token").and_then(Value::as_str).ok_or_else(|| "Google did not return an access token.".to_owned())?;
        let account: Value = reqwest::blocking::Client::new().get("https://www.googleapis.com/oauth2/v3/userinfo").bearer_auth(access_token).send().map_err(|error| error.to_string())?.json().map_err(|error| error.to_string())?;
        Ok(serde_json::json!({ "access_token": access_token, "refresh_token": token_body.get("refresh_token"), "expires_in": token_body.get("expires_in"), "account": account }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn google_drive_refresh(client_id: String, client_secret: String, refresh_token: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let token = reqwest::blocking::Client::new().post("https://oauth2.googleapis.com/token")
            .form(&[("client_id", client_id.trim()), ("client_secret", client_secret.trim()), ("refresh_token", refresh_token.trim()), ("grant_type", "refresh_token")])
            .send().map_err(|error| format!("Could not refresh the Google session: {error}"))?;
        let status = token.status();
        let body: Value = token.json().map_err(|error| error.to_string())?;
        if !status.is_success() { return Err(body.get("error_description").and_then(Value::as_str).unwrap_or("Google session refresh failed.").to_owned()); }
        let access_token = body.get("access_token").and_then(Value::as_str).ok_or_else(|| "Google did not return a refreshed access token.".to_owned())?;
        Ok(serde_json::json!({ "access_token": access_token, "expires_in": body.get("expires_in") }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn ollama_chat(endpoint: String, request: String) -> Result<Value, String> {
    let payload: Value = serde_json::from_str(&request).map_err(|error| format!("Invalid Ollama request: {error}"))?;
    let base = reqwest::Url::parse(endpoint.trim()).map_err(|_| "Enter a complete Ollama URL, for example http://localhost:11434".to_owned())?;
    if !matches!(base.scheme(), "http" | "https") { return Err("The Ollama endpoint must use http:// or https://".to_owned()); }
    let url = format!("{}/api/chat", endpoint.trim().trim_end_matches('/'));
    let client = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(8)).timeout(std::time::Duration::from_secs(180)).build().map_err(|error| error.to_string())?;
    let response = client.post(url).json(&payload).send().await.map_err(|error| format!("Could not reach Ollama at {}: {error}. Make sure Ollama is running and the model is installed.", endpoint.trim()))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() { return Err(format!("Ollama returned {status}: {body}")); }
    serde_json::from_str(&body).map_err(|error| format!("Invalid Ollama response: {error}"))
}

#[tauri::command]
async fn auto_update(app: tauri::AppHandle) -> Result<(), String> {
    let Some(endpoint) = option_env!("BOSKETCHOBS_UPDATE_ENDPOINT") else { return Ok(()) };
    let endpoint = endpoint.parse().map_err(|error| format!("Invalid update endpoint: {error}"))?;
    let updater = app.updater_builder()
        .pubkey(UPDATER_PUBLIC_KEY)
        .endpoints(vec![endpoint]).map_err(|error| error.to_string())?
        .timeout(std::time::Duration::from_secs(20))
        .build().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else { return Ok(()) };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|error| error.to_string())?;
    app.restart();
}

#[tauri::command]
async fn ollama_tags(endpoint: String) -> Result<Value, String> {
    let base = reqwest::Url::parse(endpoint.trim()).map_err(|_| "Enter a complete Ollama URL, for example http://localhost:11434".to_owned())?;
    if !matches!(base.scheme(), "http" | "https") { return Err("The Ollama endpoint must use http:// or https://".to_owned()); }
    let url = format!("{}/api/tags", endpoint.trim().trim_end_matches('/'));
    let client = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(5)).timeout(std::time::Duration::from_secs(12)).build().map_err(|error| error.to_string())?;
    let response = client.get(url).send().await.map_err(|error| format!("Could not reach Ollama at {}: {error}. Start Ollama, then retry.", endpoint.trim()))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() { return Err(format!("Ollama returned {status}: {body}")); }
    let parsed: Value = serde_json::from_str(&body).map_err(|error| format!("Invalid Ollama models response: {error}"))?;
    Ok(parsed.get("models").cloned().unwrap_or_else(|| Value::Array(Vec::new())))
}

#[tauri::command]
async fn search_wikimedia_images(query: String, limit: u8) -> Result<Value, String> {
    let response = reqwest::Client::new().get("https://commons.wikimedia.org/w/api.php")
        .query(&[("action", "query"), ("format", "json"), ("generator", "search"), ("gsrsearch", query.as_str()), ("gsrnamespace", "6"), ("gsrlimit", &limit.clamp(1, 20).to_string()), ("prop", "imageinfo"), ("iiprop", "url|extmetadata"), ("iiurlwidth", "1200")])
        .send().await.map_err(|error| format!("Could not search Wikimedia Commons: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() { return Err(format!("Wikimedia returned {status}: {body}")); }
    let parsed: Value = serde_json::from_str(&body).map_err(|error| format!("Invalid Wikimedia response: {error}"))?;
    let results = parsed.pointer("/query/pages").and_then(Value::as_object).map(|pages| pages.values().filter_map(|page| {
        let info = page.pointer("/imageinfo/0")?;
        let url = info.get("thumburl").or_else(|| info.get("url"))?.as_str()?.to_owned();
        let metadata = info.get("extmetadata");
        let text = |key: &str| metadata.and_then(|value| value.get(key)).and_then(|value| value.get("value")).and_then(Value::as_str).map(|value| value.replace('<', "").replace('>', ""));
        Some(serde_json::json!({ "url": url, "title": page.get("title").and_then(Value::as_str).unwrap_or("Wikimedia image").trim_start_matches("File:").to_owned(), "author": text("Artist"), "license": text("LicenseShortName"), "sourcePage": format!("https://commons.wikimedia.org/wiki/{}", page.get("title").and_then(Value::as_str).unwrap_or("").replace(' ', "_")) }))
    }).collect::<Vec<_>>()).unwrap_or_default();
    Ok(Value::Array(results))
}

#[tauri::command]
async fn download_remote_asset(url: String) -> Result<Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| format!("Invalid image URL: {error}"))?;
    if parsed.scheme() != "https" { return Err("Only HTTPS image sources are allowed.".to_owned()); }
    let response = reqwest::get(parsed).await.map_err(|error| format!("Could not download image: {error}"))?;
    let status = response.status();
    if !status.is_success() { return Err(format!("Image download returned {status}")); }
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_owned();
    if !mime.starts_with("image/") { return Err("The selected Wikimedia result was not an image.".to_owned()); }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 { return Err("Image is larger than the 8 MB limit.".to_owned()); }
    Ok(serde_json::json!({ "data": BASE64.encode(bytes), "mimeType": mime }))
}

fn pdf_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)")
}

fn pdf_color(hex: &str) -> (f64, f64, f64) {
    let value = hex.trim_start_matches('#');
    if value.len() != 6 { return (0.11, 0.13, 0.16); }
    let channel = |offset| u8::from_str_radix(&value[offset..offset + 2], 16).unwrap_or(28) as f64 / 255.0;
    (channel(0), channel(2), channel(4))
}

fn json_number(value: Option<&Value>) -> f64 { value.and_then(Value::as_f64).unwrap_or(0.0) }

/// Creates a compact vector PDF for the current page. Strokes stay sharp at any zoom.
#[tauri::command]
fn export_page_pdf(path: String, page: Value, dark: bool) -> Result<(), String> {
    let (page_width, page_height, margin, scale) = (842.0, 595.0, 36.0, 0.72);
    let background = if dark { (0.07, 0.09, 0.11) } else { (1.0, 1.0, 1.0) };
    let mut content = String::new();
    writeln!(content, "q {} {} {} rg 0 0 {} {} re f Q", background.0, background.1, background.2, page_width, page_height).unwrap();
    if let Some(strokes) = page.get("strokes").and_then(Value::as_array) {
        for stroke in strokes {
            let Some(points) = stroke.get("points").and_then(Value::as_array).filter(|points| !points.is_empty()) else { continue };
            let (r, g, b) = pdf_color(stroke.get("color").and_then(Value::as_str).unwrap_or("#1c2228"));
            let opacity = json_number(stroke.get("opacity"));
            let color = (r * opacity + background.0 * (1.0 - opacity), g * opacity + background.1 * (1.0 - opacity), b * opacity + background.2 * (1.0 - opacity));
            writeln!(content, "q {} {} {} RG {} w 1 J 1 j", color.0, color.1, color.2, (json_number(stroke.get("width")) * scale).max(0.4)).unwrap();
            for (index, point) in points.iter().enumerate() {
                let x = margin + json_number(point.get("x")) * scale;
                let y = page_height - margin - json_number(point.get("y")) * scale;
                writeln!(content, "{} {} {}", x, y, if index == 0 { "m" } else { "l" }).unwrap();
            }
            writeln!(content, "S Q").unwrap();
        }
    }
    let text_color = if dark { (0.96, 0.97, 0.98) } else { (0.11, 0.13, 0.16) };
    if let Some(blocks) = page.get("textBlocks").and_then(Value::as_array) {
        for block in blocks {
            let x = margin + json_number(block.get("x")) * scale;
            let mut y = page_height - margin - json_number(block.get("y")) * scale;
            for line in block.get("text").and_then(Value::as_str).unwrap_or("").lines() {
                writeln!(content, "BT /F1 13 Tf {} {} {} rg 1 0 0 1 {} {} Tm ({}) Tj ET", text_color.0, text_color.1, text_color.2, x, y, pdf_escape(line)).unwrap();
                y -= 20.0;
            }
        }
    }
    let stream = content.into_bytes();
    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    let mut object = |body: Vec<u8>| { offsets.push(pdf.len()); let id = offsets.len(); pdf.extend_from_slice(format!("{} 0 obj\n", id).as_bytes()); pdf.extend_from_slice(&body); pdf.extend_from_slice(b"\nendobj\n"); };
    object(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    object(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec());
    object(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_vec());
    let mut stream_object = format!("<< /Length {} >>\nstream\n", stream.len()).into_bytes(); stream_object.extend_from_slice(&stream); stream_object.extend_from_slice(b"endstream"); object(stream_object);
    object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec());
    let start_xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).as_bytes());
    for offset in offsets { pdf.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes()); }
    pdf.extend_from_slice(format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", start_xref).as_bytes());
    if let Some(parent) = std::path::Path::new(&path).parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    fs::write(path, pdf).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().pubkey(UPDATER_PUBLIC_KEY).build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.show().map_err(|error| error.to_string())?;
                window.set_focus().map_err(|error| error.to_string())?;
            }
            #[cfg(target_os = "macos")]
            macos_input::install(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_note, read_note, remove_note, google_drive_oauth, google_drive_refresh, export_page_pdf, ollama_chat, ollama_tags, auto_update, search_wikimedia_images, download_remote_asset])
        .run(tauri::generate_context!())
        .expect("error while running BoSketchObs");
}

#[cfg(test)]
mod tests {
    use super::{read_note, save_note};

    #[test]
    fn note_round_trip_preserves_contents() {
        let path = std::env::temp_dir().join(format!("marginalia-{}.json", std::process::id()));
        let path_string = path.to_string_lossy().into_owned();
        let contents = r#"{"version":1,"title":"Test note"}"#;

        save_note(path_string.clone(), contents.to_owned()).expect("note should save");
        let loaded = read_note(path_string).expect("note should load");
        assert_eq!(loaded, contents);

        std::fs::remove_file(path).expect("temporary note should be removed");
    }
}
