console.error(
  "Publicação local bloqueada. Crie uma tag aprovada e use a workflow Release artifacts no GitHub; ela prepara uma única coleção verificada antes de publicar.",
);
process.exitCode = 1;
