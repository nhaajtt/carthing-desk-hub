#!/bin/bash
# Builds the Car Thing's Bluetooth helper (carthing/phonelink) on server 2, in the official Go image, for the
# Car Thing's arm64 CPU. Static binary, no cgo. Then run check-carthing.sh to put it on the Car Thing.
set -eu
DIR=${DIR:-$HOME/carthing-hub/carthing/phonelink}
docker run --rm --user "$(id -u):$(id -g)" -v "$DIR":/src -w /src \
  -e HOME=/tmp -e GOPATH=/tmp/go -e GOCACHE=/tmp/cache -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH=arm64 \
  golang:1.24-alpine sh -c 'f=$(gofmt -l .); [ -z "$f" ] || echo "not gofmt-formatted (CI will fail): $f"; go vet ./... && go build -trimpath -ldflags="-s -w" -o phonelink .'
ls -la "$DIR/phonelink"
