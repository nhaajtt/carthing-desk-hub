package main

// In the car nothing tells the Car Thing the time (it normally asks server 2 over NTP). The iPhone offers its
// clock to accessories (Current Time Service): read it once per connection and set the system clock when it
// is more than a few seconds off. At the desk NTP keeps the clock right, so this rarely changes anything.

import (
	"encoding/binary"
	"log"
	"time"

	"github.com/godbus/dbus/v5"
	"golang.org/x/sys/unix"
)

const (
	ctsCurrent   = "00002a2b-0000-1000-8000-00805f9b34fb" // local date and time
	ctsLocalInfo = "00002a0f-0000-1000-8000-00805f9b34fb" // time zone and daylight saving offset
	ctsSlack     = 5 * time.Second
)

var ctsDone bool // under setupMu: once per connection

func syncTime(cur, info dbus.ObjectPath) {
	b, err := read(cur)
	if err != nil || len(b) < 7 {
		log.Printf("time: %v", err)
		return
	}
	li, err := read(info)
	if err != nil || len(li) < 2 {
		log.Printf("time: no time zone from the iPhone: %v", err)
		return
	}
	local := time.Date(int(binary.LittleEndian.Uint16(b)), time.Month(b[2]), int(b[3]), int(b[4]), int(b[5]), int(b[6]), 0, time.UTC)
	if local.Year() < 2020 {
		return
	}
	// the phone's clock is local time: take off its time zone (quarter hours) and daylight saving
	offset := time.Duration(int8(li[0])) * 15 * time.Minute
	switch li[1] {
	case 2:
		offset += 30 * time.Minute
	case 4:
		offset += time.Hour
	case 8:
		offset += 2 * time.Hour
	}
	phone := local.Add(-offset)
	diff := phone.Sub(time.Now())
	if diff.Abs() < ctsSlack {
		return
	}
	tv := unix.NsecToTimeval(phone.UnixNano())
	if err := unix.Settimeofday(&tv); err != nil {
		log.Printf("time: %v", err)
		return
	}
	log.Printf("time: set from the iPhone (%+.0fs)", diff.Seconds())
}
