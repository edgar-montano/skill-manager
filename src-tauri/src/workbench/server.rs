use super::*;
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use tower_http::services::{ServeDir, ServeFile};

async fn call(
    State(service): State<SharedService>,
    Path(action): Path<String>,
    headers: HeaderMap,
    Json(input): Json<Value>,
) -> impl IntoResponse {
    if headers.get("x-skill-manager").and_then(|h| h.to_str().ok()) != Some("local") {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Local client header required"})),
        );
    }
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !host.starts_with("127.0.0.1:") && !host.starts_with("localhost:") {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Loopback host required"})),
        );
    }
    if let Some(origin) = headers.get("origin").and_then(|h| h.to_str().ok()) {
        let allowed = [
            format!("http://{host}"),
            "http://localhost:1420".into(),
            "http://127.0.0.1:1420".into(),
        ];
        if !allowed.iter().any(|o| o == origin) {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error":"Origin rejected"})),
            );
        }
    }
    match tokio::task::spawn_blocking(move || {
        service.0.lock().map_err(err)?.dispatch(&action, input)
    })
    .await
    {
        Ok(Ok(value)) => (StatusCode::OK, Json(value)),
        Ok(Err(error)) => (
            if error.starts_with("Conflict:") {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_REQUEST
            },
            Json(json!({"error":error})),
        ),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":error.to_string()})),
        ),
    }
}
pub async fn serve() -> Result<()> {
    let port = std::env::var("SKILL_MANAGER_PORT")
        .unwrap_or_else(|_| "4317".into())
        .parse::<u16>()
        .map_err(err)?;
    let dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    let app = Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"status":"ok"})) }),
        )
        .route("/api/{action}", post(call))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .fallback_service(
            ServeDir::new(&dist).not_found_service(ServeFile::new(dist.join("index.html"))),
        )
        .with_state(SharedService::new()?);
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(err)?;
    println!("Skill Manager: http://127.0.0.1:{port}");
    axum::serve(listener, app).await.map_err(err)
}
