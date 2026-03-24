// internal/hub/hub.go
package hub

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"
)

var (
	ErrBroadcastTimeout   = errors.New("broadcast timeout")
	ErrRegistrationTimeout = errors.New("registration timeout")
)

type Config struct {
	MaxClients     int
	BroadcastBuf   int
	ClientSendBuf  int
	MetricsEnabled bool
}

type ResonanceHub struct {
	config Config

	// Registro de clientes por tópico
	clients    map[*Client]bool
	clientsMu  sync.RWMutex

	// Índice de tópicos para broadcast eficiente
	topics     map[string]map[*Client]bool
	topicsMu   sync.RWMutex

	// Canais de controle
	register   chan *Client
	unregister chan *Client
	broadcast  chan Message

	// Shutdown
	ctx    context.Context
	cancel context.CancelFunc
}

type Message struct {
	Topic   string
	Payload []byte
	// Filtro de coerência: só enviar para clientes com Ω' >= MinCoherence
	MinCoherence float64
}

type Client struct {
	ID         string
	EnclaveKey []byte
	Coherence  float64
	Topics     map[string]bool
	Send       chan []byte
	Hub        *ResonanceHub
	Conn       interface{} // *websocket.Conn, abstraído para testes

	// Controle de fluxo
	lastActivity time.Time
	mu           sync.Mutex
}

func NewResonanceHub(cfg Config) *ResonanceHub {
	ctx, cancel := context.WithCancel(context.Background())
	return &ResonanceHub{
		config:     cfg,
		clients:    make(map[*Client]bool),
		topics:     make(map[string]map[*Client]bool),
		register:   make(chan *Client, 100),
		unregister: make(chan *Client, 100),
		broadcast:  make(chan Message, cfg.BroadcastBuf),
		ctx:        ctx,
		cancel:     cancel,
	}
}

func (h *ResonanceHub) Run(ctx context.Context) {
	log.Printf("[Hub] Iniciado com capacidade para %d clientes", h.config.MaxClients)

	ticker := time.NewTicker(30 * time.Second) // Cleanup periódico
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			h.gracefulShutdown()
			return

		case client := <-h.register:
			h.handleRegister(client)

		case client := <-h.unregister:
			h.handleUnregister(client)

		case msg := <-h.broadcast:
			h.handleBroadcast(msg)

		case <-ticker.C:
			h.cleanupStaleClients()
		}
	}
}

func (h *ResonanceHub) handleRegister(c *Client) {
	h.clientsMu.Lock()
	if len(h.clients) >= h.config.MaxClients {
		h.clientsMu.Unlock()
		log.Printf("[Hub] Capacidade máxima atingida, rejeitando cliente %s", c.ID)
		close(c.Send)
		return
	}

	h.clients[c] = true
	h.clientsMu.Unlock()

	// Indexar por tópicos
	h.topicsMu.Lock()
	for topic := range c.Topics {
		if h.topics[topic] == nil {
			h.topics[topic] = make(map[*Client]bool)
		}
		h.topics[topic][c] = true
	}
	h.topicsMu.Unlock()

	log.Printf("[Hub] Cliente %s registrado (coh=%.4f, topics=%v) | Total: %d",
		c.ID, c.Coherence, c.Topics, len(h.clients))
}

func (h *ResonanceHub) handleUnregister(c *Client) {
	h.clientsMu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.Send)
	}
	h.clientsMu.Unlock()

	// Remover de todos os tópicos
	h.topicsMu.Lock()
	for topic := range c.Topics {
		if clients, ok := h.topics[topic]; ok {
			delete(clients, c)
			if len(clients) == 0 {
				delete(h.topics, topic)
			}
		}
	}
	h.topicsMu.Unlock()

	log.Printf("[Hub] Cliente %s desregistrado | Total: %d", c.ID, len(h.clients))
}

func (h *ResonanceHub) handleBroadcast(msg Message) {
	h.topicsMu.RLock()
	clients, ok := h.topics[msg.Topic]
	if !ok {
		h.topicsMu.RUnlock()
		return
	}

	// Snapshot para evitar lock durante envio
	targets := make([]*Client, 0, len(clients))
	for c := range clients {
		if c.Coherence >= msg.MinCoherence {
			targets = append(targets, c)
		}
	}
	h.topicsMu.RUnlock()

	// Enviar de forma não-bloqueante
	sent := 0
	for _, c := range targets {
		select {
		case c.Send <- msg.Payload:
			sent++
		default:
			// Cliente lento, marcar para remoção
			go h.unregisterSlowClient(c)
		}
	}
}

func (h *ResonanceHub) unregisterSlowClient(c *Client) {
	c.mu.Lock()
	c.lastActivity = time.Now().Add(-time.Hour) // Marcar como stale
	c.mu.Unlock()
	h.unregister <- c
}

func (h *ResonanceHub) cleanupStaleClients() {
	threshold := time.Now().Add(-5 * time.Minute)

	h.clientsMu.Lock()
	for c := range h.clients {
		c.mu.Lock()
		if c.lastActivity.Before(threshold) {
			c.mu.Unlock()
			h.clientsMu.Unlock()
			h.unregister <- c
			h.clientsMu.Lock()
			continue
		}
		c.mu.Unlock()
	}
	h.clientsMu.Unlock()
}

func (h *ResonanceHub) ClientCount() int {
	h.clientsMu.RLock()
	defer h.clientsMu.RUnlock()
	return len(h.clients)
}

func (h *ResonanceHub) gracefulShutdown() {
	log.Println("[Hub] Iniciando shutdown gracioso...")

	h.clientsMu.Lock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.clientsMu.Unlock()

	// Notificar todos os clientes
	shutdownMsg := map[string]interface{}{
		"type":    "SERVER_SHUTDOWN",
		"message": "Arkhe WebSocket server shutting down",
	}
	payload, _ := json.Marshal(shutdownMsg)

	for _, c := range clients {
		select {
		case c.Send <- payload:
		default:
		}
		close(c.Send)
	}

	time.Sleep(1 * time.Second) // Dar tempo para mensagens serem enviadas
	h.cancel()
}

// API pública para handlers de protocolo
func (h *ResonanceHub) Broadcast(topic string, payload interface{}, minCoherence float64) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	select {
	case h.broadcast <- Message{
		Topic:        topic,
		Payload:      data,
		MinCoherence: minCoherence,
	}:
		return nil
	case <-time.After(1 * time.Second):
		return ErrBroadcastTimeout
	}
}

func (h *ResonanceHub) RegisterClient(c *Client) error {
	select {
	case h.register <- c:
		return nil
	case <-time.After(5 * time.Second):
		return ErrRegistrationTimeout
	}
}
