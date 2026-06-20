#!/bin/bash
set -euo pipefail

IPT=/usr/sbin/iptables
IP6T=/usr/sbin/ip6tables

# Tailscale forwarding is evaluated before DOCKER-USER.
# Block Portainer Edge port 8000 before ts-forward can accept it.
$IPT -w 5 -C FORWARD -i tailscale0 -p tcp --dport 8000 -j DROP 2>/dev/null ||
    $IPT -w 5 -I FORWARD 1 -i tailscale0 -p tcp --dport 8000 -j DROP

$IP6T -w 5 -C FORWARD -i tailscale0 -p tcp --dport 8000 -j DROP 2>/dev/null ||
    $IP6T -w 5 -I FORWARD 1 -i tailscale0 -p tcp --dport 8000 -j DROP

$IPT -w 5 -N PBP-DOCKER-FILTER 2>/dev/null || true
$IPT -w 5 -F PBP-DOCKER-FILTER
$IPT -w 5 -C DOCKER-USER -j PBP-DOCKER-FILTER 2>/dev/null ||
    $IPT -w 5 -I DOCKER-USER 1 -j PBP-DOCKER-FILTER

$IPT -w 5 -A PBP-DOCKER-FILTER \
    -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

$IPT -w 5 -A PBP-DOCKER-FILTER \
    -i tailscale0 -p tcp \
    -m multiport --dports 3001,9443 -j ACCEPT

$IPT -w 5 -A PBP-DOCKER-FILTER \
    -i wlp1s0 -s 192.168.0.0/24 -p tcp \
    -m multiport --dports 3001,9443 -j ACCEPT

$IPT -w 5 -A PBP-DOCKER-FILTER \
    -s 172.18.0.0/16 -p tcp \
    -m multiport --dports 3001,9443 -j ACCEPT

$IPT -w 5 -A PBP-DOCKER-FILTER \
    -p tcp -m multiport --dports 3001,8000,9443 -j DROP

$IPT -w 5 -A PBP-DOCKER-FILTER -j RETURN

$IP6T -w 5 -N PBP-DOCKER-FILTER6 2>/dev/null || true
$IP6T -w 5 -F PBP-DOCKER-FILTER6
$IP6T -w 5 -C DOCKER-USER -j PBP-DOCKER-FILTER6 2>/dev/null ||
    $IP6T -w 5 -I DOCKER-USER 1 -j PBP-DOCKER-FILTER6

$IP6T -w 5 -A PBP-DOCKER-FILTER6 \
    -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

$IP6T -w 5 -A PBP-DOCKER-FILTER6 \
    -i tailscale0 -p tcp \
    -m multiport --dports 3001,9443 -j ACCEPT

$IP6T -w 5 -A PBP-DOCKER-FILTER6 \
    -p tcp -m multiport --dports 3001,8000,9443 -j DROP

$IP6T -w 5 -A PBP-DOCKER-FILTER6 -j RETURN
