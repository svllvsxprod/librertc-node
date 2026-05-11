FROM golang:1.26-bookworm AS go-build

WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/librertc-node ./cmd/olcrtc-manager

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates iproute2 iptables \
    && rm -rf /var/lib/apt/lists/*

ARG OLCRTC_BINARY=deploy/docker/bin/olcrtc
COPY --from=go-build /out/librertc-node /usr/local/bin/librertc-node
COPY ${OLCRTC_BINARY} /usr/local/bin/olcrtc
COPY deploy/docker/entrypoint.sh /usr/local/bin/librertc-entrypoint
COPY deploy/docker/config.sample.json /usr/share/librertc/config.sample.json

RUN chmod 0755 /usr/local/bin/librertc-node /usr/local/bin/olcrtc /usr/local/bin/librertc-entrypoint \
    && mkdir -p /etc/librertc /var/lib/librertc /var/log/librertc

ENV OLCRTC_PATH=/usr/local/bin/olcrtc
ENV OLCRTC_MANAGER_ENV_FILE=/etc/librertc/panel.env

EXPOSE 8888
ENTRYPOINT ["/usr/local/bin/librertc-entrypoint"]
CMD ["/usr/local/bin/librertc-node", "-config", "/etc/librertc/config.json", "-addr", "0.0.0.0"]
