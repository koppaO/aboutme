## 2024-05-18 - [DoS Prevention]
**Vulnerability:** Fastapi `await request.body()` reads the full payload into memory before checking its length, making it vulnerable to unbounded memory consumption DoS if the payload is huge.
**Learning:** `request.body()` in Starlette/FastAPI doesn't stream the body with a limit inherently unless you write stream reading logic or rely on web server limits, but doing custom limits post-read defeats the purpose.
**Prevention:** Use `request.stream()` to accumulate bytes and abort when the threshold is exceeded. Then explicitly set `request._body` so subsequent `.body()` or `.json()` calls function normally.
