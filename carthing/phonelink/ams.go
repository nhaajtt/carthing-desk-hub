package main

// AMS, the Apple Media Service: whatever app is playing on the iPhone (Music, Spotify, YouTube, a podcast)
// reports its track and play state here, and accepts play / pause / next / previous / volume.
// The sound itself stays on the phone; nothing is streamed.

import (
	"errors"
	"log"
	"strconv"
	"strings"

	"github.com/godbus/dbus/v5"
)

const (
	amsRemote = "9b3c81d8-57b1-4a8a-b8df-0e56f7ca51c2"
	amsUpdate = "2f7cabce-808d-411f-9a0c-bb92ba96c102"
	amsAttr   = "c6b2f38c-23ab-46d8-a6ab-a3a870bbd5d7"

	entPlayer, entQueue, entTrack = 0, 1, 2
	flagTruncated                 = 1
)

var (
	amsRemoteP, amsUpdateP, amsAttrP dbus.ObjectPath // under setupMu
	amsOn                            bool
)

func startAMS(chars map[string]dbus.ObjectPath) bool {
	if amsOn {
		return true
	}
	rc, eu, ea := chars[amsRemote], chars[amsUpdate], chars[amsAttr]
	if rc == "" || eu == "" {
		return false
	}
	if err := notify(rc, func(b []byte) {
		cmds := make([]int, len(b))
		for i, c := range b {
			cmds[i] = int(c)
		}
		update(func(s *State) { media(s).Cmds = cmds })
	}); err != nil {
		log.Printf("ams remote: %v", err)
		return false
	}
	if err := notify(eu, func(b []byte) {
		if len(b) < 3 {
			return
		}
		ent, attr, val := b[0], b[1], clean(b[3:])
		if b[2]&flagTruncated != 0 && ea != "" {
			// long titles arrive cut; the full text can be read separately (off the signal loop)
			go func() {
				if write(ea, []byte{ent, attr}) == nil {
					if full, err := read(ea); err == nil {
						setMedia(ent, attr, clean(full))
					}
				}
			}()
		}
		setMedia(ent, attr, val)
	}); err != nil {
		log.Printf("ams update: %v", err)
		return false
	}
	// player: name, playback info, volume. track: artist, album, title, duration
	if err := write(eu, []byte{entPlayer, 0, 1, 2}); err != nil {
		log.Printf("ams subscribe: %v", err)
	}
	write(eu, []byte{entTrack, 0, 1, 2, 3})
	write(eu, []byte{entQueue, 0, 1, 2, 3}) // position, length, shuffle, repeat
	amsRemoteP, amsUpdateP, amsAttrP, amsOn = rc, eu, ea, true
	log.Printf("media: on")
	return true
}

func stopAMS() {
	amsOn = false
	amsRemoteP, amsUpdateP, amsAttrP = "", "", ""
}

func media(s *State) *Media {
	if s.Media == nil {
		s.Media = &Media{Cmds: []int{}}
	}
	return s.Media
}

func setMedia(ent, attr byte, v string) {
	update(func(s *State) {
		m := media(s)
		switch {
		case ent == entPlayer && attr == 0:
			m.App = v
		case ent == entPlayer && attr == 1: // "state,rate,elapsed"
			p := strings.Split(v, ",")
			if len(p) == 3 {
				m.State, _ = strconv.Atoi(p[0])
				m.Rate, _ = strconv.ParseFloat(p[1], 64)
				m.Elapsed, _ = strconv.ParseFloat(p[2], 64)
				m.At = nowMs()
			}
		case ent == entPlayer && attr == 2:
			m.Volume, _ = strconv.ParseFloat(v, 64)
		case ent == entQueue:
			n, _ := strconv.Atoi(v)
			switch attr {
			case 0:
				m.Queue.Index = n
			case 1:
				m.Queue.Count = n
			case 2:
				m.Queue.Shuffle = n
			case 3:
				m.Queue.Repeat = n
			}
		case ent == entTrack && attr == 0:
			m.Artist = v
		case ent == entTrack && attr == 1:
			m.Album = v
		case ent == entTrack && attr == 2:
			m.Title = v
		case ent == entTrack && attr == 3:
			m.Duration, _ = strconv.ParseFloat(v, 64)
		}
	})
}

// commands: 0 play, 1 pause, 2 play/pause, 3 next, 4 previous, 5 volume up, 6 volume down,
// 7 next repeat mode, 8 next shuffle mode
func mediaCommand(c byte) error {
	setupMu.Lock()
	rc := amsRemoteP
	setupMu.Unlock()
	if rc == "" {
		return errNoMedia
	}
	go write(rc, []byte{c})
	return nil
}

var errNoMedia = errors.New("nothing is playing on the phone")
