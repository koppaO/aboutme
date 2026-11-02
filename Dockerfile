FROM python:3.14.9-slim-trixie@sha256:35caba83af2fe6da9a5d922f9b0156f21d1246a48278c58a08bd253303ba42e8 AS deps

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY content ./content

FROM deps AS test
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY tests ./tests
COPY pyproject.toml .
# Тесты идут от того же непривилегированного пользователя, что и прод.
# Кэш pytest выключен: писать в /app этому пользователю нельзя.
USER 10001:10001
RUN pytest -p no:cacheprovider

# Рабочий образ: последняя стадия, её собирает docker build без --target.
FROM deps AS runtime
# pip нужен только для установки зависимостей. В рабочем образе его нет:
# вместе с ним уходят библиотеки, которые pip носит внутри себя (urllib3,
# msgpack, pkg_resources), — Trivy находил в них CVE. ensurepip тоже не нужен.
RUN pip uninstall --yes pip \
    && python -c "import ensurepip, os, shutil; shutil.rmtree(os.path.dirname(ensurepip.__file__))"
# Числовой UID однозначен и внутри контейнера, и на хосте.
USER 10001:10001
ENV PORT=8080
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--timeout-keep-alive", "30"]
