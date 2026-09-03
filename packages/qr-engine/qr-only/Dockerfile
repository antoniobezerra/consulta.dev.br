ARG EMSDK_IMAGE=emscripten/emsdk@sha256:af45409f3199d88db4b1b03af0098532c8fb33a375ac257463eeb0a622870d06
FROM ${EMSDK_IMAGE} AS build

ARG ZXING_CPP_REPOSITORY=https://github.com/zxing-cpp/zxing-cpp.git
ARG ZXING_CPP_COMMIT=d43b96bda9fef3cb82462ad0bfd8fa10f6fde9ad

WORKDIR /work

# Fetching a full immutable Git object makes a moved tag unable to change the
# compiled source. No third-party image decoder is included: the wrapper reads
# only RGBA pixels supplied by the embed canvas.
RUN git init /src/zxing \
    && git -C /src/zxing remote add origin "${ZXING_CPP_REPOSITORY}" \
    && git -C /src/zxing fetch --depth 1 origin "${ZXING_CPP_COMMIT}" \
    && git -C /src/zxing checkout --detach "${ZXING_CPP_COMMIT}" \
    && test "$(git -C /src/zxing rev-parse HEAD)" = "${ZXING_CPP_COMMIT}"

COPY CMakeLists.txt /work/CMakeLists.txt
COPY qr_reader.cpp /work/qr_reader.cpp

RUN emcmake cmake -S /work -B /work/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DZXING_CPP_SOURCE_DIR=/src/zxing \
      -DZXING_READERS=ON \
      -DZXING_WRITERS=OFF \
      -DZXING_C_API=OFF \
      -DZXING_EXAMPLES=OFF \
      -DZXING_ENABLE_1D=OFF \
      -DZXING_ENABLE_AZTEC=OFF \
      -DZXING_ENABLE_DATAMATRIX=OFF \
      -DZXING_ENABLE_MAXICODE=OFF \
      -DZXING_ENABLE_PDF417=OFF \
      -DZXING_ENABLE_QRCODE=ON \
    && cmake --build /work/build --target consulta_qr_reader --parallel

RUN mkdir -p /out \
    && cp /work/build/consulta_qr_reader.js /out/consulta_qr_reader.js \
    && cp /work/build/consulta_qr_reader.wasm /out/consulta_qr_reader.wasm \
    && emcc --version > /out/emscripten-version.txt

# The local Buildx exporter emits the complete final filesystem. Keep the
# exported stage intentionally tiny so CI copies only the distributable reader
# instead of the full Emscripten toolchain.
FROM scratch
COPY --from=build /out/ /
