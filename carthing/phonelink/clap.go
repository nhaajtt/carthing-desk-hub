package main

// Tap control: two or three short, sharp sounds (knocks on the desk, claps) in a row become a command on the
// page: two play or pause the music, three turn the screen off or on. Only while the page has it switched on
// (it repeats POST /taps every few seconds); the sound is never kept, each 40 ms becomes one loudness number
// in blowRead and only the count of taps leaves this file.

import (
	"log"
	"math"
	"time"
)

const (
	tapOver   = 18                     // dB over the room's noise for a window to count as loud
	tapMinDB  = -40                    // and never quieter than this, so a silent room does not make whispers count
	tapMaxLen = 3                      // loud windows (120 ms) at most: longer is a word, music or blowing
	tapGap    = 700 * time.Millisecond // the next tap must come within this
	tapDone   = 800 * time.Millisecond // quiet after the last tap: the group is complete
	clapHold  = 10 * time.Second
)

type Tap struct {
	N  int   `json:"n"`
	At int64 `json:"at"`
}

var (
	tapLoud   int       // loud windows in a row
	tapQuiet  bool      // the window before the current sound was quiet: a sharp start
	tapCount  int       // taps in the group so far
	tapLast   time.Time // when the last one ended
	tapBroken bool      // something long and loud happened in this group: not a command
	tapPeak   = -200.0  // loudest window of the group, for the log (tuning tapOver and tapMinDB)
)

// clapListen keeps the microphones open for clapHold more; the page repeats it while tap control is on
func clapListen(on bool) error {
	blowMu.Lock()
	defer blowMu.Unlock()
	if !on {
		clapUntil = time.Time{}
		if !micWanted() {
			blowStopLocked()
		}
		return nil
	}
	clapUntil = time.Now().Add(clapHold)
	return micStartLocked()
}

// micKeeper starts the microphones again after the Ask page has finished recording, while they are still wanted
func micKeeper() {
	for range time.Tick(time.Second) {
		blowMu.Lock()
		if micWanted() && blowCmd == nil {
			micStartLocked()
		}
		blowMu.Unlock()
	}
}

// tapWindow gets every 40 ms window from blowRead, under blowMu
func tapWindow(db, floor float64) {
	if !time.Now().Before(clapUntil) {
		tapCount, tapLoud = 0, 0
		return
	}
	now := time.Now()
	loud := db > math.Max(floor+tapOver, tapMinDB)
	switch {
	case loud:
		if tapLoud == 0 && !tapQuiet {
			tapBroken = true // no clean start: part of something longer
		}
		tapLoud++
		tapPeak = math.Max(tapPeak, db)
		if tapLoud > tapMaxLen {
			tapBroken = true
		}
	case tapLoud > 0:
		if !tapBroken {
			if tapCount > 0 && now.Sub(tapLast) > tapGap {
				tapCount = 0
			}
			tapCount++
			tapLast = now
		}
		tapLoud = 0
	}
	tapQuiet = db < floor+tapOver/2
	if tapLoud == 0 && (tapCount > 0 || tapBroken) && now.Sub(tapLast) > tapDone {
		if !tapBroken {
			log.Printf("tap: %d, peak %.0f dB over a %.0f dB room", tapCount, tapPeak, floor)
		}
		if !tapBroken && (tapCount == 2 || tapCount == 3) {
			n := tapCount
			update(func(s *State) { s.Tap = &Tap{N: n, At: nowMs()} })
		}
		tapCount, tapBroken, tapPeak = 0, false, -200
	}
}
