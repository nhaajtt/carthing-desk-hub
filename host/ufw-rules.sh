#!/bin/sh
# UFW rules on the brain. LAN_IF is the wired LAN interface, CT_IF the Car Thing's USB interface.
# Default policy (already UFW's default): deny incoming, allow outgoing, deny routed.
set -eu
LAN_IF=${LAN_IF:-enxLAN}
CT_IF=${CT_IF:-enxCARTHING}
LAN=${LAN:-10.10.10.0/24}

ufw allow in on "$LAN_IF" from "$LAN" to any port 22 proto tcp comment "SSH from LAN"
# UniFi controller (only if you run one on this host)
ufw allow in on "$LAN_IF" from "$LAN" to any port 8080 proto tcp comment "UniFi device inform"
ufw allow in on "$LAN_IF" from "$LAN" to any port 8443 proto tcp comment "UniFi web UI"
ufw allow in on "$LAN_IF" from "$LAN" to any port 3478 proto udp comment "UniFi STUN"
ufw allow in on "$LAN_IF" from "$LAN" to any port 10001 proto udp comment "UniFi discovery"
# time for the Car Thing, USB link only
ufw allow in on "$CT_IF" from 10.42.1.0/29 to 10.42.1.6 port 123 proto udp comment "NTP for Car Thing"
ufw --force enable
