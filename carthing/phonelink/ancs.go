package main

// ANCS, the Apple Notification Center Service: the iPhone tells us a notification arrived (Notification
// Source), we ask for its text (Control Point) and the answer comes back in pieces (Data Source).
// Incoming calls are notifications too, with "answer" and "decline" as their two actions.

import (
	"encoding/binary"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	ancsService = "7905f431-b5ce-4e99-a40f-4b1e122d00d0"
	ancsSource  = "9fbf120d-6301-42d9-8c58-25e699a21dbd"
	ancsControl = "69d1d8f3-45e1-49a8-9821-9bbdfdaad9d9"
	ancsData    = "22eac6e9-24d6-4bb5-be44-b36ace7c7bfb"

	catIncomingCall = 1
	flagPreExisting = 1 << 2
	keepNotes       = 12
)

type ancsJob struct {
	uid    uint32
	cat    int
	action int // -1: fetch the text; 0 / 1: perform the positive / negative action
}

type ancsSession struct {
	control dbus.ObjectPath
	jobs    chan ancsJob
	data    chan []byte
	quit    chan struct{}
	apps    map[string]string // bundle id → app name, for this connection
}

var ancs *ancsSession // under setupMu

func startANCS(chars map[string]dbus.ObjectPath) bool {
	if ancs != nil {
		return true
	}
	src, ctl, dat := chars[ancsSource], chars[ancsControl], chars[ancsData]
	if src == "" || ctl == "" || dat == "" {
		return false
	}
	a := &ancsSession{control: ctl, jobs: make(chan ancsJob, 32), data: make(chan []byte, 32), quit: make(chan struct{}), apps: map[string]string{}}
	// Data Source first: the phone starts sending as soon as Notification Source is subscribed
	if err := notify(dat, func(b []byte) {
		select {
		case a.data <- b:
		default:
		}
	}); err != nil {
		log.Printf("ancs data: %v", err)
		return false
	}
	if err := notify(src, a.source); err != nil {
		log.Printf("ancs source: %v", err)
		return false
	}
	ancs = a
	go a.work()
	log.Printf("notifications: on")
	return true
}

func stopANCS() {
	if ancs != nil {
		close(ancs.quit)
		ancs = nil
	}
}

func callAction(action int) error {
	mu.Lock()
	c := st.Call
	mu.Unlock()
	setupMu.Lock()
	a := ancs
	setupMu.Unlock()
	if c == nil || a == nil {
		return fmt.Errorf("no call")
	}
	select {
	case a.jobs <- ancsJob{uid: c.UID, cat: catIncomingCall, action: action}:
		return nil
	default:
		return fmt.Errorf("busy")
	}
}

// Notification Source: EventID, EventFlags, CategoryID, CategoryCount, NotificationUID (4 bytes)
func (a *ancsSession) source(b []byte) {
	if len(b) < 8 {
		return
	}
	ev, flags, cat := b[0], b[1], int(b[2])
	uid := binary.LittleEndian.Uint32(b[4:8])
	switch ev {
	case 0, 1: // added, modified
		// what was already on the phone before we connected is not news; a ringing call is
		if flags&flagPreExisting != 0 && cat != catIncomingCall {
			return
		}
		select {
		case a.jobs <- ancsJob{uid: uid, cat: cat, action: -1}:
		default:
		}
	case 2: // removed
		update(func(s *State) {
			if s.Call != nil && s.Call.UID == uid {
				s.Call = nil
			}
			for i, n := range s.Notes {
				if n.UID == uid {
					s.Notes = append(s.Notes[:i], s.Notes[i+1:]...)
					break
				}
			}
		})
	}
}

// one request at a time: the answers on Data Source carry no request number
func (a *ancsSession) work() {
	for {
		select {
		case <-a.quit:
			return
		case j := <-a.jobs:
			if j.action >= 0 {
				req := []byte{2, 0, 0, 0, 0, byte(j.action)}
				binary.LittleEndian.PutUint32(req[1:], j.uid)
				if err := writeRetry(a.control, req); err != nil {
					log.Printf("ancs action: %v", err)
				}
				continue
			}
			a.fetch(j)
		}
	}
}

func (a *ancsSession) fetch(j ancsJob) {
	// app id, title (64), subtitle (64), message (240)
	req := []byte{0, 0, 0, 0, 0, 0, 1, 64, 0, 2, 64, 0, 3, 240, 0}
	binary.LittleEndian.PutUint32(req[1:], j.uid)
	hdr := req[:5]
	attrs, ok := a.ask(req, hdr, 4)
	if !ok {
		return
	}
	n := Note{UID: j.uid, Cat: j.cat, bundle: attrs[0], Title: attrs[1], Sub: attrs[2], Msg: attrs[3], At: nowMs()}
	n.App = a.appName(n.bundle)
	update(func(s *State) {
		if j.cat == catIncomingCall {
			s.Call = &n
			return
		}
		out := []Note{n}
		for _, o := range s.Notes {
			if o.UID != n.UID && len(out) < keepNotes {
				out = append(out, o)
			}
		}
		s.Notes = out
	})
}

func (a *ancsSession) appName(bundle string) string {
	if bundle == "" {
		return ""
	}
	if name, ok := a.apps[bundle]; ok {
		return name
	}
	req := append([]byte{1}, bundle...)
	req = append(req, 0)
	hdr := append([]byte(nil), req...)
	req = append(req, 0) // DisplayName
	name := bundle
	if attrs, ok := a.ask(req, hdr, 1); ok && attrs[0] != "" {
		name = attrs[0]
	}
	a.apps[bundle] = name
	return name
}

// ask writes one request and gathers the answer: hdr (the request's command and id) followed by
// want attributes, each as id, 2-byte length, bytes. Pieces that do not start with our header belong to
// someone else (another program on the Car Thing may be asking too) and are skipped.
func (a *ancsSession) ask(req, hdr []byte, want int) (map[byte]string, bool) {
	for {
		select {
		case <-a.data: // drop leftovers from an earlier answer
			continue
		default:
		}
		break
	}
	if err := writeRetry(a.control, req); err != nil {
		log.Printf("ancs request: %v", err)
		return nil, false
	}
	var buf []byte
	deadline := time.After(4 * time.Second)
	for {
		select {
		case <-a.quit:
			return nil, false
		case <-deadline:
			return nil, false
		case b := <-a.data:
			if buf == nil && (len(b) < len(hdr) || string(b[:len(hdr)]) != string(hdr)) {
				continue
			}
			buf = append(buf, b...)
			if m, done := parseAttrs(buf[len(hdr):], want); done {
				return m, true
			}
		}
	}
}

func parseAttrs(b []byte, want int) (map[byte]string, bool) {
	m := map[byte]string{}
	for p := 0; len(m) < want; {
		if p+3 > len(b) {
			return nil, false
		}
		n := int(binary.LittleEndian.Uint16(b[p+1:]))
		if p+3+n > len(b) {
			return nil, false
		}
		m[b[p]] = clean(b[p+3 : p+3+n])
		p += 3 + n
	}
	return m, true
}

// text from the phone is cut at a byte limit, sometimes in the middle of a character
func clean(b []byte) string {
	s := strings.ToValidUTF8(string(b), "")
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\n' {
			return ' '
		}
		return r
	}, s))
}
