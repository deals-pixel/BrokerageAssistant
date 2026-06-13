import os, sys
import pypdfium2 as pdfium

src = r"D:\01_Project\08_BrokerageAssistant\Example\1 Valleyview - docs.pdf"
out = r"D:\01_Project\08_BrokerageAssistant\_e2e\valleyview"
os.makedirs(out, exist_ok=True)

pdf = pdfium.PdfDocument(src)
for i in range(len(pdf)):
    img = pdf[i].render(scale=2.0).to_pil()
    img.convert("RGB").save(os.path.join(out, f"p{i+1:03d}.jpg"), quality=80)
print(f"rendered {len(pdf)} pages")
