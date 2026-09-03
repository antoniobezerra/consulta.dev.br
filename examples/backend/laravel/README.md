# Exemplo Laravel

Copie `config/consulta-autofill.php`, o controller e as duas rotas para um projeto Laravel 11/12. Configure as variáveis mostradas em `.env.example` somente no servidor.

As rotas devem ficar sob o middleware de autenticação/autorização do seu produto; o exemplo usa `auth` como marcador. Não registre `Request::all()`, token, QR, foto ou resposta da Consulta.

Leia [docs/INTEGRATION.md](../../../docs/INTEGRATION.md) para o HTML do componente e os headers de produção.
