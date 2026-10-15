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

С Docker Compose те же ручки с префиксом `/api` (nginx проксирует на FastAPI):

```bash
curl http://localhost:8080/
curl http://localhost:8080/api/health
curl http://localhost:8080/api/me
curl http://localhost:8080/api/projects
```

Текст о себе и список проектов лежат в `content/*.json`. Без Postgres api берёт их при каждом старте.
С Postgres это только сид: файлы читаются один раз, когда строки `site_state` ещё нет, дальше api отдаёт то, что в базе.
На живом сайте текст меняется через `PUT /api/me` и `PUT /api/projects` под сессией админа.
Локально, чтобы подхватить правку JSON, проще пересоздать базу: `docker compose -f docker-compose.yml -f docker-compose.local.yml down -v` (удалит данные Postgres) и снова `up`.

## Формат API

Полное описание — в [`docs/api-contract.md`](docs/api-contract.md). Коротко:

- `headline`, `about` и `description` проектов — объект `{"ru": "...", "en": "..."}`. В `PUT` и в `content/*.json` можно писать просто строку, она станет `ru`.
- В `/me` есть `timeline` (до 30 событий, `kind` — `study`, `work` или `project`) и `now_playing` (плеер или `null`). Ссылки на трек и обложку — только `/media/<файл>` или `https://`.
- `/theme` отдаёт две темы, `light` и `dark`, у каждой шесть цветов: `--bg --ink --muted --line --panel --signal`.
- Данные старого формата из Postgres читаются в новом виде, тема старого формата при старте api заменяется на тему по умолчанию.

## Docker Compose

Postgres наружу не публикуется, только docker-сеть.
На VPS nginx слушает 80 и 443 и ждёт сертификат Let's Encrypt.

Локально, без сертификата:

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build nginx api postgres
```

Проверка: `curl http://localhost:8080/api/health` → `{"status":"ok","database":"ok"}`.
В браузере: `http://localhost:8080/` — страница читает `/api/me` и `/api/projects`.
Наружу открыт только nginx. API и Postgres — docker-сеть.
`SESSION_SECRET` в `.env` должен быть длинной случайной строкой, не заглушкой из примера.
Остановка: `docker compose -f docker-compose.yml -f docker-compose.local.yml down`.
