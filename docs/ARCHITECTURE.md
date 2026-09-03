# Arquitetura pública

## Limite público/privado

Este monorepo distribui a experiência que roda no navegador. Ele não decodifica VIO, não armazena documentos e não contém uma API key de produção.

```text
Cliente web → Web Component → iframe da Consulta → backend do parceiro → API privada da Consulta
```

O iframe extrai bytes do QR localmente. O backend do parceiro cria uma sessão de curta duração e encaminha o payload para a API privada com sua credencial. O retorno é revisado no iframe antes de preencher o formulário.

## Origens e mensagens

O iframe só torna câmera, arquivo e PDF disponíveis depois que:

1. sua origem pai estiver autorizada para o `project-id`;
2. a sessão efêmera estiver válida;
3. o handshake validar `event.origin`, `event.source`, versão e nonce;
4. a comunicação migrar para um `MessageChannel` dedicado.

Mensagens nunca usam `targetOrigin: "*"`.

## Domínios

- `cdn.consulta.dev.br` entrega assets com versão e hash imutáveis.
- `embed.consulta.dev.br` entrega o iframe com políticas por projeto.
- O parceiro expõe endpoints same-origin de sessão e decode.

O [contrato de deploy do embed](EMBED_DEPLOYMENT.md) define como calcular a CSP dinâmica sem confiar em parâmetros controlados pelo navegador.

## QR Engine

O contrato público do engine é `prepare()`, `scan()` e `dispose()`. O baseline é `zxing-wasm`; a versão QR-only baseada em ZXing-C++ só será promovida quando cumprir os gates de tamanho, desempenho, igualdade de bytes e memória definidos no plano privado.
