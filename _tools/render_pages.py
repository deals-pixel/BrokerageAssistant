import os
import pypdfium2 as pdfium
from PIL import Image

d = r"D:\01_Project\08_BrokerageAssistant\Example"
out = r"D:\01_Project\08_BrokerageAssistant\_pages"
sheets = r"D:\01_Project\08_BrokerageAssistant\_sheets"
os.makedirs(out, exist_ok=True)
os.makedirs(sheets, exist_ok=True)

for f in sorted(os.listdir(d)):
    if not f.lower().endswith(".pdf"):
        continue
    name = f.split(" ")[1] if " " in f else os.path.splitext(f)[0]
    pdf = pdfium.PdfDocument(os.path.join(d, f))
    pages = []
    for i in range(len(pdf)):
        page = pdf[i]
        bmp = page.render(scale=1.6)
        img = bmp.to_pil()
        img.save(os.path.join(out, f"{name}_p{i+1:02d}.png"))
        pages.append(img)
    # contact sheets: 2x2 grid
    per = 4
    for s in range(0, len(pages), per):
        chunk = pages[s:s+per]
        cw = max(im.width for im in chunk)
        ch = max(im.height for im in chunk)
        sheet = Image.new("RGB", (cw*2, ch*2), "white")
        for j, im in enumerate(chunk):
            sheet.paste(im, ((j % 2)*cw, (j // 2)*ch))
        sheet = sheet.resize((sheet.width//2, sheet.height//2))
        sheet.save(os.path.join(sheets, f"{name}_sheet{s//per+1:02d}_p{s+1}-{min(s+per,len(pages))}.png"))
    print(name, len(pages), "pages rendered")
print("done")
