package main

// The light sensor next to the screen (TMD2772): the page turns to its night colours when the cabin or the room
// is dark. Read every 2 s; it only counts as a change after 10 s on the other side, with a gap between the two
// levels, so headlights passing or a hand over the sensor do not flip the screen.

import (
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	luxFile    = "/sys/bus/iio/devices/iio:device0/in_illuminance0_input"
	darkBelow  = 3  // lux; a lit room at night reads about 2-5 here, the sensor sits behind dark glass
	lightAbove = 12 // lux
)

func watchLight() {
	var since time.Time
	for ; ; time.Sleep(2 * time.Second) {
		b, err := os.ReadFile(luxFile)
		if err != nil {
			continue
		}
		lux, err := strconv.Atoi(strings.TrimSpace(string(b)))
		if err != nil {
			continue
		}
		mu.Lock()
		dark := st.Dark
		st.Lux = lux // not sent on its own: it rides along with the next change
		mu.Unlock()
		flip := dark && lux > lightAbove || !dark && lux < darkBelow
		if !flip {
			since = time.Time{}
			continue
		}
		if since.IsZero() {
			since = time.Now()
		}
		if time.Since(since) >= 10*time.Second {
			since = time.Time{}
			update(func(s *State) { s.Dark = !dark; s.Lux = lux })
		}
	}
}
