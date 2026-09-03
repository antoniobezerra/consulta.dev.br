import { startEmbed } from "./embed.js";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Consulta Autofill embed could not find its application root.");
}

startEmbed(app);
