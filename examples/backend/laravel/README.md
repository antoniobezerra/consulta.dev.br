# Exemplo Laravel

Ponte same-origin executável para Laravel 12 e PHP 8.2+. A chave, o projeto e
a origem ficam exclusivamente no processo PHP; o componente usa
`endpoint="/api/consulta-autofill"` e pode usar
`metrics-endpoint="/api/consulta-autofill/metrics"` para o funil sem PII.

No projeto parceiro, copie as variáveis de `.env.example` para o gerenciador
de segredos do servidor. Para executar este fixture isolado, use:

```bash
composer update
composer test
```

Copie `config/consulta-autofill.php`, o controller e as três rotas para o seu
projeto Laravel. As rotas de produção usam `auth` e `throttle`; configure o
guard para a sessão/RBAC do seu produto e exija a permissão de cadastro antes
de executar. Não aceite `project-id`, QR, payload ou token estático do browser
como identidade; use rate limit compartilhado antes de múltiplas instâncias.

O fixture Testbench cobre origem inválida, campo de browser não permitido e os
headers/origem fixados no servidor contra um upstream sintético. Nenhum corpo
sensível é escrito em logs. Leia o [guia de integração](../../../docs/INTEGRATION.md).
