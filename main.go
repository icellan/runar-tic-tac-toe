package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

//go:embed static
var staticFS embed.FS

func main() {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /api/games", handleListGames)
	mux.HandleFunc("GET /api/games/mine", handleMyGames)
	mux.HandleFunc("GET /api/games/{id}", handleGetGame)
	mux.HandleFunc("POST /api/games/{id}/broadcast", handleBroadcast)
	mux.HandleFunc("GET /api/games/{id}/prepare", handlePrepareSpend)
	mux.HandleFunc("GET /api/games/{id}/events", handleSSE)

	// Static files + SPA fallback
	staticSub, _ := fs.Sub(staticFS, "static")
	fileServer := http.FileServer(http.FS(staticSub))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the exact file first
		if r.URL.Path != "/" {
			// Check if file exists in embedded FS
			path := r.URL.Path[1:] // strip leading /
			if f, err := staticSub.Open(path); err == nil {
				f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// SPA fallback: serve index.html
		data, err := staticFS.ReadFile("static/index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// CORS middleware
	handler := corsMiddleware(mux)

	srv := &http.Server{Addr: ":" + port, Handler: handler}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()

	log.Printf("Tic-Tac-Toe server listening on :%s (overlay: %s)", port, getOverlayURL())
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonResponse(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// GET /api/games - list open public games
func handleListGames(w http.ResponseWriter, r *http.Request) {
	games, err := overlayListOpenGames()
	if err != nil {
		jsonError(w, fmt.Sprintf("list games: %v", err), 500)
		return
	}
	if games == nil {
		games = []*Game{}
	}
	jsonResponse(w, games)
}

// GET /api/games/mine?pubkey=...
func handleMyGames(w http.ResponseWriter, r *http.Request) {
	pubkey := r.URL.Query().Get("pubkey")
	if pubkey == "" {
		jsonError(w, "missing pubkey query parameter", 400)
		return
	}

	games, err := overlayListPlayerGames(pubkey)
	if err != nil {
		jsonError(w, fmt.Sprintf("list games: %v", err), 500)
		return
	}
	if games == nil {
		games = []*Game{}
	}
	jsonResponse(w, games)
}

// GET /api/games/{id}
func handleGetGame(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	g, err := overlayGetGame(id)
	if err != nil {
		jsonError(w, fmt.Sprintf("get game: %v", err), 500)
		return
	}
	if g == nil {
		jsonError(w, "game not found", 404)
		return
	}
	jsonResponse(w, g)
}

// POST /api/games/{id}/broadcast - SSE relay for game state updates
// The frontend submits txs directly to the overlay. This endpoint accepts
// game metadata from the frontend and relays it as an SSE event so that
// the opponent's browser gets a live update.
func handleBroadcast(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req struct {
		Txid   string `json:"txid"`
		Action string `json:"action"` // "create", "join", "move", "moveAndWin", "moveAndTie", "cancelBeforeJoin", "cancel"
		// Game state fields sent by the frontend
		PlayerX          string `json:"playerX,omitempty"`
		PlayerO          string `json:"playerO,omitempty"`
		Board            string `json:"board,omitempty"`
		Turn             int    `json:"turn,omitempty"`
		Status           int    `json:"status"`
		BetAmount        int64  `json:"betAmount,omitempty"`
		ContractSatoshis int64  `json:"contractSatoshis,omitempty"`
		LockingScript    string `json:"lockingScript,omitempty"`
		Vout             int    `json:"vout,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "bad request", 400)
		return
	}

	txid := req.Txid
	if txid == "" {
		jsonError(w, "missing txid", 400)
		return
	}

	// Build a Game object from the provided data to push via SSE
	g := &Game{
		GameID:           id,
		CurrentTxid:      txid,
		CurrentVout:      req.Vout,
		ContractSatoshis: req.ContractSatoshis,
		PlayerX:          req.PlayerX,
		PlayerO:          req.PlayerO,
		Board:            req.Board,
		Turn:             req.Turn,
		Status:           req.Status,
		BetAmount:        req.BetAmount,
		LockingScript:    req.LockingScript,
	}

	// Push SSE event to watchers of this game
	hub.broadcast(id, g)

	jsonResponse(w, map[string]interface{}{
		"txid":   txid,
		"gameId": id,
		"game":   g,
	})
}

// GET /api/games/{id}/prepare - return contract UTXO info for building spending txs
func handlePrepareSpend(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	g, err := overlayGetGame(id)
	if err != nil {
		jsonError(w, fmt.Sprintf("get game: %v", err), 500)
		return
	}
	if g == nil {
		jsonError(w, "game not found", 404)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"contractTxid":     g.CurrentTxid,
		"contractVout":     g.CurrentVout,
		"contractSatoshis": g.ContractSatoshis,
		"lockingScript":    g.LockingScript,
		"betAmount":        g.BetAmount,
		"playerX":          g.PlayerX,
		"playerO":          g.PlayerO,
		"board":            g.Board,
		"turn":             g.Turn,
		"status":           g.Status,
	})
}
