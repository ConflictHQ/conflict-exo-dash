# Two stages so the 900KB CSV and the build script stay out of the shipped
# image -- the runtime only needs the compiled SQLite file.
FROM python:3.12-slim AS build
WORKDIR /src
COPY data/ ./data/
COPY build_db.py ./
RUN python build_db.py

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY --from=build /src/exoplanets.db ./exoplanets.db
COPY app.py ./
COPY static/ ./static/
RUN useradd --create-home --uid 10001 astro && chown -R astro:astro /app
USER astro
EXPOSE 8080
CMD ["python", "app.py"]
