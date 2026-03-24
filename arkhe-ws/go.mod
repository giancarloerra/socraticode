module github.com/arkhe-chain/arkhe-ws

go 1.24.3

replace github.com/arkhe-chain/arkhe-ws/internal/auth => ./internal/auth

replace github.com/arkhe-chain/arkhe-ws/internal/hub => ./internal/hub

replace github.com/arkhe-chain/arkhe-ws/internal/metrics => ./internal/metrics

replace github.com/arkhe-chain/arkhe-ws/internal/protocol => ./internal/protocol

require github.com/gorilla/websocket v1.5.3
