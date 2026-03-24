package hub

import (
	"context"
	"testing"
	"time"
)

func TestHubRegistration(t *testing.T) {
	h := NewResonanceHub(Config{
		MaxClients:    10,
		BroadcastBuf:  10,
		ClientSendBuf: 10,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.Run(ctx)

	client := &Client{
		ID:     "test-client",
		Topics: map[string]bool{"phase": true},
		Send:   make(chan []byte, 10),
	}

	err := h.RegisterClient(client)
	if err != nil {
		t.Fatalf("Failed to register client: %v", err)
	}

	// Give hub some time to process registration
	time.Sleep(10 * time.Millisecond)

	if h.ClientCount() != 1 {
		t.Errorf("Expected 1 client, got %d", h.ClientCount())
	}
}
