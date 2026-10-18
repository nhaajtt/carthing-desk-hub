// phonelink links the Car Thing to one iPhone over Bluetooth Low Energy, with nothing installed on the phone.
// It only uses what every iPhone offers to accessories: ANCS (notifications and incoming calls), AMS (what is
// playing, in any app) and the battery level.
//
// Everything stays on the Car Thing. The screen reads it from http://127.0.0.1:5055 (loopback only, and only
// for the hub's page); nothing is logged or saved except the paired phone's address.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Note struct {
	UID    uint32 `json:"uid"`
	Cat    int    `json:"cat"` // ANCS category: 1 incoming call, 2 missed call, 4 social, 6 email...
	App    string `json:"app"`
	Title  string `json:"title"`
	Sub    string `json:"sub,omitempty"`
	Msg    string `json:"msg,omitempty"`
	At     int64  `json:"at"`
	Date   string `json:"date,omitempty"` // when the phone got it, "yyyyMMddTHHmmSS" in the phone's local time
	Old    bool   `json:"old,omitempty"`  // already on the phone when it connected
	bundle string
}

type Media struct {
	App      string  `json:"app"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album"`
	Duration float64 `json:"duration"` // seconds
	Elapsed  float64 `json:"elapsed"`  // seconds, at the time in At
	Rate     float64 `json:"rate"`
	State    int     `json:"state"` // 0 paused, 1 playing, 2 rewinding, 3 fast-forwarding
	At       int64   `json:"at"`
	Volume   float64 `json:"volume"` // 0..1
	Cmds     []int   `json:"cmds"`   // remote commands the playing app accepts
	Queue    Queue   `json:"queue"`
}

type Queue struct {
	Index   int `json:"index"` // 0-based position in the queue
	Count   int `json:"count"`
	Shuffle int `json:"shuffle"` // 0 off, 1 one, 2 all
	Repeat  int `json:"repeat"`  // 0 off, 1 one, 2 all
}

type Pairing struct {
	Until   int64  `json:"until"`
	Passkey string `json:"passkey,omitempty"`
	Alias   string `json:"alias,omitempty"` // the Car Thing's own Bluetooth name; an iPhone that met it before shows this
}

type State struct {
	Paired    bool     `json:"paired"`
	Connected bool     `json:"connected"`
	Name      string   `json:"name,omitempty"`
	Battery   *int     `json:"battery,omitempty"`
	RSSI      *int     `json:"rssi,omitempty"` // smoothed signal strength of the link, dBm
	Near      bool     `json:"near"`           // the phone is at the desk (see rssi.go)
	Pairing   *Pairing `json:"pairing,omitempty"`
	Media     *Media   `json:"media,omitempty"`
	Call      *Note    `json:"call,omitempty"`
	Notes     []Note   `json:"notes"`
}

var (
	mu    sync.Mutex
	st    = State{Notes: []Note{}}
	subs  = map[chan []byte]bool{}
	dirty = make(chan struct{}, 1)
)

// update changes the state under the lock; the screen gets the new state within 100 ms
func update(f func(*State)) {
	mu.Lock()
	f(&st)
	mu.Unlock()
	select {
	case dirty <- struct{}{}:
	default:
	}
}

func snapshot() []byte {
	mu.Lock()
	defer mu.Unlock()
	b, _ := json.Marshal(st)
	return b
}

func broadcast() {
	for range dirty {
		time.Sleep(100 * time.Millisecond)
		b := snapshot()
		mu.Lock()
		for c := range subs {
			select {
			case c <- b:
			default: // a stuck reader misses one update, never blocks the others
			}
		}
		mu.Unlock()
	}
}

func nowMs() int64 { return time.Now().UnixMilli() }

// ---------------------------------------------------------------- HTTP for the screen

func serve(addr, origin string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "no streaming", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		c := make(chan []byte, 4)
		mu.Lock()
		subs[c] = true
		mu.Unlock()
		defer func() { mu.Lock(); delete(subs, c); mu.Unlock() }()
		fmt.Fprintf(w, "data: %s\n\n", snapshot())
		fl.Flush()
		hb := time.NewTicker(15 * time.Second)
		defer hb.Stop()
		for {
			select {
			case b := <-c:
				fmt.Fprintf(w, "data: %s\n\n", b)
			case <-hb.C:
				io.WriteString(w, ": hb\n\n")
			case <-r.Context().Done():
				return
			}
			fl.Flush()
		}
	})
	post := func(path string, f func(v map[string]any) error) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "POST only", 405)
				return
			}
			v := map[string]any{}
			json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&v)
			if err := f(v); err != nil {
				http.Error(w, err.Error(), 409)
				return
			}
			w.WriteHeader(204)
		})
	}
	post("/pair", func(map[string]any) error { return startPairing() })
	post("/pair/cancel", func(map[string]any) error { closePairing(); return nil })
	post("/forget", func(map[string]any) error { return forgetPhone() })
	post("/media", func(v map[string]any) error {
		n, ok := v["cmd"].(float64)
		if !ok || n < 0 || n > 15 {
			return fmt.Errorf("bad command")
		}
		return mediaCommand(byte(n))
	})
	post("/note/clear", func(v map[string]any) error {
		uid, ok := v["uid"].(float64)
		if !ok {
			return fmt.Errorf("bad uid")
		}
		return clearNote(uint32(uid))
	})
	post("/key", func(v map[string]any) error {
		down, _ := v["down"].(bool)
		switch v["key"] {
		case "siri":
			return sendKey(keySiri, down)
		case "shutter":
			return sendKey(keyVolumeUp, down)
		}
		return fmt.Errorf("bad key")
	})
	post("/call", func(v map[string]any) error {
		switch v["action"] {
		case "answer":
			return callAction(0)
		case "decline":
			return callAction(1)
		}
		return fmt.Errorf("bad action")
	})

	// Only the hub's page may talk to us. Browsers always send Origin on these (cross-origin) requests,
	// so any other page, and anything that is not a browser, is turned away.
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != origin {
			http.Error(w, "forbidden", 403)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(204)
			return
		}
		mux.ServeHTTP(w, r)
	})
	srv := &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

// ---------------------------------------------------------------- start

// one copy only: the kiosk starts us again every time it restarts
func takePidfile(path string) {
	if b, err := os.ReadFile(path); err == nil {
		if pid, _ := strconv.Atoi(strings.TrimSpace(string(b))); pid > 0 && syscall.Kill(pid, 0) == nil {
			os.Exit(0)
		}
	}
	os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0o644)
}

func main() {
	addr := flag.String("listen", "127.0.0.1:5055", "address for the screen")
	origin := flag.String("origin", "http://10.42.1.6:8787", "the hub page allowed to read and control")
	flag.StringVar(&savePath, "state", "/var/lib/hub/phonelink.json", "where the paired phone's address is kept")
	pidfile := flag.String("pidfile", "/run/hub-phone.pid", "")
	flag.IntVar(&nearDBm, "near", -62, "signal strength (dBm) above which the phone counts as at the desk")
	flag.IntVar(&farDBm, "far", -78, "signal strength (dBm) below which the phone counts as away")
	flag.Parse()
	log.SetFlags(log.LstdFlags)
	takePidfile(*pidfile)

	go broadcast()
	go watchSignal()
	go func() {
		for {
			if err := runBluetooth(); err != nil {
				log.Printf("bluetooth: %v; retrying in 10 s", err)
			}
			time.Sleep(10 * time.Second)
		}
	}()
	serve(*addr, *origin)
}
