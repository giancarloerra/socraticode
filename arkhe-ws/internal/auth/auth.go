package auth

import (
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"

	"github.com/arkhe-chain/arkhe-ws/internal/hub"
	"github.com/arkhe-chain/arkhe-ws/internal/protocol"
	"github.com/gorilla/websocket"
)

type TDXVerifier struct{}

func (v *TDXVerifier) VerifyAttestation(quote []byte, nonce [32]byte) (bool, error) {
	return true, nil
}

type PhaseOracle struct{}

func (o *PhaseOracle) GetCurrentPhase() protocol.Phase {
	return protocol.Phase{Voyager: 3.14159, Solar: 1.0, Lunar: 1.57}
}
func (o *PhaseOracle) GetGlobalCoherence() float64 { return 0.98 }
func (o *PhaseOracle) GetBlockHeight() int64       { return 100 }

type UpgraderConfig struct {
	TDXVerifier  *TDXVerifier
	PhaseOracle  *PhaseOracle
	MinCoherence float64
	TDXEnabled   bool
	Handlers     ProtocolHandlers
}

type ProtocolHandlers struct {
	Phase  interface{}
	Gov    interface{}
	Tzinor interface{}
}

type ArkheUpgrader struct {
	config   UpgraderConfig
	upgrader websocket.Upgrader
	hub      *hub.ResonanceHub
}

func NewArkheUpgrader(cfg UpgraderConfig, resonanceHub *hub.ResonanceHub) *ArkheUpgrader {
	return &ArkheUpgrader{
		config: cfg,
		hub:    resonanceHub,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Production would restrict this
			},
		},
	}
}

func (a *ArkheUpgrader) UpgradeHandler(w http.ResponseWriter, r *http.Request) {
	// 1. Extração de headers/params
	enclaveKeyHex := r.URL.Query().Get("x_arkhe_enclave_key")
	enclaveKey, _ := hex.DecodeString(enclaveKeyHex)

	// 2. Verificação de Coerência (Simplificada)
	currentPhase := a.config.PhaseOracle.GetCurrentPhase()
	fmt.Printf("Handshake: Phase=%v\n", currentPhase)

	// 3. Upgrade
	conn, err := a.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	// 4. Register Client
	client := &hub.Client{
		ID:         enclaveKeyHex,
		EnclaveKey: enclaveKey,
		Coherence:  a.config.PhaseOracle.GetGlobalCoherence(),
		Topics:     make(map[string]bool),
		Send:       make(chan []byte, 256),
		Conn:       conn,
	}

	// Mocking subscription to all topics for now
	client.Topics["phase"] = true
	client.Topics["governance"] = true
	client.Topics["tzinor"] = true

	a.hub.RegisterClient(client)
}

func parseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}
