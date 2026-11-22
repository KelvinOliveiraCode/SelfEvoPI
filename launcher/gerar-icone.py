import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, "assets", "logo-dna.svg")
OUT = os.path.join(ROOT, "assets", "selfevopi.ico")

# Renderiza grande e reduz: as bordas ficam limpas nos tamanhos pequenos.
RENDER = 1024
SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]

CHROME_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def achar_chromium():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    return shutil.which("chrome") or shutil.which("chromium")


def svg_para_html(svg_texto):
    # currentColor explicito: cada renderizador resolve do seu jeito.
    svg = svg_texto.replace("currentColor", "#111111")
    css = (
        "html,body{margin:0;padding:0;background:transparent;"
        "width:" + str(RENDER) + "px;height:" + str(RENDER) + "px;overflow:hidden}"
        "svg{display:block;width:" + str(RENDER) + "px;height:" + str(RENDER) + "px}"
    )
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<style>" + css + "</style></head><body>" + svg + "</body></html>"
    )


def main():
    if not os.path.exists(SVG):
        print("erro: nao achei " + SVG)
        return 1

    chromium = achar_chromium()
    if not chromium:
        print("erro: nenhum Chromium (Chrome/Edge) encontrado para rasterizar o SVG.")
        print("       instale um deles, ou gere o .ico em outra maquina e copie.")
        return 1

    with open(SVG, "r", encoding="utf-8") as f:
        svg_texto = f.read()

    tmp = tempfile.mkdtemp(prefix="selfevopi-ico-")
    try:
        html = os.path.join(tmp, "logo.html")
        png = os.path.join(tmp, "logo.png")
        with open(html, "w", encoding="utf-8") as f:
            f.write(svg_para_html(svg_texto))

        cmd = [
            chromium,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--user-data-dir=" + os.path.join(tmp, "perfil"),
            "--default-background-color=00000000",
            "--force-device-scale-factor=1",
            "--window-size=" + str(RENDER) + "," + str(RENDER),
            "--screenshot=" + png,
            "file:///" + html.replace("\\", "/"),
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=120)
        if not os.path.exists(png):
            print("erro: o Chromium nao gerou o PNG.")
            print((proc.stderr or b"").decode("utf-8", "replace")[-800:])
            return 1

        img = Image.open(png).convert("RGBA")

        # Sem recorte: o proprio SVG tem margem (viewBox 256, desenho ~20..236).
        # Recortar colaria o anel nas bordas do icone. Reduz so.
        if img.size != (RENDER, RENDER):
            img = img.resize((RENDER, RENDER), Image.LANCZOS)

        img.save(OUT, format="ICO", sizes=SIZES)

        with Image.open(OUT) as check:
            tam = os.path.getsize(OUT)
            frames = check.info.get("sizes", SIZES)
        print("ok: " + OUT)
        print("    bytes: " + str(tam))
        print("    tamanhos: " + str(sorted(frames)))
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())