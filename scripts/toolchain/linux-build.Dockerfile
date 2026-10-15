# A Linux machine to build the runtime and Pi in, for x86-64 or ARM64 (native: an arm64 host builds linux-arm64), with the tools
# docs/BUILDING.md lists at the versions Bun's own build pins (.work/bun/scripts/build/ci-images/spec.ts): LLVM 23, CMake 3.30,
# Rust (the nightly of Bun's rust-toolchain.toml), Bun 1.4.2, Node.js 24, and Docker's client, for make-sysroot.sh (run the
# container with the host's /var/run/docker.sock mounted).
#
#   docker build -t pibolt-build -f scripts/toolchain/linux-build.Dockerfile scripts/toolchain
#   docker run -it -v /var/run/docker.sock:/var/run/docker.sock -v pibolt-work:/work pibolt-build
FROM ubuntu:24.04
ARG LLVM=23
ARG CMAKE=3.30.5
ARG BUN=1.4.2
ARG NODE=24.22.0
ARG RUST=nightly-2026-09-15
ARG DOCKER=29.0.1
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
	bash build-essential ca-certificates curl dpkg file git gnupg golang libatomic1 libtool lsb-release make nasm ninja-build \
	perl pkg-config python3 rsync ruby software-properties-common sudo tmux unzip wget xz-utils zstd \
	&& rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://apt.llvm.org/llvm.sh -o /tmp/llvm.sh && bash /tmp/llvm.sh "$LLVM" all && rm -f /tmp/llvm.sh \
	&& rm -rf /var/lib/apt/lists/*
ENV PATH=/usr/lib/llvm-$LLVM/bin:$PATH CC=clang CXX=clang++
RUN arch=$(uname -m) && curl -fsSL "https://github.com/Kitware/CMake/releases/download/v$CMAKE/cmake-$CMAKE-linux-$arch.tar.gz" \
	| tar -xz -C /opt && ln -s "/opt/cmake-$CMAKE-linux-$arch/bin/"* /usr/local/bin/
RUN arch=$(uname -m) && case "$arch" in x86_64) node=x64 docker=x86_64 bun=x64 ;; aarch64) node=arm64 docker=aarch64 bun=aarch64 ;; esac \
	&& curl -fsSL "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-$node.tar.xz" | tar -xJ -C /opt \
	&& ln -s "/opt/node-v$NODE-linux-$node/bin/"* /usr/local/bin/ \
	&& curl -fsSL "https://download.docker.com/linux/static/stable/$docker/docker-$DOCKER.tgz" | tar -xz -C /tmp \
	&& install -m 755 /tmp/docker/docker /usr/local/bin/docker && rm -rf /tmp/docker \
	&& curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v$BUN/bun-linux-$bun.zip" -o /tmp/bun.zip \
	&& unzip -q /tmp/bun.zip -d /tmp && install -m 755 "/tmp/bun-linux-$bun/bun" /usr/local/bin/bun && rm -rf /tmp/bun*
# (RUSTUP_TOOLCHAIN: Bun's rust-toolchain.toml would install the standard library of a dozen cross targets.)
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo RUSTUP_TOOLCHAIN=$RUST PATH=/opt/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$RUST" \
	-c rust-src -c llvm-tools && chmod -R a+rwX /opt/rustup /opt/cargo
WORKDIR /work
