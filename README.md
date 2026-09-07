# aboutme

Личный сайт: кто я, пет-проекты, ссылки.

Стек (в работе): FastAPI, nginx, Postgres, Docker Compose. Фронт — статика за nginx.

## Локально

Нужен Python 3.12+.

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

Postgres наружу не публикуется. Пароль БД не в compose и не в git: только файл
`secrets/postgres_password` (в образ не копируется, монтируется как Docker secret).

```bash
cp secrets/postgres_password.example secrets/postgres_password
# подставь свой пароль в этот файл, не коммить его
docker compose up --build
```

Проверка: `curl http://localhost:8080/health` → `{"status":"ok","database":"ok"}`.
`docker compose config` не должен печатать пароль.
Остановка: `docker compose down`.
