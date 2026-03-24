// internal/protocol/phase_stream.go
package protocol

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"math"
	"time"

	"github.com/arkhe-chain/arkhe-ws/internal/hub"
)

type PhaseOracle interface {
	GetCurrentPhase() Phase
	GetGlobalCoherence() float64
	GetBlockHeight() int64
}

type Phase struct {
	Voyager float64
	Solar   float64
	Lunar   float64
}

type PhaseHandler struct {
	config   PhaseConfig
	ticker   *time.Ticker
	stopCh   chan struct{}
}

type PhaseConfig struct {
	TickRate   time.Duration
	Oracle     PhaseOracle
	Hub        *hub.ResonanceHub
}

func NewPhaseHandler(cfg PhaseConfig) *PhaseHandler {
	return &PhaseHandler{
		config: cfg,
		stopCh: make(chan struct{}),
	}
}

func (p *PhaseHandler) Start(ctx context.Context) error {
	p.ticker = time.NewTicker(p.config.TickRate)
	defer p.ticker.Stop()

	// Buffer de frame reutilizado para reduzir GC
	frameBuf := make([]byte, 47)

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-p.stopCh:
			return nil
		case <-p.ticker.C:
			p.broadcastFrame(frameBuf)
		}
	}
}

func (p *PhaseHandler) broadcastFrame(frameBuf []byte) {
	phase := p.config.Oracle.GetCurrentPhase()
	omega := p.config.Oracle.GetGlobalCoherence()

	// Serializar frame binário diretamente no buffer
	binary.BigEndian.PutUint64(frameBuf[0:8], uint64(time.Now().UnixNano()))
	binary.BigEndian.PutUint64(frameBuf[8:16], math.Float64bits(phase.Voyager))
	binary.BigEndian.PutUint64(frameBuf[16:24], math.Float64bits(phase.Solar))
	binary.BigEndian.PutUint64(frameBuf[24:32], math.Float64bits(phase.Lunar))
	binary.BigEndian.PutUint64(frameBuf[32:40], math.Float64bits(omega))
	binary.BigEndian.PutUint32(frameBuf[40:44], uint32(p.config.Oracle.GetBlockHeight()))
	frameBuf[44] = uint8(p.config.Hub.ClientCount())

	// Criar cópia para broadcast (evitar race)
	payload := make([]byte, 47)
	copy(payload, frameBuf)

	// Enviar para tópico "phase" — todos os inscritos, sem filtro de coerência
	p.config.Hub.Broadcast("phase", &PhaseFrame{
		Binary:    payload,
		Timestamp: time.Now(),
	}, 0.0) // 0.0 = todos podem receber
}

type PhaseFrame struct {
	Binary    []byte    `json:"-"` // Para clientes binários
	Timestamp time.Time `json:"timestamp"`
	// Campos JSON para clientes que preferem texto
	Voyager   float64 `json:"voyager_rad,omitempty"`
	Solar     float64 `json:"solar_attos,omitempty"`
	Lunar     float64 `json:"lunar_rad,omitempty"`
	Omega     float64 `json:"global_omega,omitempty"`
}

// MarshalJSON permite serialização híbrida
func (f *PhaseFrame) MarshalJSON() ([]byte, error) {
	// Se Binary estiver presente, extrair valores para JSON
	if len(f.Binary) >= 40 {
		f.Voyager = math.Float64frombits(binary.BigEndian.Uint64(f.Binary[8:16]))
		f.Solar = math.Float64frombits(binary.BigEndian.Uint64(f.Binary[16:24]))
		f.Lunar = math.Float64frombits(binary.BigEndian.Uint64(f.Binary[24:32]))
		f.Omega = math.Float64frombits(binary.BigEndian.Uint64(f.Binary[32:40]))
	}

	type Alias PhaseFrame
	return json.Marshal((*Alias)(f))
}
