package main

// Is the phone at the desk? BlueZ publishes a device's signal strength only while scanning, not for a phone
// that is connected, so it is read from the kernel's Bluetooth management interface. The only command ever
// sent on that socket is "Get Connection Information", a read.

import (
	"encoding/binary"
	"fmt"
	"log"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

const (
	mgmtGetConnInfo = 0x0031
	mgmtCmdComplete = 0x0001
	mgmtCmdStatus   = 0x0002
	hciDevNone      = 0xffff
	signalEvery     = 2 * time.Second
	nearAfter       = 4 * time.Second  // strong for this long: arrived
	awayAfter       = 20 * time.Second // weak for this long: left
	addrLEPublic    = 1
	addrLERandom    = 2
)

var nearDBm, farDBm int // set from flags (main.go)

// connInfo asks the kernel for the link's RSSI to one LE address on hci0
func connInfo(fd int, addr string, random bool) (int, error) {
	parts := strings.Split(addr, ":")
	if len(parts) != 6 {
		return 0, fmt.Errorf("bad address")
	}
	req := make([]byte, 6+7)
	binary.LittleEndian.PutUint16(req[0:], mgmtGetConnInfo)
	binary.LittleEndian.PutUint16(req[2:], 0) // hci0
	binary.LittleEndian.PutUint16(req[4:], 7)
	for i := 0; i < 6; i++ { // the address goes least significant byte first
		var b byte
		fmt.Sscanf(parts[5-i], "%02X", &b)
		req[6+i] = b
	}
	req[12] = addrLEPublic
	if random {
		req[12] = addrLERandom
	}
	if _, err := unix.Write(fd, req); err != nil {
		return 0, err
	}
	// other management events arrive on the same socket; wait for the answer to ours
	buf := make([]byte, 512)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		n, err := unix.Read(fd, buf)
		if err != nil {
			return 0, err
		}
		if n < 9 {
			continue
		}
		ev, op := binary.LittleEndian.Uint16(buf[0:]), binary.LittleEndian.Uint16(buf[6:])
		if (ev != mgmtCmdComplete && ev != mgmtCmdStatus) || op != mgmtGetConnInfo {
			continue
		}
		if status := buf[8]; status != 0 || n < 9+7+1 {
			return 0, fmt.Errorf("status %d", buf[8])
		}
		return int(int8(buf[9+7])), nil
	}
	return 0, fmt.Errorf("no answer")
}

func openMgmt() (int, error) {
	fd, err := unix.Socket(unix.AF_BLUETOOTH, unix.SOCK_RAW|unix.SOCK_CLOEXEC, unix.BTPROTO_HCI)
	if err != nil {
		return -1, err
	}
	if err := unix.Bind(fd, &unix.SockaddrHCI{Dev: hciDevNone, Channel: unix.HCI_CHANNEL_CONTROL}); err != nil {
		unix.Close(fd)
		return -1, err
	}
	tv := unix.Timeval{Sec: 1}
	unix.SetsockoptTimeval(fd, unix.SOL_SOCKET, unix.SO_RCVTIMEO, &tv)
	return fd, nil
}

// watchSignal polls the connected phone's signal and turns it into "near" with some patience either way,
// so a hand over the phone or a turn of the head does not switch the screen off
func watchSignal() {
	fd := -1
	var avg float64
	var strongSince, weakSince time.Time
	last := 0
	for range time.Tick(signalEvery) {
		mu.Lock()
		path, connected, near := phonePath, st.Connected, st.Near
		mu.Unlock()
		if !connected || path == "" {
			avg, strongSince, weakSince = 0, time.Time{}, time.Time{}
			if near {
				update(func(s *State) { s.Near, s.RSSI = false, nil })
			}
			continue
		}
		if fd < 0 {
			var err error
			if fd, err = openMgmt(); err != nil {
				log.Printf("signal: %v", err)
				continue
			}
		}
		dev := conn.Object(bluez, path)
		var addr, kind string
		if v, err := dev.GetProperty(ifDevice + ".Address"); err == nil {
			addr, _ = v.Value().(string)
		}
		if v, err := dev.GetProperty(ifDevice + ".AddressType"); err == nil {
			kind, _ = v.Value().(string)
		}
		rssi, err := connInfo(fd, addr, kind == "random")
		if err != nil {
			unix.Close(fd)
			fd = -1
			continue
		}
		if avg == 0 {
			avg = float64(rssi)
		} else {
			avg = 0.7*avg + 0.3*float64(rssi)
		}
		now := time.Now()
		switch {
		case avg >= float64(nearDBm):
			weakSince = time.Time{}
			if strongSince.IsZero() {
				strongSince = now
			}
		case avg <= float64(farDBm):
			strongSince = time.Time{}
			if weakSince.IsZero() {
				weakSince = now
			}
		default:
			strongSince, weakSince = time.Time{}, time.Time{}
		}
		if !near && !strongSince.IsZero() && now.Sub(strongSince) >= nearAfter {
			near = true
		}
		if near && !weakSince.IsZero() && now.Sub(weakSince) >= awayAfter {
			near = false
		}
		// the screen only needs to hear about real changes
		r := int(avg - 0.5)
		if r-last >= 2 || last-r >= 2 || near != st.Near {
			last = r
			update(func(s *State) { s.RSSI, s.Near = &r, near })
		}
	}
}
