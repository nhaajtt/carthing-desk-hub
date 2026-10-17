# Security model

The rule for the whole project: **trust nothing by default, give everything the least it needs, and say exactly what can reach what.**

## Threat model

The Car Thing is treated as **untrusted**:

* Nocturne's root password is public (`nocturne`) and SSH is on by default.
* Chromium runs with `--no-sandbox`, so a renderer bug is a root shell.
* The screen shows text and images that come from the internet (headlines, album art).
* It is a portable device that can be lost or plugged in by someone else.

So the Car Thing must not hold secrets, must not reach anything except the hub, and the hub must not trust what the Car Thing sends beyond a short list of actions.

## Controls

| Layer | Control |
|---|---|
| **Car Thing → network** | Point-to-point USB link. UFW `DOCKER-USER` rules on the brain's USB interface allow only the hub port; NTP is the only other allowed packet. No forwarding to the LAN or the internet. |
| **Car Thing → brain config** | The brain takes a static address on the USB link and accepts no routes, DNS or IPv6 from the device (`accept-ra: false`, `link-local: []`). |
| **Car Thing access** | Root SSH by key only, from the brain only (`PasswordAuthentication no`, `PermitEmptyPasswords no`). |
| **Secrets** | Gemini key, Spotify refresh token and the ingest token live only in the hub's `.env` / `state/` (mode 600). The Car Thing never sees them. Spotify uses PKCE, so there is no client secret at all. |
| **Hub container** | `read_only`, `cap_drop: ALL`, `no-new-privileges`, non-root user, memory and PID limits, no `docker.sock`. |
| **Docker visibility** | Only the `docker-status` sidecar mounts `docker.sock` (read-only), answers a single `GET /` with names and states, and has no host port. |
| **Actions** | State-changing endpoints (brightness, Mei, Spotify controls, reboot / power off) accept requests only from the Car Thing's address. |
| **Server-1 agent** | Push only, no listening ports. The hub requires both the source address and a bearer token (constant-time comparison). |
| **Spotify linking** | One-time `state`, 10-minute expiry, never started from the Car Thing; the callback stays on loopback through an SSH tunnel. |
| **Album art proxy** | Only `https://i.scdn.co/`. |
| **Inbound internet** | None. Every integration is an outbound request. |

## Two traps worth knowing

1. **Binding to a LAN address is not isolation.** Linux uses the weak host model: a packet for any of the host's addresses is accepted on any interface. A device behind the USB link can still reach the LAN address. Only per-interface firewall rules stop it.
2. **Docker-published ports skip UFW's INPUT rules.** Docker inserts its own `FORWARD` / `DOCKER` chains. Rules for published ports belong in `DOCKER-USER`.

## Privacy

* Mei sends your recorded question and the dashboard snapshot to the Gemini API. On Google's free tier, inputs may be used to improve Google's products. Do not ask Mei anything sensitive, or use a paid tier.
* Story summaries send the article text to Gemini in the same way.
* Recordings are not stored: the Car Thing deletes the WAV after upload, and the hub keeps it in memory only for the request.

## Reporting

Found something? Open an issue without exploit details, and I will follow up.
