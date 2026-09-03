# Releases

Pacotes públicos são versionados com Changesets. A publicação final ocorre somente em CI por Trusted Publishing/OIDC; colaboradores não devem publicar versões manualmente.

Cada release deverá publicar o mesmo artefato testado em npm, GitHub Release e CDN, junto com SHA-256, SBOM e proveniência quando disponíveis.

Antes de apontar `embed.consulta.dev.br`, siga o [contrato de deploy do shell](EMBED_DEPLOYMENT.md). A política `frame-ancestors` precisa ser calculada no servidor por projeto; um host estático não pode usar uma CSP permissiva como substituto.
