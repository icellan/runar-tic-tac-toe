package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

type SSEHub struct {
	mu      sync.RWMutex
	clients map[string]map[chan []byte]bool // gameID -> set of channels
}

var hub = &SSEHub{
	clients: make(map[string]map[chan []byte]bool),
}

func (h *SSEHub) subscribe(gameID string) chan []byte {
	h.mu.Lock()
	defer h.mu.Unlock()

	ch := make(chan []byte, 16)
	if h.clients[gameID] == nil {
		h.clients[gameID] = make(map[chan []byte]bool)
	}
	h.clients[gameID][ch] = true
	return ch
}

func (h *SSEHub) unsubscribe(gameID string, ch chan []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if subs, ok := h.clients[gameID]; ok {
		delete(subs, ch)
		if len(subs) == 0 {
			delete(h.clients, gameID)
		}
	}
	close(ch)
}

func (h *SSEHub) broadcast(gameID string, data interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	subs, ok := h.clients[gameID]
	if !ok {
		return
	}

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return
	}

	for ch := range subs {
		select {
		case ch <- jsonBytes:
		default:
			// Client is slow, skip
		}
	}
}

func handleSSE(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("id")
	if gameID == "" {
		http.Error(w, "missing game id", 400)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", 500)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := hub.subscribe(gameID)
	defer hub.unsubscribe(gameID, ch)

	// Send initial state from overlay
	g, err := overlayGetGame(gameID)
	if err == nil && g != nil {
		data, _ := json.Marshal(g)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		}
	}
}
