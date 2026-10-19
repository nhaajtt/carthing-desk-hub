# whisper.cpp's HTTP server, built from source for this CPU. Runs on an internal Docker network with no way
# out: only the hub can reach it, and it never sees anything but the clips the hub sends.
FROM debian:bookworm-slim AS build
ARG WHISPER_VERSION=v1.7.6
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp /src \
 && cmake -B /src/build -S /src -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=OFF \
 && cmake --build /src/build -j --config Release --target whisper-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
USER 65534:65534
ENTRYPOINT ["whisper-server"]
