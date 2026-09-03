# Build QR-only do ZXing-C++

Esta é uma receita experimental e reproduzível para um leitor WebAssembly que contém apenas `QRCode`. Ela não é selecionada pelo embed até passar todos os gates de promoção; `zxing-wasm@3.1.3` continua sendo o baseline em produção.

## Fonte fixada

- Candidato e baseline: ZXing-C++ no commit fixado `a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f`, a mesma revisão usada por `zxing-wasm@3.1.3` (não é uma tag de release).
- Emscripten `5.0.4`, imagem `linux/amd64` fixada por digest no `manifest.json` e no `Dockerfile`.
- QR Code ligado; 1D, Aztec, Data Matrix, MaxiCode, PDF417, writers, C API, filesystem virtual e decoder de arquivos desligados.

O wrapper recebe somente pixels RGBA do canvas. Assim, JPG/PNG/WebP/PDF continuam sendo convertidos localmente pelo embed e não adicionam um decoder de imagem ao WASM.

## Build e verificação

```bash
pnpm --filter @consulta-dev/qr-engine run qr-only:build
pnpm --filter @consulta-dev/qr-engine run qr-only:verify
QR_ONLY_OUTPUT_DIR=/caminho/segunda-build QR_ONLY_BUILD_NO_CACHE=1 pnpm --filter @consulta-dev/qr-engine run qr-only:build
QR_ONLY_OUTPUT_DIR=/caminho/primeira-build QR_ONLY_REPRODUCIBLE_OUTPUT_DIR=/caminho/segunda-build pnpm --filter @consulta-dev/qr-engine run qr-only:reproducible
pnpm --filter @consulta-dev/qr-engine run qr-only:test
pnpm --filter @consulta-dev/qr-engine run qr-only:parity
QR_ONLY_OUTPUT_DIR=/caminho/do/artefato pnpm --filter @consulta-dev/qr-engine run qr-only:benchmark
QR_ONLY_OUTPUT_DIR=/caminho/do/artefato pnpm --filter @consulta-dev/qr-engine run qr-only:firefox
QR_ONLY_OUTPUT_DIR=/caminho/do/artefato pnpm --filter @consulta-dev/qr-engine run qr-only:webkit
QR_ONLY_OUTPUT_DIR=/caminho/do/artefato pnpm --filter @consulta-dev/qr-engine run qr-only:edge
```

O build exige Docker Buildx e produz arquivos não versionados em `.qr-only-build/`. Ele se recusa a reutilizar uma pasta de saída não vazia: escolha outro diretório com `QR_ONLY_OUTPUT_DIR=/caminho/vazio` para não misturar artefatos de builds diferentes.

Na CI, a receita é compilada uma segunda vez em outro diretório com `QR_ONLY_BUILD_NO_CACHE=1`. `qr-only:reproducible` exige igualdade byte a byte do módulo JavaScript, WASM, versão do Emscripten e manifesto; qualquer divergência falha antes dos testes funcionais e do upload do primeiro artefato.

O estágio final do Docker é `scratch` e contém somente os três arquivos de
saída. Isso impede que o exportador do Buildx copie o toolchain Emscripten
inteiro para o artefato de CI.

`qr-only:verify` confere hash, tamanho bruto, tamanho gzip e redução em relação ao baseline. `qr-only:test` chama o leitor compilado de verdade para validar o contrato mínimo. `qr-only:parity` fornece sete QRs públicos e sintéticos como os mesmos pixels RGBA para o baseline e para o artefato QR-only: ASCII, UTF-8 rotacionado, bytes binários invertidos, todos os 256 valores de byte com ECC-H e três capturas leves degradadas (contraste/iluminação, blur e perspectiva). O gate exige igualdade exata dos bytes retornados.

A paridade sintética não substitui o corpus VIO privado, o benchmark em navegador, os 100 ciclos de memória nem a matriz de navegadores; ela é apenas um gate público, determinístico e reproduzível.

`qr-only:benchmark` inicia um Chromium isolado e um servidor Vite efêmero. Ele fornece ao baseline e ao candidato os mesmos pixels RGBA sintéticos, ampliados a partir de um QR sem dados reais. Primeiro mede a inicialização de cada leitor, confirma que a capacidade do heap WASM não cresceu após 100 leituras e depois mede 30 amostras alternadas, com cinco leituras por amostra e validação fora do cronômetro. Mediana, p95 e inicialização do candidato não podem ficar mais de 10% acima do baseline. Antes disso, o harness exige uma leitura real pelo Worker do embed; não aceita o fallback principal. O jsQR também lê apenas o fixture sintético pelos bytes brutos como referência experimental: sua métrica não é um gate e não seleciona a engine. Esse é um gate apenas de Chromium; o corpus privado e a matriz completa de navegadores continuam obrigatórios antes de qualquer promoção.

`qr-only:firefox` reutiliza o mesmo servidor e artefato para um probe funcional no Firefox: baseline, candidato e Worker do embed precisam extrair exatamente os bytes do QR sintético. Ele não usa o limite de tempo do Chromium como critério de promoção, porque desempenho entre engines de navegador não é comparável; Safari, dispositivos móveis e o corpus privado continuam pendentes.

`qr-only:webkit` executa o mesmo probe funcional no WebKit distribuído pelo Playwright. Isso amplia a detecção automática de incompatibilidades do motor do Safari, mas não é evidência de Safari real: a validação em Safari, iOS, dispositivos físicos e versões suportadas continua obrigatória antes de promoção.

`qr-only:edge` usa o canal Microsoft Edge instalado no runner para o mesmo probe funcional. Ele verifica Edge de fato, não apenas o Chromium do Playwright, mas segue sem aplicar orçamento de desempenho entre navegadores. O teste em versões suportadas de Edge e em dispositivos móveis continua obrigatório antes de promoção.

No CI, `qr-only:test` gera um QR sintético local, chama o artefato Emscripten
real com pixels RGBA e confirma o payload bruto e o identificador de formato
canônico `QRCode`.
