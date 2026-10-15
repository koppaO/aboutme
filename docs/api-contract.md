# Контракт публичного API

Фронт (`nginx/html`) и api (`app/`) договариваются здесь. Снаружи все пути идут с префиксом `/api` (nginx отрезает его при проксировании). Ответы — JSON, `Cache-Control: no-store`.

## Переводимый текст

Тип `Localized`:

```json
{ "ru": "Студент, собираю пет-проекты", "en": "Student building side projects" }
```

- В ответах api переводимые поля **всегда** приходят объектом с обоими ключами. Если перевода нет, `en` равен `""`.
- На запись (`PUT`) и в `content/*.json` можно прислать просто строку: она сохраняется как `{"ru": "<строка>", "en": ""}`. Лишние ключи отбрасываются.
- Фронт показывает текст на выбранном языке, а если он пустой — `ru`.
- Ограничения длины те же, что у прежних строковых полей, и действуют на каждый язык отдельно.

## `GET /me`

```json
{
  "name": "koppaO",
  "headline": Localized,
  "about": Localized,
  "socials": [{ "name": "GitHub", "url": "https://github.com/koppaO" }],
  "timeline": [
    {
      "start": "2023",
      "end": "2027",
      "title": Localized,
      "place": Localized,
      "kind": "study"
    }
  ],
  "now_playing": {
    "title": "Track",
    "artist": "Artist",
    "src": "/media/track.mp3",
    "cover": "/media/cover.webp"
  }
}
```

| Поле | Правило |
|---|---|
| `name` | Строка, не переводится, обязательна, до 100 символов. |
| `headline` | `Localized`, до 200 символов на язык. |
| `about` | `Localized`, до 5000 символов на язык. |
| `socials` | До 20 ссылок, `url` только `http`/`https`. |
| `timeline` | До 30 элементов, порядок сохраняется. Пустой список, если событий нет. |
| `timeline[].start` | Строка до 20 символов, обязательна (`"2023"`, `"2023-09"`). |
| `timeline[].end` | Строка до 20 символов или `null`. `null` значит «по сей день». |
| `timeline[].title` | `Localized`, до 200 символов на язык, `ru` обязателен. |
| `timeline[].place` | `Localized`, до 200 символов на язык, может быть пустым. |
| `timeline[].kind` | `"study"`, `"work"` или `"project"`. |
| `now_playing` | Объект или `null`, если плеер не нужен. |
| `now_playing.title`, `.artist` | Строки до 200 символов, `title` обязателен. |
| `now_playing.src` | Обязателен. Только свой путь `^/media/[A-Za-z0-9._-]+$` (без `..`, без вложенных папок). Внешние URL не принимаются: CSP `default-src 'self'` их всё равно не загрузит. |
| `now_playing.cover` | То же правило, что у `src`, или `null`. |

## `GET /projects`

```json
{
  "projects": [
    {
      "slug": "aboutme",
      "title": "aboutme",
      "description": Localized,
      "stack": ["FastAPI", "nginx"],
      "links": [{ "name": "GitHub", "url": "https://github.com/koppaO/aboutme" }]
    }
  ]
}
```

Меняется только `description`: теперь это `Localized`, до 2000 символов на язык. Остальное как раньше.

## `GET /theme`

```json
{
  "light": { "colors": { "--bg": "#ffffff", "--ink": "#000000", "--muted": "#5c5c5c", "--line": "#000000", "--panel": "#f5f5f5", "--signal": "#000000" } },
  "dark":  { "colors": { "--bg": "#0f1633", "--ink": "#dfe6ff", "--muted": "#8f9bd0", "--line": "#2a3566", "--panel": "#0a1028", "--signal": "#7cf0c8" } }
}
```

- Ключи цветов ровно эти шесть, значения `#rgb` или `#rrggbb`, в ответе в нижнем регистре.
- Полей `sun`, `grain`, `tree` больше нет.
- `PUT /theme` принимает тот же формат. Обе темы обязательны.

## Совместимость со старыми данными

В Postgres на VPS лежат данные старого формата. Api не падает на них:

- строковые `headline`, `about`, `description` при чтении превращаются в `Localized`;
- если нет `timeline`, отдаётся `[]`; если нет `now_playing`, отдаётся `null`;
- тема старого формата (`colors` + `sun`/`grain`/`tree`) при старте api заменяется на тему по умолчанию.

Фронт со своей стороны принимает и строку, и `Localized`, чтобы работать со старым api до выкладки нового.

## Без изменений

`GET /health`, `POST /login`, `POST /logout`, `GET /session`, `PUT /me`, `PUT /projects`, `POST /users`: пути, права доступа и коды ответов прежние. `PUT /me` и `PUT /projects` проверяют тела по правилам выше.
