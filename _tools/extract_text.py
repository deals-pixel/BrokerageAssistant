import pdfplumber, os

d = r"D:\01_Project\08_BrokerageAssistant\Example"
out = r"D:\01_Project\08_BrokerageAssistant\_extracted"
os.makedirs(out, exist_ok=True)
for f in os.listdir(d):
    if not f.lower().endswith(".pdf"):
        continue
    p = os.path.join(d, f)
    name = os.path.splitext(f)[0]
    with pdfplumber.open(p) as pdf, open(os.path.join(out, name + ".txt"), "w", encoding="utf-8") as fh:
        for i, page in enumerate(pdf.pages):
            txt = page.extract_text() or "[NO TEXT - likely scanned image]"
            fh.write(f"\n===== PAGE {i+1} =====\n{txt}\n")
print("done")
