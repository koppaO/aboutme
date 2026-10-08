## 2024-05-18 - Fast API Stream Exhaustion DOS
**Vulnerability:** Fast API buffering entire request into memory before checking the length when using `request.body()`.
**Learning:** `request.body()` in Fast API buffers the entire body payload into memory. A client can stream an infinitely large payload without `content-length` and cause OOM.
**Prevention:** Instead of using `request.body()`, use `request.stream()` to stream the payload in chunks and check size limits iteratively. Be mindful that `request.stream()` consumes the stream, preventing subsequent calls to `request.json()` or `request.body()`.
