/**
 * core/agent/attachments.mjs — imagens anexadas à conversa da CLI.
 *
 * Terminais são texto: Ctrl+V não entrega dados binários de imagem. No Windows,
 * a fonte confiável é a própria área de transferência, lida por PowerShell em
 * STA. Nada é exibido ou enviado sem o usuário pedir (/paste, @arquivo.png).
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const EXT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export function imageMime(file) {
  return EXT_MIME[path.extname(String(file)).toLowerCase()] || null;
}

export function isImageFile(file) {
  return imageMime(file) !== null;
}

/** Converte um arquivo de imagem para o formato ImageContent do motor. */
export function imageContent(file) {
  const mimeType = imageMime(file);
  if (!mimeType) return null;
  try {
    const data = readFileSync(file).toString("base64");
    return { type: "image", data, mimeType };
  } catch {
    return null;
  }
}

/**
 * Lê uma imagem da área de transferência do Windows e salva como PNG.
 * Devolve o caminho ou null quando não há imagem / não há PowerShell.
 */
export function captureClipboardImage({ root = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const dir = prepareAttachmentDir(root);
    const file = path.join(dir, `colada-${Date.now()}.png`);
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$img = [System.Windows.Forms.Clipboard]::GetImage()",
      "if ($null -eq $img) { exit 2 }",
      `$img.Save(${JSON.stringify(file)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
      "$img.Dispose()",
      "exit 0",
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      resolve(file);
    });
  });
}

/** Garante a pasta antes de pedir o Save (o PowerShell falha se ela não existir). */
export function prepareAttachmentDir(root = process.cwd()) {
  const dir = path.join(root, ".pi", "harness", "tmp", "attachments");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Escreve uma imagem recebida como base64 (útil para testes e outros front-ends). */
export function saveImage(base64, mimeType, root = process.cwd()) {
  const ext = Object.entries(EXT_MIME).find(([, m]) => m === mimeType)?.[0] || ".png";
  const dir = prepareAttachmentDir(root);
  const file = path.join(dir, `anexo-${Date.now()}${ext}`);
  writeFileSync(file, Buffer.from(String(base64), "base64"));
  return file;
}
