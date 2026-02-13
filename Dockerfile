FROM python:3.12-alpine

WORKDIR /app

COPY . .

EXPOSE 4173

CMD ["python", "-m", "http.server", "4173", "--bind", "0.0.0.0"]
