/*
 * Consulta QR-only reader.
 *
 * Derived from the ZXing-C++ WebAssembly reader wrapper, Copyright 2016
 * Nu-book Inc. and Copyright 2023 Axel Waggershauser. This wrapper is
 * distributed under Apache-2.0; see the repository NOTICE and third-party
 * records. It intentionally exposes only QRCode decoding from RGBA pixels.
 */

#include "ReadBarcode.h"
#include "ZXingCpp.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cstdint>
#include <stdexcept>
#include <string>

using namespace ZXing;

struct QrReadResult
{
	std::string format{};
	emscripten::val bytes;
	std::string error{};
};

QrReadResult readQrCodeFromPixmap(uintptr_t bufferPtr, int imageWidth, int imageHeight)
{
	try {
		if (bufferPtr == 0 || imageWidth <= 0 || imageHeight <= 0)
			throw std::invalid_argument("Invalid RGBA pixmap");

		auto options = ReaderOptions()
			.tryHarder(true)
			.tryRotate(true)
			.tryInvert(true)
			.tryDownscale(true)
			.formats(BarcodeFormat::QRCode)
			.maxNumberOfSymbols(1);
		const auto barcodes = ReadBarcodes(
			{reinterpret_cast<const uint8_t*>(bufferPtr), imageWidth, imageHeight, ImageFormat::RGBA}, options);
		if (barcodes.empty())
			return {};

		const auto& barcode = barcodes.front();
		thread_local const emscripten::val Uint8Array = emscripten::val::global("Uint8Array");
		const auto& bytes = barcode.bytes();
		return {
			ToString(barcode.format()),
			Uint8Array.new_(emscripten::typed_memory_view(bytes.size(), bytes.data())),
			ToString(barcode.error()),
		};
	} catch (const std::exception& exception) {
		return {"", {}, exception.what()};
	} catch (...) {
		return {"", {}, "Unknown QR reader error"};
	}
}

EMSCRIPTEN_BINDINGS(ConsultaQrOnlyReader)
{
	using namespace emscripten;

	value_object<QrReadResult>("QrReadResult")
		.field("format", &QrReadResult::format)
		.field("bytes", &QrReadResult::bytes)
		.field("error", &QrReadResult::error);

	function("readQrCodeFromPixmap", &readQrCodeFromPixmap);
}
