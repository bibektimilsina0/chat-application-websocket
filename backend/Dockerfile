FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .
RUN useradd --create-home app && chown -R app /app
USER app

EXPOSE 5000
# Migrate, then serve. ONE worker with many threads: presence lives in this process's memory.
CMD ["sh", "-c", "flask --app run db upgrade && exec gunicorn -k gthread --threads 100 -w 1 -b 0.0.0.0:5000 run:app"]