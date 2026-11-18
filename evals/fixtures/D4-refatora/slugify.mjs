/**
 * slugify.mjs — normaliza um texto em slug.
 * (Arquivo de trabalho da tarefa D4: refatorar preservando comportamento.)
 */
export function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}