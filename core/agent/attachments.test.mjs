/** attachments.test.mjs — anexos de imagem para a CLI. */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { imageMime, isImageFile, imageContent, saveImage, prepareAttachmentDir } from "./attachments.mjs";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+gV5KAAAAAElFTkSuQmCC";

test("mime e extensão", () => {
  assert.equal(imageMime("foto.PNG"), "image/png");
  assert.equal(imageMime("foto.jpg"), "image/jpeg");
  assert.equal(imageMime("notas.txt"), null);
  assert.equal(isImageFile("C:\\tmp\\foto.webp"), true);
  assert.equal(isImageFile("C:\\tmp\\foto.pdf"), false);
});

test("imageContent gera bloco ImageContent do motor", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "selfevopi-img-"));
  try {
    const file = path.join(dir, "pixel.png");
    writeFileSync(file, Buffer.from(PNG_1X1, "base64"));
    const block = imageContent(file);
    assert.equal(block.type, "image");
    assert.equal(block.mimeType, "image/png");
    assert.equal(block.data, PNG_1X1);
    assert.equal(imageContent(path.join(dir, "faltando.png")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveImage e prepareAttachmentDir", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "selfevopi-att-"));
  try {
    const dir = prepareAttachmentDir(root);
    assert.ok(existsSync(dir));
    const file = saveImage(PNG_1X1, "image/png", root);
    assert.ok(existsSync(file));
    assert.equal(readFileSync(file).toString("base64"), PNG_1X1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
