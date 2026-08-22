# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

ENV PLANT_VIEW_HOST=127.0.0.1 \
    PLANT_VIEW_PORT=8000 \
    INGEST_HOST=0.0.0.0 \
    INGEST_PORT=10000

USER nobody
CMD ["wattloft"]
