# syntax=docker/dockerfile:1.6
# Build context = repo root (so we can include ./backend and ./mini_apps in the image)

FROM golang:1.22-alpine AS builder
WORKDIR /src

RUN apk add --no-cache git build-base

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/server ./cmd

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=builder /out/server /app/server
COPY backend/migrations /app/migrations
COPY mini_apps /app/mini_apps

RUN mkdir -p /app/uploads && chown -R app:app /app
USER app

ENV GIN_MODE=release
ENV UPLOAD_DIR=/app/uploads
ENV MINI_APPS_DIR=/app/mini_apps/ecommerce
ENV PORT=8080
EXPOSE 8080

CMD ["/app/server"]
