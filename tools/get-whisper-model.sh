#!/bin/bash
# Downloads the speech model for spoken commands (whisper.cpp "small", quantised, about 190 MB) from the
# whisper.cpp model page on Hugging Face, checks its SHA-256 and puts it where the whisper container reads it.
set -eu
DIR=${DIR:-$HOME/carthing-hub/whisper-models}
NAME=ggml-small-q5_1.bin
URL=https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$NAME
mkdir -p "$DIR"
[ -s "$DIR/$NAME" ] && { echo "already there: $DIR/$NAME"; exit 0; }
# the expected hash, from the file's Git LFS pointer in the same repository
SUM=$(curl -fsSL "https://huggingface.co/ggerganov/whisper.cpp/raw/main/$NAME" | sed -n 's/^oid sha256://p')
[ -n "$SUM" ] || { echo "could not read the expected checksum"; exit 1; }
curl -fL --progress-bar -o "$DIR/$NAME.part" "$URL"
echo "$SUM  $DIR/$NAME.part" | sha256sum -c -
mv "$DIR/$NAME.part" "$DIR/$NAME"
