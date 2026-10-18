FROM python:3.13.16-slim-trixie@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY content ./content

# Числовой UID однозначен и внутри контейнера, и на хосте.
USER 10001:10001

FROM base AS test
# Root нужен только чтобы поставить dev-зависимости.
USER 0
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY tests ./tests
COPY pytest.ini .
# Тесты идут от того же непривилегированного пользователя, что и прод.
# Кэш pytest выключен: писать в /app этому пользователю нельзя.
USER 10001:10001
RUN pytest -p no:cacheprovider

FROM base
ENV PORT=8080
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--timeout-keep-alive", "30"]
