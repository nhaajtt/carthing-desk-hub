package main

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

// fakeReader answers like an ELM327 clone: echo on until ATE0, answers split into small BLE-sized pieces
type fakeReader struct {
	echo    bool
	answers map[string]string
	sent    []string
	in      chan []byte
}

func newFake(answers map[string]string) (*fakeReader, *elm) {
	f := &fakeReader{echo: true, answers: answers, in: make(chan []byte, 64)}
	return f, &elm{in: f.in, send: f.write}
}

func (f *fakeReader) write(b []byte) error {
	c := strings.TrimSuffix(string(b), "\r")
	f.sent = append(f.sent, c)
	out := ""
	if f.echo {
		out = c + "\r"
	}
	if c == "ATE0" {
		f.echo = false
	}
	a, ok := f.answers[c]
	if !ok {
		a = "OK"
	}
	if a == "<silent>" {
		return nil
	}
	out += a + "\r\r>"
	for len(out) > 0 { // 7-byte pieces, as some readers notify
		n := min(len(out), 7)
		f.in <- []byte(out[:n])
		out = out[n:]
	}
	return nil
}

func TestCommandAllowList(t *testing.T) {
	for _, c := range []string{"ATZ", "ATRV", "010C", "0100", "03"} {
		if !elmCommandAllowed(c) {
			t.Errorf("%s should be allowed", c)
		}
	}
	// clearing codes (04), other modes, writing settings and free text never go out
	for _, c := range []string{"04", "0902", "ATPP 0C SV 01", "ATSH 7E0", "2E F1 90", "010C\r04", "AT Z", "01"} {
		if elmCommandAllowed(c) {
			t.Errorf("%q must not be allowed", c)
		}
	}
	_, e := newFake(nil)
	if _, err := e.cmd("04", time.Second); err == nil {
		t.Error("cmd sent a command that is not on the allow-list")
	}
}

func TestCmdPiecesEchoAndSearch(t *testing.T) {
	f, e := newFake(map[string]string{
		"ATZ":  "\r\rELM327 v1.5",
		"0100": "SEARCHING...\r41 00 BE 3F A8 13",
		"010C": "41 0C 1A F8\r41 0C 1A F0", // two engine modules answering
	})
	l, err := e.cmd("ATZ", time.Second)
	if err != nil || len(l) != 1 || l[0] != "ELM327V1.5" {
		t.Fatalf("ATZ: %v %q", err, l)
	}
	e.cmd("ATE0", time.Second)
	if f.echo {
		t.Fatal("echo still on")
	}
	l, err = e.cmd("0100", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	b, err := pidData(l, 0)
	if err != nil {
		t.Fatal(err)
	}
	got := supportedPIDs(0, b)
	for _, p := range []byte{0x01, 0x04, 0x05, 0x0C, 0x0D, 0x0F, 0x10, 0x11, 0x20} {
		if !containsByte(got, p) {
			t.Errorf("0x%02X missing from %X", p, got)
		}
	}
	l, _ = e.cmd("010C", time.Second)
	b, err = pidData(l, 0x0C)
	k, v, ok := pidValue(0x0C, b)
	if err != nil || !ok || k != "rpm" || v != 1726 {
		t.Errorf("rpm: %v %s %v", err, k, v)
	}
}

func TestTimeoutAndLateAnswer(t *testing.T) {
	_, e := newFake(map[string]string{"ATRV": "<silent>"})
	if _, err := e.cmd("ATRV", 50*time.Millisecond); err != errElmTimeout {
		t.Fatalf("want timeout, got %v", err)
	}
	// a late piece of an old answer is dropped before the next command
	e.in <- []byte("12.1V\r>")
	e.send = func(b []byte) error { e.in <- []byte("41 0D 3C\r>"); return nil }
	l, err := e.cmd("010D", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := pidData(l, 0x0D)
	if _, v, _ := pidValue(0x0D, b); v != 60 {
		t.Errorf("speed %v from %q", v, l)
	}
}

func TestTooMuch(t *testing.T) {
	_, e := newFake(nil)
	e.send = func([]byte) error {
		go func() {
			for i := 0; i < 100; i++ {
				e.in <- []byte(strings.Repeat("A", 60))
			}
		}()
		return nil
	}
	if _, err := e.cmd("ATRV", time.Second); err == nil || !strings.Contains(err.Error(), "too much") {
		t.Errorf("want too much, got %v", err)
	}
}

func TestProblems(t *testing.T) {
	cases := map[string]error{
		"NO DATA":              errElmNoData,
		"UNABLE TO CONNECT":    errElmNoCar,
		"BUS INIT: ...ERROR":   errElmNoCar,
		"CAN ERROR":            errElmNoCar,
		"STOPPED":              errElmNoCar,
		"?":                    errElmNoCar,
		"SEARCHING...\r410D00": nil,
	}
	for in, want := range cases {
		if got := elmProblem(elmLines(in, "010D")); got != want {
			t.Errorf("%q: %v, want %v", in, got, want)
		}
	}
}

func TestValues(t *testing.T) {
	cases := []struct {
		pid  byte
		data string
		key  string
		want float64
	}{
		{0x05, "7B", "coolant", 83},
		{0x0D, "64", "speed", 100},
		{0x11, "FF", "throttle", 100},
		{0x2F, "80", "fuel", 50.19607843137255},
		{0x42, "36B0", "module", 14},
		{0x10, "01F4", "maf", 5},
		{0x5E, "0064", "fuelrate", 5},
	}
	for _, c := range cases {
		k, v, ok := pidValue(c.pid, hexBytes(c.data))
		if !ok || k != c.key || v != c.want {
			t.Errorf("%02X %s: %s %v", c.pid, c.data, k, v)
		}
	}
	if _, _, ok := pidValue(0x0C, []byte{1}); ok {
		t.Error("short rpm accepted")
	}
	if _, _, ok := pidValue(0x99, []byte{1, 2}); ok {
		t.Error("unknown pid accepted")
	}
}

func TestTroubleCodes(t *testing.T) {
	cases := []struct {
		name string
		in   string
		can  bool
		want []string
	}{
		{"CAN, one frame", "43 02 01 33 04 20", true, []string{"P0133", "P0420"}},
		{"CAN, two modules", "43 01 01 33\r43 01 C1 00", true, []string{"P0133", "U0100"}},
		{"CAN, multi frame", "00A\r0: 43 04 01 33 04 20\r1: 44 01 81 22 00 00", true, []string{"P0133", "P0420", "C0401", "B0122"}},
		{"older bus, padded", "43 01 33 04 20 00 00", false, []string{"P0133", "P0420"}},
		{"nothing stored", "NO DATA", true, []string{}},
		{"CAN count larger than the data", "43 05 01 33", true, []string{"P0133"}},
	}
	for _, c := range cases {
		got, err := troubleCodes(elmLines(c.in, "03"), c.can)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: %v %v, want %v", c.name, got, err, c.want)
		}
	}
	if _, err := troubleCodes(elmLines("UNABLE TO CONNECT", "03"), true); err != errElmNoCar {
		t.Errorf("no car: %v", err)
	}
}

func TestMisc(t *testing.T) {
	if mil, n := monitorStatus([]byte{0x83, 0x07, 0xE5, 0x00}); !mil || n != 3 {
		t.Errorf("0101: %v %d", mil, n)
	}
	if !protoIsCAN([]string{"A6"}) || !protoIsCAN([]string{"7"}) || protoIsCAN([]string{"A3"}) {
		t.Error("protocol")
	}
	if v, ok := voltsOf([]string{"12.6V"}); !ok || v != 12.6 {
		t.Errorf("volts %v", v)
	}
	if _, ok := voltsOf([]string{"?"}); ok {
		t.Error("volts from ?")
	}
	if dtcText(0x01, 0x33) != "P0133" || dtcText(0xC1, 0x00) != "U0100" || dtcText(0x9F, 0xFF) != "B1FFF" {
		t.Error("dtc text")
	}
}

func TestReadLoop(t *testing.T) {
	_, e := newFake(map[string]string{
		"ATRV":  "12.4V",
		"0100":  "SEARCHING...\r4100 0818 8011", // 05; 0C and 0D; 11; 1C and 20 (more follow)
		"0120":  "4120 00000000",
		"ATDPN": "A6",
		"010C":  "410C 0FA0",
		"010D":  "410D 32",
		"0111":  "4111 33",
		"0105":  "4105 82",
		"0101":  "4101 8100",
		"03":    "4301 0420",
	})
	rounds := 0
	obd = OBD{State: "wait", V: map[string]float64{}, DTC: []string{}}
	obdRead(e, func() bool { rounds++; return rounds < 4 })
	if obd.State != "live" || obd.V["rpm"] != 1000 || obd.V["speed"] != 50 || obd.V["throttle"] != 20 || obd.V["coolant"] != 90 {
		t.Errorf("state %s values %v", obd.State, obd.V)
	}
	if !obd.MIL || !reflect.DeepEqual(obd.DTC, []string{"P0420"}) {
		t.Errorf("mil %v dtc %v", obd.MIL, obd.DTC)
	}
	if obd.Volts == nil || *obd.Volts != 12.4 {
		t.Errorf("volts %v", obd.Volts)
	}
}

func TestReaderNames(t *testing.T) {
	name := func(n string) map[string]dbus.Variant { return map[string]dbus.Variant{"Name": dbus.MakeVariant(n)} }
	for _, n := range []string{"OBDII", "OBDBLE", "IOS-Vlink", "V-LINK", "Vgate iCar Pro", "VEEPEAK", "OBDLink CX", "KONNWEI"} {
		if !looksLikeOBD(name(n)) {
			t.Errorf("%q should look like a reader", n)
		}
	}
	// gadgets with the same serial-port services, and no name at all
	for _, n := range []string{"LUNA 3", "Mi Band 7", "BT05", "HMSoft", ""} {
		if looksLikeOBD(name(n)) {
			t.Errorf("%q must not look like a reader", n)
		}
	}
	if !isELM([]string{"ELM327V1.5"}) || !isELM([]string{"STN2120V5.6.5"}) || isELM([]string{"OK"}) || isELM(nil) {
		t.Error("ATI answers")
	}
}

func containsByte(b []byte, x byte) bool {
	for _, v := range b {
		if v == x {
			return true
		}
	}
	return false
}
