package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/prop"
)

const (
	bluez       = "org.bluez"
	adapterPath = dbus.ObjectPath("/org/bluez/hci0")
	agentPath   = dbus.ObjectPath("/org/deskhub/phonelink/agent")
	advPath     = dbus.ObjectPath("/org/deskhub/phonelink/adv")
	advName     = "Desk Hub"
	pairWindow  = 2 * time.Minute

	ifDevice  = "org.bluez.Device1"
	ifBattery = "org.bluez.Battery1"
	ifChar    = "org.bluez.GattCharacteristic1"
)

var (
	conn     *dbus.Conn
	savePath string

	// guarded by mu (main.go)
	phoneAddr  string          // identity address of the paired iPhone, "" when none
	phonePath  dbus.ObjectPath // its BlueZ object, "" while BlueZ does not know it
	pairUntil  time.Time
	pairTimer  *time.Timer
	advUp      bool
	advDisc    bool
	advProps   *prop.Properties
	reconnect  sync.Once
	firstStart sync.Once

	setupMu sync.Mutex
	onValue = map[dbus.ObjectPath]func([]byte){} // characteristic → handler for its notifications (under mu)
)

type managed map[dbus.ObjectPath]map[string]map[string]dbus.Variant

func objects() (managed, error) {
	var m managed
	err := conn.Object(bluez, "/").Call("org.freedesktop.DBus.ObjectManager.GetManagedObjects", 0).Store(&m)
	return m, err
}

func adapter() dbus.BusObject { return conn.Object(bluez, adapterPath) }

func setAdapter(name string, v any) error {
	return adapter().Call("org.freedesktop.DBus.Properties.Set", 0, "org.bluez.Adapter1", name, dbus.MakeVariant(v)).Err
}

func load() {
	var s struct{ Addr string }
	if b, err := os.ReadFile(savePath); err == nil && json.Unmarshal(b, &s) == nil {
		phoneAddr = strings.ToUpper(s.Addr)
	}
}

func save(addr string) {
	b, _ := json.Marshal(map[string]string{"addr": addr})
	tmp := savePath + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		os.Rename(tmp, savePath)
	}
}

// ---------------------------------------------------------------- agent: asked by BlueZ when a phone wants to pair

// Registered as DisplayOnly: the iPhone asks you to type the 6 digits shown on the Car Thing, so a phone
// that cannot see the screen cannot pair. Outside the 2-minute window opened from the quick menu, every
// request is refused.
type agent struct{}

var rejected = dbus.NewError("org.bluez.Error.Rejected", nil)

func pairingOpen() bool { mu.Lock(); defer mu.Unlock(); return time.Now().Before(pairUntil) }

func (agent) Release() *dbus.Error { return nil }
func (agent) Cancel() *dbus.Error {
	update(func(s *State) {
		if s.Pairing != nil {
			s.Pairing.Passkey = ""
		}
	})
	return nil
}
func (agent) RequestPinCode(dbus.ObjectPath) (string, *dbus.Error) { return "", rejected }
func (agent) DisplayPinCode(dbus.ObjectPath, string) *dbus.Error   { return rejected }
func (agent) RequestPasskey(dbus.ObjectPath) (uint32, *dbus.Error) { return 0, rejected }
func (agent) RequestAuthorization(dbus.ObjectPath) *dbus.Error     { return rejected } // "just works": no code, no pairing
func (agent) AuthorizeService(dbus.ObjectPath, string) *dbus.Error { return rejected }
func (agent) DisplayPasskey(dev dbus.ObjectPath, key uint32, _ uint16) *dbus.Error {
	return showCode(key)
}
func (agent) RequestConfirmation(dev dbus.ObjectPath, key uint32) *dbus.Error {
	return showCode(key)
}

func showCode(key uint32) *dbus.Error {
	if !pairingOpen() {
		return rejected
	}
	update(func(s *State) {
		if s.Pairing != nil {
			s.Pairing.Passkey = fmt.Sprintf("%06d", key)
		}
	})
	return nil
}

// ---------------------------------------------------------------- advertisement: how the iPhone finds us

type adv struct{}

func (adv) Release() *dbus.Error {
	mu.Lock()
	advUp = false
	mu.Unlock()
	time.AfterFunc(3*time.Second, refreshAdv)
	return nil
}

// Advertise only while it is needed: during the pairing window (visible to every phone, so the iPhone
// lists it), or while the paired iPhone is away (no longer "discoverable", so only phones that know us
// reconnect). Once the iPhone is connected, the Car Thing stops advertising altogether.
func refreshAdv() {
	mu.Lock()
	open := time.Now().Before(pairUntil)
	want := open || (phoneAddr != "" && !st.Connected)
	up, disc := advUp, advDisc
	mu.Unlock()
	mgr := conn.Object(bluez, adapterPath)
	if up && (!want || disc != open) {
		mgr.Call("org.bluez.LEAdvertisingManager1.UnregisterAdvertisement", 0, advPath)
		mu.Lock()
		advUp = false
		mu.Unlock()
		up = false
	}
	if want && !up {
		advProps.SetMust("org.bluez.LEAdvertisement1", "Discoverable", open)
		if err := mgr.Call("org.bluez.LEAdvertisingManager1.RegisterAdvertisement", 0, advPath, map[string]dbus.Variant{}).Err; err != nil {
			log.Printf("advertise: %v", err)
			return
		}
		mu.Lock()
		advUp, advDisc = true, open
		mu.Unlock()
	}
}

// ---------------------------------------------------------------- pairing window

func startPairing() error {
	if err := conn.Object(bluez, "/org/bluez").Call("org.bluez.AgentManager1.RequestDefaultAgent", 0, agentPath).Err; err != nil {
		return fmt.Errorf("agent: %v", err)
	}
	if err := setAdapter("Pairable", true); err != nil {
		return err
	}
	until := time.Now().Add(pairWindow)
	mu.Lock()
	pairUntil = until
	if pairTimer != nil {
		pairTimer.Stop()
	}
	pairTimer = time.AfterFunc(pairWindow, closePairing)
	mu.Unlock()
	alias := ""
	if v, err := adapter().GetProperty("org.bluez.Adapter1.Alias"); err == nil {
		alias, _ = v.Value().(string)
	}
	update(func(s *State) { s.Pairing = &Pairing{Until: until.UnixMilli(), Alias: alias} })
	refreshAdv()
	log.Printf("pairing window open for %v", pairWindow)
	return nil
}

func closePairing() {
	mu.Lock()
	pairUntil = time.Time{}
	if pairTimer != nil {
		pairTimer.Stop()
	}
	mu.Unlock()
	setAdapter("Pairable", false)
	update(func(s *State) { s.Pairing = nil })
	refreshAdv()
}

// a phone finished pairing while the window was open: it becomes the only phone we listen to
func adopt(path dbus.ObjectPath) {
	var addr string
	if v, err := conn.Object(bluez, path).GetProperty(ifDevice + ".Address"); err == nil {
		addr, _ = v.Value().(string)
	}
	addr = strings.ToUpper(addr)
	mu.Lock()
	old, oldPath := phoneAddr, phonePath
	phoneAddr, phonePath = addr, path
	mu.Unlock()
	if old != "" && old != addr && oldPath != "" {
		adapter().Call("org.bluez.Adapter1.RemoveDevice", 0, oldPath)
	}
	save(addr)
	conn.Object(bluez, path).Call("org.freedesktop.DBus.Properties.Set", 0, ifDevice, "Trusted", dbus.MakeVariant(true))
	log.Printf("paired with a phone")
	update(func(s *State) { s.Paired = true })
	closePairing()
	syncPhone()
}

func forgetPhone() error {
	mu.Lock()
	path := phonePath
	phoneAddr, phonePath = "", ""
	mu.Unlock()
	os.Remove(savePath)
	stopSessions()
	if path != "" {
		adapter().Call("org.bluez.Adapter1.RemoveDevice", 0, path)
	}
	update(func(s *State) { *s = State{Notes: []Note{}, Pairing: s.Pairing} })
	refreshAdv()
	log.Printf("phone forgotten")
	return nil
}

// ---------------------------------------------------------------- the phone's link

// syncPhone finds the paired iPhone in BlueZ and starts reading from it when it is connected
func syncPhone() {
	m, err := objects()
	if err != nil {
		return
	}
	mu.Lock()
	addr := phoneAddr
	mu.Unlock()
	var path dbus.ObjectPath
	var dev map[string]dbus.Variant
	for p, ifs := range m {
		d, ok := ifs[ifDevice]
		if !ok {
			continue
		}
		if a, _ := d["Address"].Value().(string); addr != "" && strings.EqualFold(a, addr) {
			path, dev = p, d
		}
	}
	mu.Lock()
	phonePath = path
	mu.Unlock()
	connected, resolved, paired := false, false, false
	name := ""
	if dev != nil {
		connected, _ = dev["Connected"].Value().(bool)
		resolved, _ = dev["ServicesResolved"].Value().(bool)
		paired, _ = dev["Paired"].Value().(bool)
		name, _ = dev["Alias"].Value().(string)
	}
	var battery *int
	if b, ok := m[path][ifBattery]; ok {
		if v, ok := b["Percentage"].Value().(byte); ok {
			n := int(v)
			battery = &n
		}
	}
	update(func(s *State) {
		s.Paired = addr != "" && paired
		s.Connected = connected && paired
		s.Name = name
		s.Battery = battery
		if !s.Connected {
			s.Media, s.Call, s.Notes = nil, nil, []Note{}
		}
	})
	refreshAdv()
	if connected && resolved && paired {
		startSessions(path, m)
	} else if !connected {
		stopSessions()
	}
}

func startSessions(dev dbus.ObjectPath, m managed) {
	setupMu.Lock()
	defer setupMu.Unlock()
	chars := map[string]dbus.ObjectPath{}
	for p, ifs := range m {
		if c, ok := ifs[ifChar]; ok && strings.HasPrefix(string(p), string(dev)+"/") {
			u, _ := c["UUID"].Value().(string)
			chars[strings.ToLower(u)] = p
		}
	}
	// each one starts once per connection; one that is missing now (notifications not shared yet) starts
	// later, when its service shows up
	startANCS(chars)
	startAMS(chars)
}

func stopSessions() {
	setupMu.Lock()
	defer setupMu.Unlock()
	mu.Lock()
	onValue = map[dbus.ObjectPath]func([]byte){}
	early = map[dbus.ObjectPath][][]byte{}
	mu.Unlock()
	stopANCS()
	stopAMS()
}

// GATT helpers
// early holds values that arrived on the phone's characteristics before we listened to them. nocturned
// subscribes to the notification service a moment before we do, and the iPhone lists the notifications it
// already has only once, right when the first subscriber arrives: replaying them lets us see that list too.
var early = map[dbus.ObjectPath][][]byte{} // under mu

func notify(p dbus.ObjectPath, f func([]byte)) error {
	mu.Lock()
	onValue[p] = f
	replay := early[p]
	delete(early, p)
	mu.Unlock()
	for _, b := range replay {
		f(b)
	}
	return conn.Object(bluez, p).Call(ifChar+".StartNotify", 0).Err
}

func write(p dbus.ObjectPath, b []byte) error {
	return conn.Object(bluez, p).Call(ifChar+".WriteValue", 0, b, map[string]dbus.Variant{"type": dbus.MakeVariant("request")}).Err
}

// nocturned reads the same notification service; BlueZ runs one write per characteristic at a time and
// turns the other away with "In Progress", so wait for our turn
func writeRetry(p dbus.ObjectPath, b []byte) error {
	var err error
	for i := 0; i < 15; i++ {
		if err = write(p, b); err == nil || !strings.Contains(err.Error(), "In Progress") {
			return err
		}
		time.Sleep(time.Duration(120+rand.Intn(200)) * time.Millisecond)
	}
	return err
}

func read(p dbus.ObjectPath) ([]byte, error) {
	var b []byte
	err := conn.Object(bluez, p).Call(ifChar+".ReadValue", 0, map[string]dbus.Variant{}).Store(&b)
	return b, err
}

// ---------------------------------------------------------------- main loop

func runBluetooth() error {
	var err error
	if conn == nil {
		if conn, err = dbus.ConnectSystemBus(); err != nil {
			return err
		}
		conn.Export(agent{}, agentPath, "org.bluez.Agent1")
		conn.Export(adv{}, advPath, "org.bluez.LEAdvertisement1")
		advProps, err = prop.Export(conn, advPath, prop.Map{"org.bluez.LEAdvertisement1": {
			"Type":         {Value: "peripheral"},
			"LocalName":    {Value: advName},
			"SolicitUUIDs": {Value: []string{ancsService}}, // asks the iPhone for its notification service
			"ServiceUUIDs": {Value: []string{"1812"}},      // a remote: what iOS lists in Settings (gatt.go)
			"Appearance":   {Value: uint16(0x0180)},        // generic remote control
			"Discoverable": {Value: false},
		}})
		if err == nil {
			err = exportGatt()
		}
		if err != nil {
			return err
		}
		mu.Lock()
		load()
		mu.Unlock()
	}

	sig := make(chan *dbus.Signal, 128)
	conn.Signal(sig)
	defer conn.RemoveSignal(sig)
	for _, o := range [][]dbus.MatchOption{
		{dbus.WithMatchSender(bluez), dbus.WithMatchInterface("org.freedesktop.DBus.Properties"), dbus.WithMatchMember("PropertiesChanged")},
		{dbus.WithMatchSender(bluez), dbus.WithMatchInterface("org.freedesktop.DBus.ObjectManager")},
		{dbus.WithMatchInterface("org.freedesktop.DBus"), dbus.WithMatchMember("NameOwnerChanged"), dbus.WithMatchArg(0, bluez)},
	} {
		if err := conn.AddMatchSignal(o...); err != nil {
			return err
		}
	}

	// (re)register with BlueZ: done at start and every time bluetoothd restarts
	register := func() error {
		if err := conn.Object(bluez, "/org/bluez").Call("org.bluez.AgentManager1.RegisterAgent", 0, agentPath, "DisplayOnly").Err; err != nil &&
			!strings.Contains(err.Error(), "AlreadyExists") {
			return err
		}
		if err := registerGatt(); err != nil && !strings.Contains(err.Error(), "AlreadyExists") {
			log.Printf("remote service: %v", err)
		}
		mu.Lock()
		advUp = false
		mu.Unlock()
		if !pairingOpen() {
			setAdapter("Pairable", false)
		}
		syncPhone()
		return nil
	}
	if err := register(); err != nil {
		return err
	}
	// started while the phone was already connected: the list of notifications it already has went out
	// long ago, so drop the link once; the phone comes straight back and lists them again
	firstStart.Do(func() {
		mu.Lock()
		p, c := phonePath, st.Connected
		mu.Unlock()
		if p != "" && c {
			log.Printf("reconnecting the phone to read what it already has")
			conn.Object(bluez, p).Call(ifDevice+".Disconnect", 0)
		}
	})

	// iOS reconnects by itself while we advertise; this is a slower second way back in
	reconnect.Do(func() {
		go func() {
			for range time.Tick(60 * time.Second) {
				mu.Lock()
				p, c := phonePath, st.Connected
				mu.Unlock()
				if p != "" && !c && !pairingOpen() {
					conn.Object(bluez, p).Call(ifDevice+".Connect", 0)
				}
			}
		}()
	})

	resync := time.NewTimer(time.Hour)
	for {
		select {
		case <-resync.C:
			syncPhone()
		case s := <-sig:
			switch s.Name {
			case "org.freedesktop.DBus.NameOwnerChanged":
				if len(s.Body) == 3 && s.Body[2] != "" {
					log.Printf("bluetoothd restarted")
					stopSessions()
					time.Sleep(2 * time.Second)
					if err := register(); err != nil {
						return err
					}
				}
			case "org.freedesktop.DBus.Properties.PropertiesChanged":
				if len(s.Body) < 2 {
					continue
				}
				iface, _ := s.Body[0].(string)
				changed, _ := s.Body[1].(map[string]dbus.Variant)
				switch iface {
				case ifChar:
					if v, ok := changed["Value"]; ok {
						mu.Lock()
						f := onValue[s.Path]
						b, isBytes := v.Value().([]byte)
						if f == nil && isBytes && phonePath != "" && strings.HasPrefix(string(s.Path), string(phonePath)+"/") && len(early[s.Path]) < 256 {
							early[s.Path] = append(early[s.Path], b)
						}
						mu.Unlock()
						if isBytes && f != nil {
							f(b)
						}
					}
				case ifDevice:
					if p, ok := changed["Paired"]; ok && p.Value() == true && pairingOpen() {
						go adopt(s.Path)
						continue
					}
					// iOS connects but does not start pairing by itself: ask for it (the code then shows)
					if c, ok := changed["Connected"]; ok && c.Value() == true && pairingOpen() {
						go askToPair(s.Path)
					}
					mu.Lock()
					mine := s.Path == phonePath
					mu.Unlock()
					if mine {
						resync.Reset(300 * time.Millisecond)
					}
				case ifBattery:
					mu.Lock()
					mine := s.Path == phonePath
					mu.Unlock()
					if v, ok := changed["Percentage"].Value().(byte); ok && mine {
						n := int(v)
						update(func(s *State) { s.Battery = &n })
					}
				}
			case "org.freedesktop.DBus.ObjectManager.InterfacesAdded", "org.freedesktop.DBus.ObjectManager.InterfacesRemoved":
				// services show up after pairing (iOS hides them until the link is encrypted)
				if len(s.Body) > 0 {
					p, _ := s.Body[0].(dbus.ObjectPath)
					mu.Lock()
					mine := phonePath != "" && strings.HasPrefix(string(p), string(phonePath))
					known := phoneAddr != "" && phonePath == ""
					mu.Unlock()
					if mine || known {
						resync.Reset(time.Second)
					}
				}
			}
		}
	}
}

func askToPair(path dbus.ObjectPath) {
	time.Sleep(1500 * time.Millisecond)
	dev := conn.Object(bluez, path)
	if v, err := dev.GetProperty(ifDevice + ".Paired"); err == nil && v.Value() == true {
		return
	}
	log.Printf("a phone connected during the pairing window; asking it to pair")
	if err := dev.Call(ifDevice+".Pair", 0).Err; err != nil {
		log.Printf("pair: %v", err)
	}
}
