# Benchmarks

Benchmarks públicos usam somente imagens e payloads sintéticos. O corpus VIO real e resultados que revelem documentos não pertencem a este repositório.

`pnpm benchmark` não é um placeholder: ele falha se `QR_ONLY_OUTPUT_DIR` não
apontar para um artefato QR-only compilado. Para executá-lo, crie o artefato e
depois mantenha a mesma variável no benchmark:

```bash
QR_ONLY_OUTPUT_DIR=/caminho/vazio pnpm --filter @consulta-dev/qr-engine run qr-only:build
QR_ONLY_OUTPUT_DIR=/caminho/do/artefato pnpm benchmark
```

O segundo comando repete as verificações de integridade e roda o gate real de
Chromium; uma mensagem de orientação sem métricas não deve ser tratada como
aprovação.

O relatório de promoção do QR Engine deve comparar baseline e build QR-only usando o mesmo hardware, browser, versão e conjunto sintético, além da validação privada realizada fora deste repositório. O corpus público cobre bytes `0x00`–`0xFF`, versões QR 1/5/10/20, ECC L/M/Q/H, rotação, inversão, escala, contraste, iluminação, blur, quantização lossy pós-blur e perspectiva. A quantização é uma simulação determinística de artefatos pós-decodificação de imagem; PDFs e imagens reais de documentos permanecem fora do Git.
