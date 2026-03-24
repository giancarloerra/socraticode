package main

import (
	"time"
	"github.com/arkhe-chain/arkhe-ws/internal/auth"
	"github.com/arkhe-chain/arkhe-ws/ws"
)

func StartPhaseInjector(hub *ws.WSHub, oracle *auth.PhaseOracle) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		phase := oracle.GetCurrentPhase()
		omega := oracle.GetGlobalCoherence()

		msg := struct {
			Type string      `json:"type"`
			Data interface{} `json:"data"`
		}{
			Type: "PHASE_UPDATE",
			Data: map[string]interface{}{
				"voyager_rad":        phase.Voyager,
				"global_omega":       omega,
				"locked_validators":  10, // Mocked
				"timestamp":          time.Now().UTC(),
			},
		}
		hub.BroadcastToTopic("phase", msg)
	}
}
