#!/usr/bin/env python3
import os,json
from fpdf import FPDF
FONT_B="C:/Windows/Fonts/simhei.ttf"
FONT_R="C:/Windows/Fonts/simsun.ttc"
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B=os.path.join(R,"books")
class PDF(FPDF):
 def __init__(s,t):
  super().__init__("P","mm","A4");s.t=t;s.set_auto_page_break(True,20);s.add_font("B","",FONT_B,uni=True);s.add_font("R","",FONT_R,uni=True)
 def header(s):
  if s.page_no()>1:s.set_font("R","",8);s.set_text_color(150,150,150);s.cell(0,5,s.t,align="C");s.ln(8)
 def footer(s):s.set_y(-15);s.set_font("R","",8);s.set_text_color(150,150,150);s.cell(0,10,str(s.page_no()),align="C")
 def cover(s,t,c):
  s.add_page();s.ln(50);s.set_font("B","",28);s.set_text_color(40,40,40);s.multi_cell(0,12,t,align="C");s.ln(8);s.set_font("R","",14);s.set_text_color(120,120,120);s.cell(0,8,f"Category:{c} | BookVault",align="C");s.ln(20);s.set_font("R","",10);s.set_text_color(100,100,100);s.cell(0,8,"Based on public knowledge. Educational use only.",align="C")
 def ch(s,h,ps):
  s.add_page();s.set_font("B","",16);s.set_text_color(192,57,43);s.cell(0,10,h);s.ln(14)
  for p in ps:s.set_font("R","",11);s.set_text_color(50,50,50);s.multi_cell(0,7,p,align="J");s.ln(3)
print("PDF class OK")

import json, os

json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "books_content.json")
with open(json_path, "r", encoding="utf-8") as f:
    books = json.load(f)

NL = chr(10)

for bk in books:
    title = bk["title"]
    category = bk["category"]
    chapters = bk["chapters"]

    pdf = PDF(title)
    pdf.cover(title, category)
    for heading, paragraphs in chapters:
        pdf.ch(heading, paragraphs)

    cat_dir = os.path.join(B, category)
    os.makedirs(cat_dir, exist_ok=True)

    pdf_path = os.path.join(cat_dir, f"{title}.pdf")
    pdf.output(pdf_path)
    pdf_size = os.path.getsize(pdf_path)

    md_path = os.path.join(cat_dir, f"{title}.md")
    now = "2026-07-12T12:00:00.000Z"
    preview = chapters[0][1][0][:200] if chapters and chapters[0][1] else ""
    md_content = f"<!-- contributor: bookvault@knowledge.org | ip: 127.0.0.1 | date: {now} | size: {pdf_size} -->{NL}{NL}# {title}{NL}{NL}{preview}{NL}"
    with open(md_path, "w", encoding="utf-8") as mf:
        mf.write(md_content)

    print(f"[{category}] {title}  ({pdf_size:,} bytes)")

print(f"{NL}Done! {len(books)} PDFs + metadata written to books/")
