package main

// In the car there is no server 2, so the Car Thing shows its own copy of the page, kept in sync with the hub's
// by check-carthing.sh. This serves that folder on loopback: GET only, a few file types, no listings.

import (
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

var wwwTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".woff2": "font/woff2",
}

func serveWWW(spec string) {
	addr, dir, ok := strings.Cut(spec, "=")
	if !ok {
		log.Printf("www: want address=folder, got %q", spec)
		return
	}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "GET only", 405)
			return
		}
		p := path.Clean("/" + r.URL.Path)
		if p == "/" {
			p = "/index.html"
		}
		typ, known := wwwTypes[path.Ext(p)]
		if !known {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(filepath.Join(dir, filepath.FromSlash(p)))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil || st.IsDir() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", typ)
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, "", st.ModTime(), f)
	})
	srv := &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("www: %v", srv.ListenAndServe())
}
