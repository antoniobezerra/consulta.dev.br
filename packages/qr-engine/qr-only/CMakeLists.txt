cmake_minimum_required(VERSION 3.16)

project(ConsultaQrOnlyReader LANGUAGES CXX)

if (NOT DEFINED ZXING_CPP_SOURCE_DIR)
    message(FATAL_ERROR "ZXING_CPP_SOURCE_DIR is required")
endif()

# Keep the source subset explicit. The generic reader entry point remains, but
# ZXing-C++ compiles only QR code reader sources and no writer or C API.
set(ZXING_READERS ON CACHE BOOL "" FORCE)
set(ZXING_WRITERS OFF CACHE STRING "" FORCE)
set(ZXING_C_API OFF CACHE BOOL "" FORCE)
set(ZXING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(ZXING_DEPENDENCIES LOCAL CACHE STRING "" FORCE)
set(ZXING_DISABLE_PCH ON CACHE BOOL "" FORCE)
set(ZXING_ENABLE_1D OFF CACHE BOOL "" FORCE)
set(ZXING_ENABLE_AZTEC OFF CACHE BOOL "" FORCE)
set(ZXING_ENABLE_DATAMATRIX OFF CACHE BOOL "" FORCE)
set(ZXING_ENABLE_MAXICODE OFF CACHE BOOL "" FORCE)
set(ZXING_ENABLE_PDF417 OFF CACHE BOOL "" FORCE)
set(ZXING_ENABLE_QRCODE ON CACHE BOOL "" FORCE)

add_subdirectory("${ZXING_CPP_SOURCE_DIR}/core" "${CMAKE_BINARY_DIR}/zxing-core")

add_executable(consulta_qr_reader qr_reader.cpp)
target_link_libraries(consulta_qr_reader PRIVATE ZXing::ZXing)

# The module exposes only the allocator and a QR-only RGBA-pixmap reader. It
# has no virtual filesystem, dynamic execution, document decoder or writer.
target_link_options(consulta_qr_reader PRIVATE
    "--bind"
    "-sENVIRONMENT=web"
    "-sDISABLE_EXCEPTION_CATCHING=0"
    "-sFILESYSTEM=0"
    "-sDYNAMIC_EXECUTION=0"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createConsultaQrReader"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sMAXIMUM_MEMORY=67108864"
    "-sMALLOC=emmalloc"
    "-sASSERTIONS=0"
    "-sNO_EXIT_RUNTIME=1"
)
