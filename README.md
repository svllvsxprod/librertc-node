<h1 align="center">LibreRTC Node</h1>

<p align="center">
  Серверный node для LibreRTC: веб-панель, подписки для клиентов, генерация room/key, запуск и supervision <code>olcrtc</code> runtime-инстансов, квоты и диагностика. Поддерживает быстрый deploy на чистый VPS через интерактивный setup wizard с Docker и Caddy.
</p>

<p align="center">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white">
  <img alt="Backend" src="https://img.shields.io/badge/Backend-Go-00ADD8?style=for-the-badge&logo=go&logoColor=white">
  <img alt="Frontend" src="https://img.shields.io/badge/UI-React%20%2B%20Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white">
  <img alt="Reverse proxy" src="https://img.shields.io/badge/HTTPS-Caddy-1F88C0?style=for-the-badge">
</p>

<p align="center">
  <a href="#скриншот">Скриншот</a> ·
  <a href="#что-это">Что это</a> ·
  <a href="#быстрый-деплой">Быстрый деплой</a> ·
  <a href="#возможности">Возможности</a> ·
  <a href="#api">API</a> ·
  <a href="#безопасность">Безопасность</a>
</p>

## Скриншот

<p align="center">
  <img src="screens/1.png" width="900" alt="LibreRTC Node admin panel" />
</p>

## Что это

LibreRTC Node управляет серверной частью LibreRTC deployment. Он хранит конфигурацию клиентов, создаёт subscription URL, показывает QR/URI payload, запускает отдельные `olcrtc` процессы для каждой location и следит за их состоянием.

Node нужен там, где хочется развернуть LibreRTC на VPS без ручной сборки runtime, настройки Docker Compose, reverse proxy и временных admin credentials. На первом запуске installer генерирует временный login/password и заставляет сменить их при первом входе.

Основной сценарий:

1. Администратор запускает installer на чистом сервере.
2. Wizard спрашивает режим публикации: домен через Caddy или raw port.
3. Installer ставит зависимости, собирает `olcrtc`, создаёт config и временные credentials.
4. Панель открывается по `/admin`.
5. Администратор создаёт клиентов и выдаёт им subscription URL или `olcrtc://` URI.

## Быстрый деплой

На чистом Ubuntu/Debian сервере:

```sh
curl -fsSL https://raw.githubusercontent.com/svllvsxprod/librertc-node/main/deploy/docker/install.sh | sh
```

Installer запустит интерактивный wizard:

```text
LibreRTC Node setup

Choose how the admin panel should be published:
  1) Domain with Caddy and HTTPS
  2) Raw public port
Mode [1]:
Domain []:
Internal panel port [18888]:
```

Для domain mode укажи домен, например:

```text
Domain []: rtc.example.com
```

После успешного запуска installer выведет:

```text
LibreRTC Node deployed.
URL: https://rtc.example.com/admin
Temporary login: ...
Temporary password: ...
```

Первый вход потребует сменить и login, и password.

Для автоматизации можно передать параметры напрямую:

```sh
curl -fsSL https://raw.githubusercontent.com/svllvsxprod/librertc-node/main/deploy/docker/install.sh | sh -s -- deploy --mode domain --domain rtc.example.com
```

Raw port mode:

```sh
curl -fsSL https://raw.githubusercontent.com/svllvsxprod/librertc-node/main/deploy/docker/install.sh | sh -s -- deploy --mode port --port 18888
```

## Возможности

- Веб-панель администратора на `/admin`.
- Temporary login/password на первом deploy.
- Forced first-login setup со сменой login и password.
- Автоматическая сборка `olcrtc` из `librertc-core`.
- Автоматический Docker Compose deploy.
- Domain mode через Caddy с HTTPS.
- Raw port mode для тестов и закрытых окружений.
- Управление клиентами, квотами и locations.
- Генерация room id через актуальный `olcrtc` runtime.
- Subscription URL и `olcrtc://` URI для клиентов.
- Runtime supervision и restart actions.
- Health, diagnostics, metrics и audit events.

## Как это работает

```text
Admin browser
  -> Caddy HTTPS reverse proxy
  -> LibreRTC Node manager
  -> config.json + panel.env
  -> supervised olcrtc server processes
  -> WebRTC carrier rooms
  -> LibreRTC Client subscriptions
```

В domain mode контейнер слушает только `127.0.0.1:18888`, а Caddy публикует HTTPS-домен. В port mode контейнер слушает публичный host port напрямую.

## Проверка

После deploy:

```sh
docker ps
```

```sh
curl -fsS http://127.0.0.1:18888/api/v1/health
```

Для domain mode:

```sh
systemctl status caddy --no-pager
caddy validate --config /etc/caddy/Caddyfile
curl -fsS https://rtc.example.com/api/v1/health
```

Логи:

```sh
docker logs --tail 100 librertc-node
journalctl -u caddy -n 100 --no-pager
```

## Локальная сборка

Frontend assets:

```sh
pnpm install
pnpm build
```

Manager binary:

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o librertc-node ./cmd/olcrtc-manager
```

Tests:

```sh
go test ./...
```

## Docker

Docker deployment files are in `deploy/docker`.

Useful commands from repo checkout:

```sh
sh deploy/docker/install.sh check
sh deploy/docker/install.sh start
sh deploy/docker/install.sh status
sh deploy/docker/install.sh logs
sh deploy/docker/install.sh health
sh deploy/docker/install.sh stop
```

Default paths on server:

```text
/opt/librertc-node
/opt/librertc-core
/opt/librertc-node/deploy/docker/local/config.json
/opt/librertc-node/deploy/docker/local/panel.env
/etc/caddy/conf.d/librertc-node.caddy
```

## API

Public health endpoint:

```text
GET /api/v1/health
```

Admin API includes:

```text
GET    /api/v1/server/info
GET    /api/v1/diagnostics
POST   /api/v1/reload
GET    /api/v1/clients
POST   /api/v1/clients
GET    /api/v1/clients/{client_id}
PATCH  /api/v1/clients/{client_id}
PUT    /api/v1/clients/{client_id}
DELETE /api/v1/clients/{client_id}
GET    /api/v1/clients/{client_id}/subscription
GET    /api/v1/clients/{client_id}/qr
```

Responses use a stable envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Errors:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

## Конфигурация

Minimal `config.json` shape:

```json
{
  "version": 1,
  "name": "LibreRTC Node",
  "port": 8888,
  "clients": [
    {
      "client-id": "default",
      "quota": {
        "speed_mbps": 0,
        "traffic_gb": 0
      },
      "locations": [
        {
          "name": "Default",
          "endpoint": {
            "room_id": "concrete-room-id",
            "key": "64-hex-character-key"
          },
          "carrier": "wbstream",
          "transport": {
            "type": "datachannel"
          },
          "link": "direct",
          "data": "data",
          "dns": "1.1.1.1:53"
        }
      ]
    }
  ]
}
```

Installer генерирует concrete `room_id` и `key` автоматически. Placeholder values rejected by deployment preflight checks.

## Безопасность

- Live `olcrtc://` URI, room IDs, keys и temporary passwords не должны коммититься.
- `panel.env` создаётся на сервере и не хранится в репозитории.
- First deploy credentials временные и требуют смены при первом входе.
- В domain mode manager bind остаётся на `127.0.0.1`, внешний доступ идёт через Caddy.
- Raw port mode предназначен для тестов, закрытых окружений или ручной firewall настройки.
- Runtime key values в логах manager редактируются как `<redacted>`.

## Структура

```text
cmd/olcrtc-manager/       Go manager, admin API and embedded web UI
src/                      React/Vite admin panel source
cmd/olcrtc-manager/web/   Built frontend assets embedded by Go
deploy/docker/            Docker Compose, installer and core build scripts
docs/                     Plans and operational notes
screens/                  README screenshots
```

## Теги

`librertc` `vpn-server` `webrtc` `go` `react` `vite` `docker` `caddy` `reverse-proxy` `admin-panel` `self-hosted` `olcrtc`

## Лицензия

MIT

## Примечание

Этот репозиторий содержит server node и admin panel. Windows client и core runtime ведутся отдельно в рамках LibreRTC.
