# Componentes de terceiros

Este diretório recebe avisos de licença, origem e hash de componentes que precisem ser distribuídos junto com o Autofill, especialmente o futuro build QR-only baseado em ZXing-C++.

## Baseline atual: zxing-wasm 3.1.3

- Pacote: [`zxing-wasm@3.1.3`](https://www.npmjs.com/package/zxing-wasm/v/3.1.3)
- Uso: somente o subpath `zxing-wasm/reader`, configurado para `QRCode`.
- Licenças: código próprio do wrapper sob MIT; ZXing-C++ e wrapper C++ sob Apache-2.0; componentes de escrita não são incluídos no fluxo do embed.
- Ativo: o embed fornece explicitamente a URL versionada do WASM, sem depender do CDN padrão da biblioteca.
- Artefato distribuído: `apps/embed/public/zxing_reader.wasm`, SHA-256 `2ebda08a93eea3efcd8399cda6b276e6a0b1de4fec60b4d8988a047de4c6d1ba`.

Antes de promover o build QR-only próprio, registre aqui o commit do ZXing-C++, o digest da imagem Emscripten, SHA-256 do WASM e os textos completos de licença exigidos pelas dependências distribuídas.

## PDF.js 6.3.289

- Pacote: [`pdfjs-dist@6.3.289`](https://www.npmjs.com/package/pdfjs-dist/v/6.3.289)
- Uso: renderização local de, no máximo, três páginas de PDF antes da leitura QR.
- Artefato: worker versionado emitido pelo build do embed.
- Licença: Apache-2.0. A execução de JavaScript/XFA do PDF fica desabilitada no fluxo do Autofill.

Não copie fontes, documentos ou assets privados para este diretório.
