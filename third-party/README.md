# Componentes de terceiros

Este diretório recebe avisos de licença, origem e hash de componentes que precisem ser distribuídos junto com o Autofill, especialmente o futuro build QR-only baseado em ZXing-C++.

## Baseline atual: zxing-wasm 3.1.3

- Pacote: [`zxing-wasm@3.1.3`](https://www.npmjs.com/package/zxing-wasm/v/3.1.3)
- Uso: somente o subpath `zxing-wasm/reader`, configurado para `QRCode`.
- Licenças: código próprio do wrapper sob MIT; ZXing-C++ e wrapper C++ sob Apache-2.0; componentes de escrita não são incluídos no fluxo do embed.
- Ativo: o embed fornece explicitamente a URL versionada do WASM, sem depender do CDN padrão da biblioteca.
- Artefato distribuído: `apps/embed/public/zxing_reader.wasm`, SHA-256 `2ebda08a93eea3efcd8399cda6b276e6a0b1de4fec60b4d8988a047de4c6d1ba`.

Antes de promover o build QR-only próprio, registre aqui o commit do ZXing-C++, o digest da imagem Emscripten, SHA-256 do WASM e os textos completos de licença exigidos pelas dependências distribuídas.

## Receita QR-only experimental

- Fonte do candidato e referência do baseline: ZXing-C++ no [commit `a17fd9d`](https://github.com/zxing-cpp/zxing-cpp/commit/a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f), a mesma revisão fixada por `zxing-wasm@3.1.3`, sob Apache-2.0. Esse commit não é uma tag de release.
- Compilador: `emscripten/emsdk:5.0.4` para `linux/amd64`, fixado por digest em [`packages/qr-engine/qr-only/manifest.json`](../packages/qr-engine/qr-only/manifest.json).
- Wrapper: derivado do reader WASM do ZXing-C++; recebe somente pixmap RGBA e não inclui `stb_image`, writers, C API, filesystem virtual ou leitores de outros formatos.
- Estado: receita presente, artefato ainda **não promovido**. Não copie o `.wasm` gerado para `apps/embed/public/` sem relatório completo dos gates.

## PDF.js 6.3.289

- Pacote: [`pdfjs-dist@6.3.289`](https://www.npmjs.com/package/pdfjs-dist/v/6.3.289)
- Uso: renderização local de, no máximo, três páginas de PDF antes da leitura QR.
- Artefato: worker versionado emitido pelo build do embed.
- Licença: Apache-2.0. A execução de JavaScript/XFA do PDF fica desabilitada no fluxo do Autofill.

## jsQR 1.4.0 (somente benchmark experimental)

- Pacote: [`jsqr@1.4.0`](https://www.npmjs.com/package/jsqr/v/1.4.0)
- Uso: leitura do fixture sintético no harness de benchmark de desenvolvimento para referência de mediana/p95; ele não participa da seleção, do fallback ou da promoção do engine.
- Licença: Apache-2.0.
- Distribuição: dependência de desenvolvimento de `apps/embed`; a página de benchmark é excluída do build hospedado do embed.

## aws4fetch 1.0.20 (ferramenta de release)

- Pacote: [`aws4fetch@1.0.20`](https://www.npmjs.com/package/aws4fetch/v/1.0.20)
- Uso: assina a escrita e a leitura de verificação pela API S3 compatível do Cloudflare R2 na workflow manual de release.
- Licença: MIT.
- Distribuição: dependência de desenvolvimento fixada no lockfile; não entra nos pacotes npm, no iframe ou nos assets de navegador.

Não copie fontes, documentos ou assets privados para este diretório.
