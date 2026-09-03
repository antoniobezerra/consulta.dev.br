# Exemplo Next.js

Copie `app/api/consulta-autofill/[action]/route.ts` para um projeto Next.js App Router, copie `.env.example` para `.env.local` e configure as variáveis. O cliente usa `endpoint="/api/consulta-autofill"` e, opcionalmente, `metrics-endpoint="/api/consulta-autofill/metrics"`; a API key não é exposta no bundle.

O diretório também inclui um teste do Route Handler com upstream sintético. Em Node 24+:

```bash
npm test
```

O handler faz body limit, valida a origem exata, fixa o projeto no servidor,
usa timeout e rate limit local no upstream. Por segurança,
`authorizePartnerAccess` retorna `false`: substitua-a por uma consulta à sua
sessão server-side e à permissão/RBAC de cadastro antes de expor a rota. Não
use `project_id`, QR, payload ou token estático vindo do browser como acesso.
Em produção horizontal, substitua o limiter local por Redis ou equivalente.

Leia também [docs/INTEGRATION.md](../../../docs/INTEGRATION.md).
