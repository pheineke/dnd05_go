package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// --- Types & Global State ---

// Figure represents a token on the tabletop.
type Figure struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// Message is the protocol sent over WebSockets.
type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

var (
	// figures holds the current set of tokens.
	figures = make(map[string]Figure)
	// currentMap is the URL to the background map image.
	currentMap = "/static/default_map.jpg"
	// mutex protects shared state.
	stateMutex = sync.Mutex{}
	// hub for broadcasting WebSocket messages.
	hub = newHub()
)

// mapToSlice converts our figure map to a slice.
func mapToSlice(m map[string]Figure) []Figure {
	out := []Figure{}
	for _, f := range m {
		out = append(out, f)
	}
	return out
}

// generateID creates a random hex string.
func generateID() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// broadcastState marshals the current state and broadcasts it.
func broadcastState() {
	stateMutex.Lock()
	defer stateMutex.Unlock()
	state := struct {
		Type       string   `json:"type"`
		Figures    []Figure `json:"figures"`
		CurrentMap string   `json:"currentMap"`
	}{
		Type:       "state_update",
		Figures:    mapToSlice(figures),
		CurrentMap: currentMap,
	}
	data, err := json.Marshal(state)
	if err != nil {
		log.Println("Error marshaling state:", err)
		return
	}
	hub.broadcast <- data
}

// --- WebSocket Hub and Client ---

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
}

func newHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow all origins (adjust for production!)
	CheckOrigin: func(r *http.Request) bool { return true },
}

func serveWs(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	client := &Client{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 256),
	}
	client.hub.register <- client

	// Send current state to new client.
	stateMutex.Lock()
	initState := struct {
		Type       string   `json:"type"`
		Figures    []Figure `json:"figures"`
		CurrentMap string   `json:"currentMap"`
	}{
		Type:       "state_update",
		Figures:    mapToSlice(figures),
		CurrentMap: currentMap,
	}
	stateMutex.Unlock()
	if data, err := json.Marshal(initState); err == nil {
		client.send <- data
	}

	go client.writePump()
	client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		// Process message and update state.
		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}
		stateMutex.Lock()
		switch msg.Type {
		case "add_figure":
			var fig Figure
			if err := json.Unmarshal(msg.Data, &fig); err == nil {
				if fig.ID == "" {
					fig.ID = generateID()
				}
				figures[fig.ID] = fig
			}
		case "move_figure":
			var fig Figure
			if err := json.Unmarshal(msg.Data, &fig); err == nil {
				if existing, ok := figures[fig.ID]; ok {
					existing.X = fig.X
					existing.Y = fig.Y
					figures[fig.ID] = existing
				}
			}
		case "remove_figure":
			var payload struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(msg.Data, &payload); err == nil {
				delete(figures, payload.ID)
			}
		case "set_map":
			var payload struct {
				Map string `json:"map"`
			}
			if err := json.Unmarshal(msg.Data, &payload); err == nil {
				currentMap = payload.Map
			}
		}
		stateMutex.Unlock()
		broadcastState()
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// Hub closed channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// --- HTTP Handlers ---

// uploadMapHandler handles POST requests with a new map image.
func uploadMapHandler(w http.ResponseWriter, r *http.Request) {
	// Limit upload size to 10 MB.
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Error parsing form", http.StatusBadRequest)
		return
	}
	file, handler, err := r.FormFile("map")
	if err != nil {
		http.Error(w, "Error reading file", http.StatusBadRequest)
		return
	}
	defer file.Close()
	// Ensure the uploads directory exists.
	os.MkdirAll("uploads", os.ModePerm)
	dst, err := os.Create("./uploads/" + handler.Filename)
	if err != nil {
		http.Error(w, "Error saving file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, "Error copying file", http.StatusInternalServerError)
		return
	}
	stateMutex.Lock()
	currentMap = "/uploads/" + handler.Filename
	stateMutex.Unlock()
	broadcastState()
	w.Write([]byte("Map uploaded successfully"))
}

func main() {
	go hub.run()

	// Serve static files.
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	// Serve uploaded maps.
	http.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("uploads"))))

	// WebSocket endpoint.
	http.HandleFunc("/ws", serveWs)
	// Map upload endpoint.
	http.HandleFunc("/upload", uploadMapHandler)
	// Serve the main page.
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "static/index.html")
	})

	log.Println("Server started on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal("ListenAndServe:", err)
	}
}
