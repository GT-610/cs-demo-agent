# Vendored demoparser2 core

This directory contains the Rust parser and generated protobuf sources from
[`LaihoE/demoparser`](https://github.com/LaihoE/demoparser) commit
`57f24c76776ac176e893833f3a5b4aad718a8196`.

The upstream parser and csgoproto build scripts are intentionally omitted. They
only regenerate already committed Rust sources by cloning GameTracking-CS2 and
running `protoc`, which would make clean application builds depend on mutable
network state and a system-level protobuf compiler.

The vendored code remains available under the upstream MIT license in
[`LICENSE`](LICENSE).
