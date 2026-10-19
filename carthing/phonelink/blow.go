package main

// Blowing into the Car Thing relights the desk clock's torch. While the page asks for it (the fire is out, or
// was just blown back to life), this reads the microphones and sends the screen one number, how hard someone
// is blowing (0..1), over a loopback event stream. Nothing is recorded or kept: each 40 ms of sound becomes
// a level and is dropped. nocturned keeps the microphones open for its wake word, so it is paused meanwhile
// and started again afterwards, the same as when the Ask page records.
//
// The same levels also find taps (clap.go): short, sharp sounds such as a knock on the desk or a clap. That
// keeps the microphones open for as long as the page has tap control switched on.

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

const (
	blowMic     = "hw:0,0" // the four real microphones: 16 kHz, 4 channels, 32-bit
	blowWindow  = 640      // frames per level, 40 ms
	blowHold    = 8 * time.Second
	blowSustain = 6 // windows in a row (240 ms) before a loud sound counts as blowing, not a word or a knock
)

var (
	blowMu       sync.Mutex
	blowCmd      *exec.Cmd
	blowUntil    time.Time
	clapUntil    time.Time
	blowNocturne bool // we paused nocturned and owe it a restart
	blowSubs     = map[chan float64]bool{}
)

// listen keeps the microphones open for blowHold more; the page repeats it while it wants levels
func blowListen(on bool) error {
	blowMu.Lock()
	defer blowMu.Unlock()
	if !on {
		blowUntil = time.Time{}
		if !micWanted() {
			blowStopLocked()
		}
		return nil
	}
	blowUntil = time.Now().Add(blowHold)
	return micStartLocked()
}

// the microphones are wanted while blowing or tap control asked for them recently; under blowMu
func micWanted() bool {
	now := time.Now()
	return now.Before(blowUntil) || now.Before(clapUntil)
}

// micBusyFile is made by voice-agent.sh while the Ask page records: then the microphones are its own. A file
// older than a minute is left over from a recorder that died (recordings last 15 s at most) and is ignored.
const micBusyFile = "/run/hub-mic-busy"

func micBusy() bool {
	fi, err := os.Stat(micBusyFile)
	return err == nil && time.Since(fi.ModTime()) < time.Minute
}

func micStartLocked() error {
	if blowCmd != nil {
		return nil
	}
	if micBusy() {
		return nil // micKeeper (clap.go) starts again once the recording is over
	}
	if exec.Command("systemctl", "is-active", "--quiet", "nocturned").Run() == nil {
		exec.Command("systemctl", "stop", "nocturned").Run()
		blowNocturne = true
	}
	cmd := exec.Command("arecord", "-q", "-D", blowMic, "-f", "S32_LE", "-c", "4", "-r", "16000", "-t", "raw")
	out, err := cmd.StdoutPipe()
	if err == nil {
		err = cmd.Start()
	}
	if err != nil {
		blowStopLocked()
		return fmt.Errorf("microphone: %v", err)
	}
	blowCmd = cmd
	log.Printf("blow: listening")
	go blowRead(cmd, out)
	return nil
}

// blowOnExit gives nocturned back its microphones if phonelink is stopped while listening
func blowOnExit() {
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	go func() {
		<-c
		blowListen(false)
		os.Exit(0)
	}()
}

func blowStopLocked() {
	if blowCmd != nil {
		blowCmd.Process.Kill()
		blowCmd = nil
		log.Printf("blow: stopped")
	}
	if blowNocturne {
		exec.Command("systemctl", "start", "--no-block", "nocturned").Run()
		blowNocturne = false
	}
	blowSend(0)
}

// blowRead turns the sound into levels: the loudness of each window in dB, against a slowly learnt floor of
// the room's own noise. Blowing straight into the microphones is far louder than the room and lasts.
func blowRead(cmd *exec.Cmd, out io.Reader) {
	defer cmd.Wait()
	r := bufio.NewReaderSize(out, 64*1024)
	buf := make([]byte, blowWindow*4*4)
	floor, loud, last, n, peak := -60.0, 0, -1.0, 0, -200.0
	for {
		if _, err := io.ReadFull(r, buf); err != nil {
			blowMu.Lock()
			if blowCmd == cmd {
				blowCmd = nil
				blowStopLocked()
			}
			blowMu.Unlock()
			return
		}
		var sum float64
		for i := 0; i < len(buf); i += 4 {
			v := float64(int32(binary.LittleEndian.Uint32(buf[i:]))) / (1 << 31)
			sum += v * v
		}
		db := 10 * math.Log10(sum/float64(blowWindow*4)+1e-12)
		// two lines for tuning: the room once it is learnt, and how loud each puff was
		if n++; n == 75 {
			log.Printf("blow: room %.0f dB", floor)
		}
		level := (db - math.Max(floor+25, -34)) / 20
		if level > 0 {
			loud++
		} else {
			loud = 0
			// only a quiet room teaches the floor: the tail of a puff would raise it and make the next one count less
			if db < floor+8 {
				floor = math.Min(-45, floor*0.97+db*0.03)
			}
		}
		if loud < blowSustain {
			level = 0
		}
		if level > 0 {
			peak = math.Max(peak, db)
		} else if peak > -200 {
			log.Printf("blow: puff, peak %.0f dB over a %.0f dB room", peak, floor)
			peak = -200
		}
		level = math.Min(1, math.Max(0, level))
		blowMu.Lock()
		tapWindow(db, floor)
		if time.Now().Before(blowUntil) && math.Abs(level-last) > 0.02 {
			blowSend(level)
			last = level
		}
		if !time.Now().Before(blowUntil) && last > 0 {
			blowSend(0)
			last = 0
		}
		busy := micBusy()
		expired := blowCmd == cmd && (!micWanted() || busy)
		if expired {
			if busy {
				blowNocturne = false // the voice agent has paused nocturned itself and starts it again
			}
			blowStopLocked()
		}
		blowMu.Unlock()
		if expired {
			return
		}
	}
}

func blowSend(level float64) { // under blowMu
	for c := range blowSubs {
		select {
		case c <- level:
		default:
		}
	}
}

// GET /blow/events: one "data: <level>" line per change, only while listening
func blowEvents(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no streaming", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	c := make(chan float64, 8)
	blowMu.Lock()
	blowSubs[c] = true
	blowMu.Unlock()
	defer func() { blowMu.Lock(); delete(blowSubs, c); blowMu.Unlock() }()
	io.WriteString(w, ": ok\n\n")
	fl.Flush()
	hb := time.NewTicker(15 * time.Second)
	defer hb.Stop()
	for {
		select {
		case v := <-c:
			fmt.Fprintf(w, "data: %.2f\n\n", v)
		case <-hb.C:
			io.WriteString(w, ": hb\n\n")
		case <-r.Context().Done():
			return
		}
		fl.Flush()
	}
}
