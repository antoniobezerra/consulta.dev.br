# Build QR-only do ZXing-C++

Esta é uma receita experimental e reproduzível para um leitor WebAssembly que contém apenas `QRCode`. Ela não é selecionada pelo embed até passar todos os gates de promoção; `zxing-wasm@3.1.3` continua sendo o baseline em produção.

## Fonte fixada

- ZXing-C++ `v3.1.1`, commit `d43b96bda9fef3cb82462ad0bfd8fa10f6fde9ad`.
- Emscripten `3.1.74`, imagem `linux/amd64` fixada por digest no `manifest.json` e no `Dockerfile`.
- QR Code ligado; 1D, Aztec, Data Matrix, MaxiCode, PDF417, writers, C API, filesystem virtual e decoder de arquivos desligados.

O wrapper recebe somente pixels RGBA do canvas. Assim, JPG/PNG/WebP/PDF continuam sendo convertidos localmente pelo embed e não adicionam um decoder de imagem ao WASM.

## Build e verificação

```bash
pnpm --filter @consulta-dev/qr-engine run qr-only:build
pnpm --filter @consulta-dev/qr-engine run qr-only:verify
pnpm --filter @consulta-dev/qr-engine run qr-only:test
pnpm --filter @consulta-dev/qr-engine run qr-only:parity
```

O build exige Docker Buildx e produz arquivos não versionados em `.qr-only-build/`. Ele se recusa a reutilizar uma pasta de saída não vazia: escolha outro diretório com `QR_ONLY_OUTPUT_DIR=/caminho/vazio` para não misturar artefatos de builds diferentes.

O estágio final do Docker é `scratch` e contém somente os três arquivos de
saída. Isso impede que o exportador do Buildx copie o toolchain Emscripten
inteiro para o artefato de CI.

`qr-only:verify` confere hash, tamanho bruto, tamanho gzip e redução em relação ao baseline. `qr-only:test` chama o leitor compilado de verdade para validar o contrato mínimo. `qr-only:parity` fornece três QRs públicos e sintéticos — ASCII, UTF-8 rotacionado e bytes binários invertidos — como os mesmos pixels RGBA para o baseline e para o artefato QR-only, e exige igualdade exata dos bytes retornados.

A paridade sintética não substitui o corpus VIO privado, o benchmark em navegador, os 100 ciclos de memória nem a matriz de navegadores; ela é apenas um gate público, determinístico e reproduzível.

No CI, `qr-only:test` gera um QR sintético local, chama o artefato Emscripten
real com pixels RGBA e confirma o payload bruto e o identificador de formato
canônico `QRCode`.
