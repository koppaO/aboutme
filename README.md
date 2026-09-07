# aboutme

Личный сайт: кто я, пет-проекты, ссылки.

Стек (в работе): Go API, nginx, Postgres, Docker Compose. Фронт — статика за nginx.

## Локально

Нужен Go 1.22+.

```bash
go test ./...
go run ./cmd/api
```

Проверка: `curl http://localhost:8080/health` → `{"status":"ok"}`.
