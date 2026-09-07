# aboutme

Личный сайт: кто я, пет-проекты, ссылки.

Стек (в работе): FastAPI, nginx, Postgres, Docker Compose. Фронт — статика за nginx.

## Локально

Python 3.12+.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload --port 8080
```

Проверка:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/me
curl http://localhost:8080/projects
```

Текст о себе и список проектов лежат в `content/*.json`. API читает файлы с диска: правка JSON меняет ответ без пересборки.

## Docker Compose

Postgres наружу не публикуется, только docker-сеть.

```bash
cp .env.example .env
docker compose up --build
```

Проверка: `curl http://localhost:8080/health` → `{"status":"ok","database":"ok"}`.
Остановка: `docker compose down`.
