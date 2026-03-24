// internal/protocol/handlers.go
package protocol

import (
	"context"
	"github.com/arkhe-chain/arkhe-ws/internal/hub"
)

type GovConfig struct {
	Hub           *hub.ResonanceHub
	ZKVerifier    interface{}
	ConsensusAddr string
}

type GovHandler struct {
	config GovConfig
}

func NewGovHandler(cfg GovConfig) *GovHandler {
	return &GovHandler{config: cfg}
}

func (g *GovHandler) Start(ctx context.Context) error {
	return nil
}

type TzinorConfig struct {
	Hub           *hub.ResonanceHub
	PhaseOracle   interface{}
	MinCoherence  float64
}

type TzinorHandler struct {
	config TzinorConfig
}

func NewTzinorHandler(cfg TzinorConfig) *TzinorHandler {
	return &TzinorHandler{config: cfg}
}

func (t *TzinorHandler) Start(ctx context.Context) error {
	return nil
}
