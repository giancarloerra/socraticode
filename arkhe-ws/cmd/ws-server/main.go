// cmd/ws-server/main.go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/arkhe-chain/arkhe-ws/internal/auth"
	"github.com/arkhe-chain/arkhe-ws/internal/hub"
	"github.com/arkhe-chain/arkhe-ws/internal/metrics"
	"github.com/arkhe-chain/arkhe-ws/internal/protocol"
)

type Config struct {
	Addr              string
	TDXEnabled        bool
	MinCoherence      float64
	PhaseTickRate     time.Duration
	MaxConnections    int
	RedisURL          string
	NostrRelay        string
}

func main() {
	// Configuração via environment
	cfg := Config{
		Addr:              ":8080",
		TDXEnabled:        true,
		MinCoherence:      0.85,
		PhaseTickRate:     10 * time.Millisecond,
		MaxConnections:    10000,
		RedisURL:          "redis://localhost:6379",
		NostrRelay:        "wss://relay.arkhe.network",
	}

	// Contexto de shutdown gracioso
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Inicializar componentes
	tdxVerifier := &auth.TDXVerifier{}
	phaseOracle := &auth.PhaseOracle{}

	// Criar ResonanceHub com capacidade configurada
	resonanceHub := hub.NewResonanceHub(hub.Config{
		MaxClients:     cfg.MaxConnections,
		BroadcastBuf:   4096,
		ClientSendBuf:  256,
		MetricsEnabled: true,
	})

	// Inicializar protocol handlers
	phaseHandler := protocol.NewPhaseHandler(protocol.PhaseConfig{
		TickRate:    cfg.PhaseTickRate,
		Oracle:      phaseOracle,
		Hub:         resonanceHub,
	})

	govHandler := protocol.NewGovHandler(protocol.GovConfig{
		Hub:           resonanceHub,
		ZKVerifier:    tdxVerifier,
		ConsensusAddr: "localhost:26657",
	})

	tzinorHandler := protocol.NewTzinorHandler(protocol.TzinorConfig{
		Hub:           resonanceHub,
		PhaseOracle:   phaseOracle,
		MinCoherence:  0.99, // Tzinor requer coerência extrema
	})

	// Criar upgrader Arkhe com todos os handlers
	arkheUpgrader := auth.NewArkheUpgrader(auth.UpgraderConfig{
		TDXVerifier:   tdxVerifier,
		PhaseOracle:   phaseOracle,
		MinCoherence:  cfg.MinCoherence,
		TDXEnabled:    cfg.TDXEnabled,
		Handlers: auth.ProtocolHandlers{
			Phase:  phaseHandler,
			Gov:    govHandler,
			Tzinor: tzinorHandler,
		},
	}, resonanceHub)

	// HTTP router
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", arkheUpgrader.UpgradeHandler)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	mux.Handle("/metrics", metrics.PrometheusHandler())

	// Servidor HTTP com timeouts adequados para WebSocket
	server := &http.Server{
		Addr:         cfg.Addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Iniciar goroutines de background
	go resonanceHub.Run(ctx)
	go phaseHandler.Start(ctx)
	go govHandler.Start(ctx)
	go tzinorHandler.Start(ctx)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		log.Println("🜏 Iniciando shutdown gracioso...")

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Erro no shutdown: %v", err)
		}
		cancel()
	}()

	log.Printf("🜏 Arkhe WebSocket Server iniciado em %s", cfg.Addr)
	log.Printf("   TDX: %v | Min Ω': %.4f | Tick: %v", cfg.TDXEnabled, cfg.MinCoherence, cfg.PhaseTickRate)

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Servidor falhou: %v", err)
	}

	<-ctx.Done()
	log.Println("🜏 Servidor encerrado. Decoherence completa.")
}
