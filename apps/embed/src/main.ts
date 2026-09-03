const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Consulta Autofill embed could not find its application root.");
}

app.textContent = "Consulta Autofill embed is being initialized.";
