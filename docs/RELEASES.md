# Releases

Pacotes públicos são versionados com Changesets. A publicação final ocorre somente em CI por Trusted Publishing/OIDC; colaboradores não devem publicar versões manualmente.

## Coleção única de artefatos

Depois de `pnpm build`, a coleção é preparada por uma única execução, sem publicar nada:

```bash
CONSULTA_RELEASE_VERSION=1.0.0 pnpm release:prepare
pnpm release:verify
```

Ela produz, em `.release-artifacts/` ou em `CONSULTA_RELEASE_OUTPUT_DIR` vazio:

- tarballs exatos de `@consulta-dev/autofill` e `@consulta-dev/qr-engine`;
- assets versionados do CDN, inclusive `autofill/v1.0.0/consulta-autofill.min.js` e o shell do embed;
- `release-manifest.json` com SHA-256, tipo MIME e SRI dos assets;
- `SHA256SUMS` e um SBOM CycloneDX 1.5;
- prova de que os bytes JavaScript copiados ao CDN são os mesmos arquivos dentro dos tarballs npm.

`CONSULTA_RELEASE_VERSION` identifica a coleção, os paths de CDN e a tag `v<versão>`; as versões individuais dos pacotes continuam registradas no manifest e são definidas pelos Changesets.

O QR-only experimental não entra na coleção: ele continua opt-in até o corpus privado e a matriz externa de navegadores aprovarem sua promoção.

## Publicação aprovada

A workflow manual **Release artifacts** exige que a tag `v<versão>` já exista. Ela reconstrói, testa, prepara e verifica a coleção antes de qualquer publicação. Por padrão, ela apenas retém o artefato do GitHub Actions por 14 dias.

- `publish_npm=true` publica exatamente os tarballs verificados com `npm publish --provenance`, usando Trusted Publishing/OIDC. Antes disso, um administrador do escopo `@consulta-dev` deve cadastrar esse repositório/workflow como publisher confiável; não use token permanente.
- `publish_github_release=true` cria ou anexa à GitHub Release da tag e envia os mesmos tarballs, manifest, checksums e SBOM.
- A cópia ao R2/CDN permanece uma configuração externa pendente, porque as credenciais e o domínio `cdn.consulta.dev.br` não pertencem ao repositório. Faça upload somente dos arquivos já verificados, preserve nomes versionados, use `Cache-Control: public, max-age=31536000, immutable` para versões exatas e só mova o alias `/v1/` depois de um smoke test. Nunca use `r2.dev` em produção.

Cada release deverá publicar o mesmo artefato testado em npm, GitHub Release e CDN, junto com SHA-256, SBOM e proveniência quando disponíveis.

Antes de apontar `embed.consulta.dev.br`, siga o [contrato de deploy do shell](EMBED_DEPLOYMENT.md). A política `frame-ancestors` precisa ser calculada no servidor por projeto; um host estático não pode usar uma CSP permissiva como substituto.
