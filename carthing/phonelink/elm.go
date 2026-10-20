package main

// The ELM327 protocol spoken by cheap OBD-II readers: text commands ending in "\r", answers ending in ">".
// Only the commands below are ever sent. All of them read: nothing here can clear a fault code, change a setting
// in the car or reach any module other than through standard mode 01 (live data) and mode 03 (stored codes).
// Everything the reader sends back is treated as untrusted text: size-capped and parsed defensively.

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var elmAllowed = map[string]bool{
	"ATZ": true, "ATI": true, "ATE0": true, "ATL0": true, "ATS0": true, "ATH0": true, "ATAT1": true, "ATSP0": true,
	"ATRV": true, "ATDPN": true, "03": true,
}

var mode01 = regexp.MustCompile(`^01[0-9A-F]{2}$`)

func elmCommandAllowed(c string) bool { return elmAllowed[c] || mode01.MatchString(c) }

var (
	errElmTimeout = errors.New("the reader did not answer")
	errElmNoData  = errors.New("no data")
	errElmNoCar   = errors.New("the car does not answer")
)

const elmMaxReply = 4096

// elm talks to one reader. send writes bytes to it; in carries what it notifies back, in whatever pieces BLE
// delivers them.
type elm struct {
	send func([]byte) error
	in   chan []byte
}

// cmd sends one allowed command and returns its answer, cleaned: no echo, no prompt, lines in order
func (e *elm) cmd(c string, timeout time.Duration) ([]string, error) {
	if !elmCommandAllowed(c) {
		return nil, fmt.Errorf("command %q is not on the allow-list", c)
	}
	// whatever is still on the way from an earlier command that timed out belongs to that one
	for len(e.in) > 0 {
		<-e.in
	}
	if err := e.send([]byte(c + "\r")); err != nil {
		return nil, err
	}
	var buf []byte
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		select {
		case b := <-e.in:
			if len(buf)+len(b) > elmMaxReply {
				return nil, fmt.Errorf("the reader sent too much")
			}
			buf = append(buf, b...)
			if i := strings.IndexByte(string(buf), '>'); i >= 0 {
				return elmLines(string(buf[:i]), c), nil
			}
		case <-deadline.C:
			return nil, errElmTimeout
		}
	}
}

// elmLines splits an answer into its lines, dropping the echoed command, spaces, NULs and the search notice
func elmLines(s, sent string) []string {
	var out []string
	for _, l := range strings.FieldsFunc(s, func(r rune) bool { return r == '\r' || r == '\n' }) {
		l = strings.Map(func(r rune) rune {
			if r == ' ' || r == 0 || r == '\t' {
				return -1
			}
			if r < 32 || r > 126 {
				return -1
			}
			return r
		}, l)
		l = strings.ToUpper(l)
		if l == "" || l == sent || strings.HasPrefix(l, "SEARCHING") || l == "BUSINIT:...OK" {
			continue
		}
		out = append(out, l)
	}
	return out
}

// elmProblem says what a mode 01 or 03 answer means when it carries no data
func elmProblem(lines []string) error {
	for _, l := range lines {
		switch {
		case l == "NODATA":
			return errElmNoData
		case strings.Contains(l, "UNABLETOCONNECT"), strings.Contains(l, "BUSINIT"), strings.Contains(l, "BUSERROR"),
			strings.Contains(l, "CANERROR"), l == "STOPPED", strings.Contains(l, "ERROR"), l == "?":
			return errElmNoCar
		}
	}
	return nil
}

func isHex(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

func hexBytes(s string) []byte {
	if len(s)%2 == 1 {
		s = s[:len(s)-1]
	}
	b := make([]byte, 0, len(s)/2)
	for i := 0; i+1 < len(s); i += 2 {
		v, err := strconv.ParseUint(s[i:i+2], 16, 8)
		if err != nil {
			return nil
		}
		b = append(b, byte(v))
	}
	return b
}

// pidData finds the data bytes of a mode 01 answer for pid: the first line that starts with 41 <pid>
func pidData(lines []string, pid byte) ([]byte, error) {
	if err := elmProblem(lines); err != nil {
		return nil, err
	}
	want := fmt.Sprintf("41%02X", pid)
	for _, l := range lines {
		// a CAN answer from a reader with frame numbers on ("0:4100...") has them stripped
		if len(l) > 2 && l[1] == ':' {
			l = l[2:]
		}
		if strings.HasPrefix(l, want) && isHex(l) {
			return hexBytes(l[4:]), nil
		}
	}
	return nil, errElmNoData
}

// pidValue turns the data of one live-data PID into a number in metric units
type pidSpec struct {
	key  string
	n    int // data bytes needed
	calc func(b []byte) float64
}

var pids = map[byte]pidSpec{
	0x04: {"load", 1, func(b []byte) float64 { return float64(b[0]) * 100 / 255 }},
	0x05: {"coolant", 1, func(b []byte) float64 { return float64(b[0]) - 40 }},
	0x0C: {"rpm", 2, func(b []byte) float64 { return float64(int(b[0])<<8|int(b[1])) / 4 }},
	0x0D: {"speed", 1, func(b []byte) float64 { return float64(b[0]) }},
	0x0F: {"intake", 1, func(b []byte) float64 { return float64(b[0]) - 40 }},
	0x10: {"maf", 2, func(b []byte) float64 { return float64(int(b[0])<<8|int(b[1])) / 100 }},
	0x11: {"throttle", 1, func(b []byte) float64 { return float64(b[0]) * 100 / 255 }},
	0x1F: {"runtime", 2, func(b []byte) float64 { return float64(int(b[0])<<8 | int(b[1])) }},
	0x2F: {"fuel", 1, func(b []byte) float64 { return float64(b[0]) * 100 / 255 }},
	0x42: {"module", 2, func(b []byte) float64 { return float64(int(b[0])<<8|int(b[1])) / 1000 }},
	0x46: {"ambient", 1, func(b []byte) float64 { return float64(b[0]) - 40 }},
	0x5C: {"oil", 1, func(b []byte) float64 { return float64(b[0]) - 40 }},
	0x5E: {"fuelrate", 2, func(b []byte) float64 { return float64(int(b[0])<<8|int(b[1])) / 20 }},
}

func pidValue(pid byte, b []byte) (string, float64, bool) {
	p, ok := pids[pid]
	if !ok || len(b) < p.n {
		return "", 0, false
	}
	return p.key, p.calc(b), true
}

// supportedPIDs reads the bitmap answer of 0100, 0120, 0140...: bit 0 of the first byte is base+1
func supportedPIDs(base byte, b []byte) []byte {
	var out []byte
	for i := 0; i < 32 && i/8 < len(b); i++ {
		if b[i/8]&(0x80>>(i%8)) != 0 {
			out = append(out, base+byte(i)+1)
		}
	}
	return out
}

// monitorStatus reads 0101: the check-engine light and how many codes are stored
func monitorStatus(b []byte) (mil bool, count int) {
	if len(b) < 1 {
		return false, 0
	}
	return b[0]&0x80 != 0, int(b[0] & 0x7F)
}

// troubleCodes decodes a mode 03 answer. On CAN the frame says how many codes follow; long answers come in
// numbered frames after a length line. Older buses send three codes per line, padded with zeros.
func troubleCodes(lines []string, can bool) ([]string, error) {
	if err := elmProblem(lines); err != nil {
		if err == errElmNoData {
			return []string{}, nil // nothing stored
		}
		return nil, err
	}
	var msgs []string
	multi := ""
	for _, l := range lines {
		switch {
		case len(l) > 2 && l[1] == ':' && isHex(l[2:]):
			multi += l[2:]
		case len(l) == 3 && isHex(l): // the length line of a multi-frame answer
		case isHex(l):
			msgs = append(msgs, l)
		}
	}
	if multi != "" {
		msgs = append(msgs, multi)
	}
	seen := map[string]bool{}
	out := []string{}
	for _, m := range msgs {
		b := hexBytes(m)
		if len(b) < 1 || b[0] != 0x43 {
			continue
		}
		b = b[1:]
		if can && len(b) > 0 {
			n := int(b[0])
			b = b[1:]
			if len(b) > n*2 {
				b = b[:n*2]
			}
		}
		for i := 0; i+1 < len(b); i += 2 {
			if b[i] == 0 && b[i+1] == 0 {
				continue
			}
			c := dtcText(b[i], b[i+1])
			if !seen[c] && len(out) < 20 {
				seen[c] = true
				out = append(out, c)
			}
		}
	}
	return out, nil
}

// dtcText: the first two bits pick the system (Powertrain, Chassis, Body, network), then four digits
func dtcText(a, b byte) string {
	return fmt.Sprintf("%c%d%X%02X", "PCBU"[a>>6], (a>>4)&3, a&0x0F, b)
}

// protoIsCAN reads ATDPN ("A6" while automatic, "6".."C" for the CAN variants)
func protoIsCAN(lines []string) bool {
	if len(lines) == 0 {
		return false
	}
	p := strings.TrimPrefix(lines[0], "A")
	return len(p) == 1 && strings.Contains("6789ABC", p)
}

// voltsOf reads ATRV ("12.6V")
func voltsOf(lines []string) (float64, bool) {
	for _, l := range lines {
		l = strings.TrimSuffix(l, "V")
		if v, err := strconv.ParseFloat(l, 64); err == nil && v > 0 && v < 40 {
			return v, true
		}
	}
	return 0, false
}
