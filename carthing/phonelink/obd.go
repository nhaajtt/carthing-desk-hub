package main

// OBD-II over Bluetooth LE: live data from the car (speed, revs, temperatures, fuel, battery) and its stored
// fault codes, read from a cheap ELM327 BLE reader plugged into the car's OBD port. The Car Thing is the central
// here (the iPhone link stays as it is). Only while a screen listens on /obd/events, which the car copy of the
// page does: at the desk nothing scans or connects.
//
// Choosing a reader: POST /obd/search looks for 30 s and keeps the strongest nearby one whose name looks like an
// OBD reader, and keeps it only if it then says it is an ELM327. Its address is saved; from then on only that reader
// is ever connected to. (A name is the only test: plenty of other gadgets use the same serial-port services, and the
// first version, which also went by those, picked a neighbour's device.)

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

type OBD struct {
	State string             `json:"state"`           // none, search, wait, connect, init, noecu, live
	Name  string             `json:"name,omitempty"`  // the reader's Bluetooth name
	Until int64              `json:"until,omitempty"` // when the search ends
	Found []string           `json:"found,omitempty"` // readers seen during the search
	Volts *float64           `json:"volts,omitempty"` // battery at the OBD port (the reader measures it, even with the engine off)
	V     map[string]float64 `json:"v"`               // live data in metric units, see pids (elm.go)
	MIL   bool               `json:"mil"`             // check-engine light
	DTC   []string           `json:"dtc"`             // stored fault codes
	At    int64              `json:"at"`
	Err   string             `json:"err,omitempty"`
}

var (
	obdMu      sync.Mutex
	obd        = OBD{State: "none", V: map[string]float64{}, DTC: []string{}}
	obdSubs    = map[chan []byte]bool{}
	obdDirty   = make(chan struct{}, 1)
	obdWake    = make(chan struct{}, 1)
	obdLastSub time.Time
	obdSave    string
	obdAddr    string          // the chosen reader, "" when none
	obdPath    dbus.ObjectPath // its BlueZ object while connected
	obdRx      dbus.ObjectPath // the characteristic it answers on
	obdIn      chan []byte
	obdSearch  time.Time // searching until
	obdDemo    bool
)

const obdLinger = 2 * time.Minute // keep the reader connected this long after the last screen left

func obdUpdate(f func(*OBD)) {
	obdMu.Lock()
	f(&obd)
	obdMu.Unlock()
	select {
	case obdDirty <- struct{}{}:
	default:
	}
}

func obdPoke() {
	select {
	case obdWake <- struct{}{}:
	default:
	}
}

func obdSnapshot() []byte {
	obdMu.Lock()
	defer obdMu.Unlock()
	b, _ := json.Marshal(obd)
	return b
}

// at most 5 updates a second reach the screen, however fast the reader answers
func obdBroadcast() {
	for range obdDirty {
		time.Sleep(200 * time.Millisecond)
		b := obdSnapshot()
		obdMu.Lock()
		for c := range obdSubs {
			select {
			case c <- b:
			default:
			}
		}
		obdMu.Unlock()
	}
}

func obdEvents(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no streaming", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	c := make(chan []byte, 4)
	obdMu.Lock()
	obdSubs[c] = true
	obdMu.Unlock()
	obdPoke()
	defer func() {
		obdMu.Lock()
		delete(obdSubs, c)
		obdLastSub = time.Now()
		obdMu.Unlock()
	}()
	fmt.Fprintf(w, "data: %s\n\n", obdSnapshot())
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
}

func obdWanted() bool {
	obdMu.Lock()
	defer obdMu.Unlock()
	return len(obdSubs) > 0 || time.Since(obdLastSub) < obdLinger || time.Now().Before(obdSearch)
}

func obdLoad() {
	var s struct{ Addr, Name string }
	if b, err := os.ReadFile(obdSave); err == nil && json.Unmarshal(b, &s) == nil && s.Addr != "" {
		obdAddr = strings.ToUpper(s.Addr)
		obd.Name = s.Name
		obd.State = "wait"
	}
}

func obdStore(addr, name string) {
	b, _ := json.Marshal(map[string]string{"addr": addr, "name": name})
	tmp := obdSave + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		os.Rename(tmp, obdSave)
	}
}

func obdStartSearch() error {
	if obdDemo {
		return fmt.Errorf("demo mode")
	}
	obdMu.Lock()
	obdSearch = time.Now().Add(30 * time.Second)
	until := obdSearch.UnixMilli()
	obdMu.Unlock()
	obdUpdate(func(o *OBD) { o.State, o.Until, o.Found, o.Err = "search", until, nil, "" })
	obdPoke()
	return nil
}

func obdForget() error {
	obdMu.Lock()
	addr, path := obdAddr, obdPath
	obdAddr, obdSearch = "", time.Time{}
	obdMu.Unlock()
	os.Remove(obdSave)
	if path != "" {
		conn.Object(bluez, path).Call(ifDevice+".Disconnect", 0)
	}
	if addr != "" {
		if m, err := objects(); err == nil {
			for p, ifs := range m {
				if d, ok := ifs[ifDevice]; ok && strings.EqualFold(fmt.Sprint(d["Address"].Value()), addr) {
					adapter().Call("org.bluez.Adapter1.RemoveDevice", 0, p)
				}
			}
		}
	}
	obdUpdate(func(o *OBD) { *o = OBD{State: "none", V: map[string]float64{}, DTC: []string{}} })
	log.Printf("obd: reader forgotten")
	return nil
}

// isOBD: BlueZ signals about the reader are not about the phone
func isOBD(p dbus.ObjectPath) bool {
	obdMu.Lock()
	defer obdMu.Unlock()
	return p != "" && (p == obdPath || (obdPath != "" && strings.HasPrefix(string(p), string(obdPath)+"/")))
}

// obdValue is called by the Bluetooth loop for every notification; true when it was the reader's
func obdValue(p dbus.ObjectPath, b []byte) bool {
	obdMu.Lock()
	rx, in := obdRx, obdIn
	obdMu.Unlock()
	if p != rx || in == nil {
		return false
	}
	select {
	case in <- append([]byte(nil), b...):
	default: // a reader flooding us loses the excess; the command then times out
	}
	return true
}

// ---------------------------------------------------------------- finding the reader

// names cheap readers advertise with
var obdName = regexp.MustCompile(`(?i)obd|elm ?327|v-?link|vgate|icar|veepeak|konnwei|carista|vlink|obdlink|kiwi`)

// the serial-port services readers use, and their notify / write characteristics
var obdUART = []struct{ svc, rx, tx string }{
	{"0000fff0", "0000fff1", "0000fff2"},
	{"0000ffe0", "0000ffe1", "0000ffe1"},
	{"000018f0", "00002af0", "00002af1"},
	{"e7810a71", "bef8d6c9", "bef8d6c9"},
	{"6e400001", "6e400003", "6e400002"},
}

// a reader plugged in under the dashboard is close: anything fainter is somebody else's
const obdNear = -80

func looksLikeOBD(d map[string]dbus.Variant) bool {
	name, _ := d["Name"].Value().(string)
	return obdName.MatchString(name)
}

// isELM: what a reader says to ATI ("ELM327 v1.5", "OBDLink...", "STN2120...")
func isELM(lines []string) bool {
	for _, l := range lines {
		if obdName.MatchString(l) || strings.Contains(l, "STN") {
			return true
		}
	}
	return false
}

func discovery(on bool) {
	if on {
		adapter().Call("org.bluez.Adapter1.SetDiscoveryFilter", 0, map[string]dbus.Variant{
			"Transport": dbus.MakeVariant("le"), "DuplicateData": dbus.MakeVariant(false)})
		if err := adapter().Call("org.bluez.Adapter1.StartDiscovery", 0).Err; err != nil && !strings.Contains(err.Error(), "InProgress") {
			log.Printf("obd: scan: %v", err)
		}
	} else {
		adapter().Call("org.bluez.Adapter1.StopDiscovery", 0)
	}
}

// search: 30 s of scanning, then the strongest reader seen is kept
func obdRunSearch() {
	discovery(true)
	defer discovery(false)
	type cand struct {
		addr, name string
		rssi       int16
	}
	best := map[string]cand{}
	for {
		obdMu.Lock()
		until := obdSearch
		obdMu.Unlock()
		if m, err := objects(); err == nil {
			for _, ifs := range m {
				d, ok := ifs[ifDevice]
				if !ok || !looksLikeOBD(d) {
					continue
				}
				rssi, ok := d["RSSI"].Value().(int16)
				if !ok || rssi < obdNear {
					continue // not seen in this scan, or too far away to be in this car
				}
				addr, _ := d["Address"].Value().(string)
				name, _ := d["Name"].Value().(string)
				best[addr] = cand{strings.ToUpper(addr), name, rssi}
			}
		}
		var names []string
		for _, c := range best {
			names = append(names, c.name)
		}
		obdUpdate(func(o *OBD) { o.Found = names })
		if time.Now().After(until) || len(best) > 0 && time.Now().After(until.Add(-20*time.Second)) {
			break
		}
		time.Sleep(time.Second)
	}
	obdMu.Lock()
	obdSearch = time.Time{}
	obdMu.Unlock()
	var pick *cand
	for _, c := range best {
		if pick == nil || c.rssi > pick.rssi {
			c := c
			pick = &c
		}
	}
	if pick == nil {
		obdUpdate(func(o *OBD) { o.State, o.Until, o.Found, o.Err = "none", 0, nil, "no reader found" })
		log.Printf("obd: search found no reader")
		return
	}
	obdMu.Lock()
	obdAddr = pick.addr
	obdMu.Unlock()
	obdStore(pick.addr, pick.name)
	obdUpdate(func(o *OBD) { o.State, o.Name, o.Until, o.Found, o.Err = "wait", pick.name, 0, nil, "" })
	log.Printf("obd: chose %q (%d dBm)", pick.name, pick.rssi)
}

// findReader scans until the chosen reader shows up (BlueZ forgets unpaired devices soon after they leave)
func findReader(addr string, d time.Duration) (dbus.ObjectPath, bool) {
	look := func() dbus.ObjectPath {
		m, err := objects()
		if err != nil {
			return ""
		}
		for p, ifs := range m {
			if dev, ok := ifs[ifDevice]; ok && strings.EqualFold(fmt.Sprint(dev["Address"].Value()), addr) {
				if _, seen := dev["RSSI"]; seen {
					return p
				}
				if c, _ := dev["Connected"].Value().(bool); c {
					return p
				}
			}
		}
		return ""
	}
	if p := look(); p != "" {
		return p, true
	}
	discovery(true)
	defer discovery(false)
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		time.Sleep(time.Second)
		if p := look(); p != "" {
			return p, true
		}
	}
	return "", false
}

// ---------------------------------------------------------------- the loop

func obdLoop() {
	for {
		if !obdWanted() {
			<-obdWake
			continue
		}
		obdMu.Lock()
		addr, searching := obdAddr, time.Now().Before(obdSearch)
		obdMu.Unlock()
		if conn == nil {
			time.Sleep(2 * time.Second)
			continue
		}
		switch {
		case searching:
			obdRunSearch()
		case addr == "":
			obdUpdate(func(o *OBD) { o.State = "none" })
			select {
			case <-obdWake:
			case <-time.After(time.Minute):
			}
		default:
			obdSession(addr)
		}
	}
}

// obdSession finds the reader, connects, reads until it goes away or nobody watches, then lets it go
func obdSession(addr string) {
	obdUpdate(func(o *OBD) { o.State, o.Err = "wait", "" })
	path, ok := findReader(addr, 15*time.Second)
	if !ok {
		// not in range (the car is off and the reader asleep, or the Car Thing is at the desk): rest a little
		select {
		case <-obdWake:
		case <-time.After(15 * time.Second):
		}
		return
	}
	obdUpdate(func(o *OBD) { o.State = "connect" })
	dev := conn.Object(bluez, path)
	obdMu.Lock()
	obdPath = path
	obdMu.Unlock()
	defer func() {
		obdMu.Lock()
		obdPath, obdRx, obdIn = "", "", nil
		obdMu.Unlock()
		dev.Call(ifDevice+".Disconnect", 0)
		obdUpdate(func(o *OBD) {
			if o.State != "none" {
				o.State = "wait"
			}
			o.V, o.Volts = map[string]float64{}, nil
		})
	}()
	if err := dev.Call(ifDevice+".Connect", 0).Err; err != nil {
		log.Printf("obd: connect: %v", err)
		obdUpdate(func(o *OBD) { o.Err = "could not connect" })
		time.Sleep(5 * time.Second)
		return
	}
	rx, tx, noResp, ok := readerChars(path)
	if !ok {
		log.Printf("obd: the reader has no serial service this helper knows")
		obdUpdate(func(o *OBD) { o.Err = "unknown reader" })
		time.Sleep(30 * time.Second)
		return
	}
	in := make(chan []byte, 64)
	obdMu.Lock()
	obdRx, obdIn = rx, in
	obdMu.Unlock()
	if err := conn.Object(bluez, rx).Call(ifChar+".StartNotify", 0).Err; err != nil {
		log.Printf("obd: notify: %v", err)
		return
	}
	kind := "request"
	if noResp {
		kind = "command"
	}
	e := &elm{in: in, send: func(b []byte) error {
		// BLE without a larger MTU carries 20 bytes per write
		for len(b) > 0 {
			n := min(len(b), 20)
			if err := conn.Object(bluez, tx).Call(ifChar+".WriteValue", 0, b[:n], map[string]dbus.Variant{"type": dbus.MakeVariant(kind)}).Err; err != nil {
				return err
			}
			b = b[n:]
		}
		return nil
	}}
	// the reader has to say what it is before anything else is sent
	if l, err := e.cmd("ATI", 3*time.Second); err != nil || !isELM(l) {
		log.Printf("obd: the device does not answer like an OBD reader; forgetting it")
		obdForget()
		obdUpdate(func(o *OBD) { o.Err = "not an OBD reader" })
		return
	}
	log.Printf("obd: connected")
	obdRead(e, func() bool {
		obdMu.Lock()
		same, searching := obdAddr == addr, time.Now().Before(obdSearch)
		obdMu.Unlock()
		if !same || searching || !obdWanted() {
			return false
		}
		v, err := dev.GetProperty(ifDevice + ".Connected")
		return err == nil && v.Value() == true
	})
}

// readerChars finds the reader's serial service: a known one, or any custom service with one characteristic to
// write to and one that notifies
func readerChars(dev dbus.ObjectPath) (rx, tx dbus.ObjectPath, noResp, ok bool) {
	var m managed
	for i := 0; i < 20; i++ { // services may take a moment to resolve after connecting
		var err error
		if m, err = objects(); err == nil {
			if d, ok := m[dev][ifDevice]; ok && d["ServicesResolved"].Value() == true {
				break
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	type ch struct {
		path    dbus.ObjectPath
		svc     dbus.ObjectPath
		uuid    string
		notify  bool
		write   bool
		noRespW bool
	}
	var chars []ch
	svcUUID := map[dbus.ObjectPath]string{}
	for p, ifs := range m {
		if !strings.HasPrefix(string(p), string(dev)+"/") {
			continue
		}
		if s, ok := ifs[ifService]; ok {
			u, _ := s["UUID"].Value().(string)
			svcUUID[p] = strings.ToLower(u)
		}
		if c, ok := ifs[ifChar]; ok {
			u, _ := c["UUID"].Value().(string)
			svc, _ := c["Service"].Value().(dbus.ObjectPath)
			flags, _ := c["Flags"].Value().([]string)
			x := ch{path: p, svc: svc, uuid: strings.ToLower(u)}
			for _, f := range flags {
				switch f {
				case "notify", "indicate":
					x.notify = true
				case "write":
					x.write = true
				case "write-without-response":
					x.write, x.noRespW = true, true
				}
			}
			chars = append(chars, x)
		}
	}
	for _, k := range obdUART {
		var r, t *ch
		for i := range chars {
			c := &chars[i]
			if !strings.HasPrefix(svcUUID[c.svc], k.svc) {
				continue
			}
			if strings.HasPrefix(c.uuid, k.rx) && c.notify {
				r = c
			}
			if strings.HasPrefix(c.uuid, k.tx) && c.write {
				t = c
			}
		}
		if r != nil && t != nil {
			return r.path, t.path, t.noRespW && !hasFlagWrite(t.path, m), true
		}
	}
	// standard services (generic access, battery, device information…) are 0000xxxx-0000-1000-8000-00805f9b34fb
	// with xxxx below 0x2000; a reader's serial port is something else
	byService := map[dbus.ObjectPath][]ch{}
	for _, c := range chars {
		u := svcUUID[c.svc]
		if strings.HasSuffix(u, "-0000-1000-8000-00805f9b34fb") && u[4:8] < "2000" && !strings.HasPrefix(u, "000018f0") {
			continue
		}
		byService[c.svc] = append(byService[c.svc], c)
	}
	for _, cs := range byService {
		var r, t *ch
		for i := range cs {
			if cs[i].notify && r == nil {
				r = &cs[i]
			}
			if cs[i].write && t == nil {
				t = &cs[i]
			}
		}
		if r != nil && t != nil {
			return r.path, t.path, t.noRespW && !hasFlagWrite(t.path, m), true
		}
	}
	return "", "", false, false
}

// a characteristic that takes both kinds of write gets acknowledged writes: slower, but none are lost
func hasFlagWrite(p dbus.ObjectPath, m managed) bool {
	flags, _ := m[p][ifChar]["Flags"].Value().([]string)
	for _, f := range flags {
		if f == "write" {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- reading the car

// obdRead sets the reader up, then reads live data until alive() says stop. Fast values every round, slower
// ones every few seconds, the check-engine light every 30 s and the codes when it is on.
func obdRead(e *elm, alive func() bool) {
	obdUpdate(func(o *OBD) { o.State = "init" })
	if _, err := e.cmd("ATZ", 4*time.Second); err != nil {
		log.Printf("obd: reset: %v", err)
		return
	}
	for _, c := range []string{"ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0"} {
		if _, err := e.cmd(c, 2*time.Second); err != nil {
			log.Printf("obd: %s: %v", c, err)
			return
		}
	}
	var supported map[byte]bool
	can := false
	fails := 0
	var lastSlow, lastMIL, lastDTC, lastECU time.Time
	slowAt := 0
	for alive() {
		// the reader measures the battery by itself, so this works with the engine off too
		if time.Since(lastSlow) > 3*time.Second || supported == nil {
			if l, err := e.cmd("ATRV", 2*time.Second); err == nil {
				if v, ok := voltsOf(l); ok {
					obdUpdate(func(o *OBD) { o.Volts = &v })
				}
			} else if err == errElmTimeout {
				return
			}
		}
		if supported == nil {
			if time.Since(lastECU) < 10*time.Second {
				time.Sleep(time.Second)
				continue
			}
			lastECU = time.Now()
			// the first request starts the search for the car's protocol: up to about 15 s
			s, err := supportedAll(e)
			if err != nil {
				obdUpdate(func(o *OBD) { o.State = "noecu" })
				if err == errElmTimeout {
					fails++
					if fails > 3 {
						return
					}
				}
				continue
			}
			supported, fails = s, 0
			if l, err := e.cmd("ATDPN", 2*time.Second); err == nil {
				can = protoIsCAN(l)
			}
			log.Printf("obd: the car answers (%d values, CAN %v)", len(supported), can)
			obdUpdate(func(o *OBD) { o.State = "live" })
		}
		round := []byte{0x0D, 0x0C, 0x11, 0x04}
		if time.Since(lastSlow) > 3*time.Second {
			lastSlow = time.Now()
			slow := []byte{0x05, 0x2F, 0x10, 0x5E, 0x0F, 0x46, 0x5C, 0x42, 0x1F}
			// one or two slow ones per round keeps the fast ones fast
			for i := 0; i < 3; i++ {
				round = append(round, slow[slowAt%len(slow)])
				slowAt++
			}
		}
		got := map[string]float64{}
		bad := 0
		for _, pid := range round {
			if !supported[pid] {
				continue
			}
			l, err := e.cmd(fmt.Sprintf("01%02X", pid), 2*time.Second)
			if err == nil {
				var b []byte
				if b, err = pidData(l, pid); err == nil {
					if k, v, ok := pidValue(pid, b); ok {
						got[k] = v
					}
					continue
				}
			}
			if err == errElmNoData {
				continue
			}
			bad++
		}
		if bad > 0 && len(got) == 0 {
			// the engine was switched off: wait for it to answer again
			fails++
			if fails >= 3 {
				log.Printf("obd: the car stopped answering")
				supported, fails = nil, 0
				obdUpdate(func(o *OBD) { o.State, o.V = "noecu", map[string]float64{} })
			}
			continue
		}
		fails = 0
		if time.Since(lastMIL) > 30*time.Second {
			lastMIL = time.Now()
			if l, err := e.cmd("0101", 2*time.Second); err == nil {
				if b, err := pidData(l, 0x01); err == nil {
					mil, n := monitorStatus(b)
					obdUpdate(func(o *OBD) { o.MIL = mil })
					if (mil || n > 0) && time.Since(lastDTC) > time.Minute || !mil && n == 0 {
						lastDTC = time.Now()
						codes := []string{}
						if n > 0 || mil {
							if l, err := e.cmd("03", 4*time.Second); err == nil {
								if c, err := troubleCodes(l, can); err == nil {
									codes = c
								}
							}
						}
						obdUpdate(func(o *OBD) { o.DTC = codes })
					}
				}
			}
		}
		at := nowMs()
		obdUpdate(func(o *OBD) {
			for k, v := range got {
				o.V[k] = math.Round(v*100) / 100
			}
			o.At = at
		})
	}
}

// supportedAll asks which live values the car offers (0100, then 0120, 0140 while the last bit says more follow)
func supportedAll(e *elm) (map[byte]bool, error) {
	out := map[byte]bool{}
	for base := byte(0); ; base += 0x20 {
		l, err := e.cmd(fmt.Sprintf("01%02X", base), 20*time.Second)
		if err != nil {
			return nil, err
		}
		b, err := pidData(l, base)
		if err != nil {
			if base == 0 {
				return nil, err
			}
			break
		}
		for _, p := range supportedPIDs(base, b) {
			out[p] = true
		}
		if !out[base+0x20] || base >= 0x40 {
			break
		}
	}
	return out, nil
}

// ---------------------------------------------------------------- demo (-obd-demo): a made-up drive, for the screen

func obdDemoLoop() {
	start := time.Now()
	v := 12.6
	obdUpdate(func(o *OBD) { o.State, o.Name, o.Volts = "live", "OBDII (demo)", &v })
	speed, rpm := 0.0, 800.0
	for range time.Tick(200 * time.Millisecond) {
		t := time.Since(start).Seconds()
		// a town drive: pull away, cruise, slow for a light, a little noise on everything
		target := 50 + 25*math.Sin(t/9) + 15*math.Sin(t/3.1)
		if math.Mod(t, 60) > 50 {
			target = 0
		}
		speed += (target - speed) * 0.06
		speed = math.Max(0, speed)
		// five gears of 20 km/h each: revs climb through a gear and drop at the change
		gear := math.Max(1, math.Min(5, math.Ceil(speed/20)))
		want := 760.0
		if speed > 3 {
			want = 1100 + (speed-(gear-1)*20)/20*1900
		}
		rpm += (want - rpm) * 0.35
		coolant := math.Min(90, 40+t/2)
		volts := 14.1 + rand.Float64()*0.2
		obdUpdate(func(o *OBD) {
			o.V = map[string]float64{
				"speed": math.Round(speed), "rpm": math.Round(rpm), "throttle": math.Round(math.Max(0, target-speed)*1.5 + 14),
				"load": math.Round(20 + math.Max(0, target-speed)), "coolant": math.Round(coolant), "fuel": 58,
				"intake": 24, "ambient": 19, "maf": math.Round((2+speed/9)*100) / 100, "module": volts,
			}
			o.Volts = &volts
			o.MIL, o.DTC = true, []string{"P0420"}
			o.At = nowMs()
		})
	}
}
