package main

// Since iOS 18, Settings → Bluetooth no longer lists accessories that only ask for notifications, but it still
// lists Bluetooth remotes. So the Car Thing also presents itself as a media remote (HID over GATT, consumer
// controls only: no keyboard, so the iPhone keeps its on-screen keyboard). Its report map can only be read over
// an authenticated (code-paired) link. Two keys are ever sent, and only while a button is held on the iPhone
// page: Siri (voice command) and volume up, which takes a photo in the Camera app.

import (
	"fmt"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/prop"
)

const (
	appPath    = dbus.ObjectPath("/org/deskhub/phonelink/app")
	hidService = "00001812-0000-1000-8000-00805f9b34fb"
	ifService  = "org.bluez.GattService1"
	ifDesc     = "org.bluez.GattDescriptor1"
)

// consumer control, report 1: play/pause, next, previous, volume up, volume down, mute, voice command,
// 1 bit padding. The bit numbers below follow this order.
var reportMap = []byte{
	0x05, 0x0c, 0x09, 0x01, 0xa1, 0x01, 0x85, 0x01,
	0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x07,
	0x09, 0xcd, 0x09, 0xb5, 0x09, 0xb6, 0x09, 0xe9, 0x09, 0xea, 0x09, 0xe2, 0x09, 0xcf,
	0x81, 0x02, 0x95, 0x01, 0x81, 0x03, 0xc0,
}

const (
	keyPlayPause = 0
	keyVolumeUp  = 3
	keyVolDown   = 4
	keySiri      = 6
	keyHoldMax   = 10 * time.Second // a key the page forgot to release lets go by itself
)

var (
	reportProps *prop.Properties
	keyMu       sync.Mutex
	keyBits     byte
	keyTimer    *time.Timer
)

// sendKey presses or releases one key on the remote; the phone gets the new report as a notification
func sendKey(bit uint, down bool) error {
	if reportProps == nil {
		return fmt.Errorf("remote not ready")
	}
	mu.Lock()
	connected := st.Connected
	mu.Unlock()
	if !connected {
		return fmt.Errorf("iPhone not connected")
	}
	keyMu.Lock()
	defer keyMu.Unlock()
	if down {
		keyBits |= 1 << bit
	} else {
		keyBits &^= 1 << bit
	}
	if keyTimer != nil {
		keyTimer.Stop()
	}
	if keyBits != 0 {
		keyTimer = time.AfterFunc(keyHoldMax, func() { sendKey(bit, false) })
	}
	reportProps.SetMust(ifChar, "Value", []byte{keyBits})
	return nil
}

type gattObj struct {
	path  dbus.ObjectPath
	iface string
	props map[string]any
	value []byte
}

func (o *gattObj) ReadValue(map[string]dbus.Variant) ([]byte, *dbus.Error) { return o.value, nil }
func (o *gattObj) WriteValue([]byte, map[string]dbus.Variant) *dbus.Error  { return nil }
func (o *gattObj) StartNotify() *dbus.Error                                { return nil }
func (o *gattObj) StopNotify() *dbus.Error                                 { return nil }

type gattApp []*gattObj

func (a gattApp) GetManagedObjects() (map[dbus.ObjectPath]map[string]map[string]dbus.Variant, *dbus.Error) {
	out := map[dbus.ObjectPath]map[string]map[string]dbus.Variant{}
	for _, o := range a {
		p := map[string]dbus.Variant{}
		for k, v := range o.props {
			p[k] = dbus.MakeVariant(v)
		}
		out[o.path] = map[string]map[string]dbus.Variant{o.iface: p}
	}
	return out, nil
}

var gatt gattApp

func exportGatt() error {
	svc := appPath + "/hid"
	char := func(n, uuid string, flags []string, v []byte) *gattObj {
		return &gattObj{path: svc + dbus.ObjectPath("/"+n), iface: ifChar, value: v,
			props: map[string]any{"UUID": uuid, "Service": svc, "Flags": flags}}
	}
	report := char("report", "00002a4d-0000-1000-8000-00805f9b34fb", []string{"encrypt-authenticated-read", "notify"}, []byte{0})
	gatt = gattApp{
		{path: svc, iface: ifService, props: map[string]any{"UUID": hidService, "Primary": true}},
		char("info", "00002a4a-0000-1000-8000-00805f9b34fb", []string{"read"}, []byte{0x11, 0x01, 0x00, 0x02}),
		char("map", "00002a4b-0000-1000-8000-00805f9b34fb", []string{"encrypt-authenticated-read"}, reportMap),
		char("control", "00002a4c-0000-1000-8000-00805f9b34fb", []string{"write-without-response"}, nil),
		char("mode", "00002a4e-0000-1000-8000-00805f9b34fb", []string{"read", "write-without-response"}, []byte{0x01}),
		report,
		{path: report.path + "/ref", iface: ifDesc, value: []byte{0x01, 0x01}, // report 1, input
			props: map[string]any{"UUID": "00002908-0000-1000-8000-00805f9b34fb", "Characteristic": report.path, "Flags": []string{"encrypt-authenticated-read"}}},
	}
	if err := conn.Export(gatt, appPath, "org.freedesktop.DBus.ObjectManager"); err != nil {
		return err
	}
	for _, o := range gatt {
		if o.iface != ifService {
			if err := conn.Export(o, o.path, o.iface); err != nil {
				return err
			}
		}
		m := prop.Map{o.iface: {}}
		for k, v := range o.props {
			m[o.iface][k] = &prop.Prop{Value: v}
		}
		if o == report {
			// a changed Value is what BlueZ sends to the phone as a key report
			m[o.iface]["Value"] = &prop.Prop{Value: []byte{0}, Emit: prop.EmitTrue}
		}
		p, err := prop.Export(conn, o.path, m)
		if err != nil {
			return err
		}
		if o == report {
			reportProps = p
		}
	}
	return nil
}

func registerGatt() error {
	return conn.Object(bluez, adapterPath).Call("org.bluez.GattManager1.RegisterApplication", 0, appPath, map[string]dbus.Variant{}).Err
}
