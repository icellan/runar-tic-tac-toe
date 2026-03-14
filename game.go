package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

type Game struct {
	GameID           string `json:"gameId"`
	CurrentTxid      string `json:"currentTxid"`
	CurrentVout      int    `json:"currentVout"`
	ContractSatoshis int64  `json:"contractSatoshis"`
	PlayerX          string `json:"playerX"`
	PlayerO          string `json:"playerO,omitempty"`
	Board            string `json:"board"`
	Turn             int    `json:"turn"`
	Status           int    `json:"status"` // 0=waiting, 1=playing, 2=x_wins, 3=o_wins, 4=tie, 5=cancelled
	BetAmount        int64  `json:"betAmount"`
	LockingScript    string `json:"lockingScript,omitempty"`
	IdentityKeyX     string `json:"identityKeyX,omitempty"`
	IdentityKeyO     string `json:"identityKeyO,omitempty"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

// overlayGame represents the JSON shape returned by the overlay service.
type overlayGame struct {
	Txid          string `json:"txid"`
	OutputIndex   int    `json:"outputIndex"`
	PlayerX       string `json:"playerX"`
	PlayerO       string `json:"playerO"`
	Board         string `json:"board"`
	Turn          int    `json:"turn"`
	Status        int    `json:"status"`
	BetAmount     int64  `json:"betAmount"`
	Satoshis      int64  `json:"satoshis"`
	LockingScript string `json:"lockingScript"`
	IdentityKeyX  string `json:"identityKeyX"`
	IdentityKeyO  string `json:"identityKeyO"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

func (og *overlayGame) toGame() *Game {
	return &Game{
		GameID:           og.Txid,
		CurrentTxid:      og.Txid,
		CurrentVout:      og.OutputIndex,
		ContractSatoshis: og.Satoshis,
		PlayerX:          og.PlayerX,
		PlayerO:          og.PlayerO,
		Board:            og.Board,
		Turn:             og.Turn,
		Status:           og.Status,
		BetAmount:        og.BetAmount,
		LockingScript:    og.LockingScript,
		IdentityKeyX:     og.IdentityKeyX,
		IdentityKeyO:     og.IdentityKeyO,
		CreatedAt:        og.CreatedAt,
		UpdatedAt:        og.UpdatedAt,
	}
}

func getOverlayURL() string {
	u := os.Getenv("OVERLAY_URL")
	if u == "" {
		return "http://localhost:8081"
	}
	return u
}

// overlayListOpenGames fetches open (waiting) games from the overlay REST API.
func overlayListOpenGames() ([]*Game, error) {
	resp, err := http.Get(getOverlayURL() + "/api/games")
	if err != nil {
		return nil, fmt.Errorf("overlay request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("overlay returned status %d", resp.StatusCode)
	}
	var items []overlayGame
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("decode overlay response: %w", err)
	}
	games := make([]*Game, len(items))
	for i := range items {
		games[i] = items[i].toGame()
	}
	return games, nil
}

// overlayGetGame fetches a single game by txid from the overlay REST API.
func overlayGetGame(txid string) (*Game, error) {
	resp, err := http.Get(fmt.Sprintf("%s/api/games/%s", getOverlayURL(), txid))
	if err != nil {
		return nil, fmt.Errorf("overlay request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, nil
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("overlay returned status %d", resp.StatusCode)
	}
	var og overlayGame
	if err := json.NewDecoder(resp.Body).Decode(&og); err != nil {
		return nil, fmt.Errorf("decode overlay response: %w", err)
	}
	return og.toGame(), nil
}

// overlayListPlayerGames fetches all games for a given player public key.
func overlayListPlayerGames(pubkey string) ([]*Game, error) {
	resp, err := http.Get(fmt.Sprintf("%s/api/games/by-player/%s", getOverlayURL(), pubkey))
	if err != nil {
		return nil, fmt.Errorf("overlay request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("overlay returned status %d", resp.StatusCode)
	}
	var items []overlayGame
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("decode overlay response: %w", err)
	}
	games := make([]*Game, len(items))
	for i := range items {
		games[i] = items[i].toGame()
	}
	return games, nil
}

// Board helpers

func boardString(c [9]int) string {
	b := make([]byte, 9)
	for i, v := range c {
		b[i] = byte('0' + v)
	}
	return string(b)
}

func parseBoard(s string) [9]int {
	var b [9]int
	for i := 0; i < 9 && i < len(s); i++ {
		b[i] = int(s[i] - '0')
	}
	return b
}
