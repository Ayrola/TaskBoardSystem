"""Validate generated samples using PyMuPDF (optional local verification dependency)."""
import fitz, pathlib, re, sys
folder=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/taskboard-report-samples')
for path in sorted(folder.glob('*.pdf')):
    doc=fitz.open(path)
    text='\n'.join(page.get_text() for page in doc)
    assert 'Проект София' in text, f'{path.name}: Bulgarian text missing'
    assert 'Page 1 of ' in text, f'{path.name}: footer missing'
    assert any('Roboto' in font[3] for font in doc[0].get_fonts()), f'{path.name}: embedded font missing'
    for page in doc:
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines',[]):
                for span in line['spans']:
                    x0,y0,x1,y1=span['bbox']
                    assert x0>=34 and x1<=page.rect.width-34, f'{path.name}: text outside horizontal margin {span["text"]!r}'
                    assert y0>=30 and y1<=page.rect.height-15, f'{path.name}: text outside page {span["text"]!r}'
    if path.name=='large-bulgarian.pdf':
        references=re.findall(r'^\d{8}$',text,re.M)
        assert len(set(references))==1205, 'Task register silently truncated'
        assert len(references)==1205, 'Repeated or split task register references'
        for page in doc:
            if re.search(r'^\d{8}$',page.get_text(),re.M):
                assert 'Task / reference' in page.get_text(), 'Missing repeated register header'
    if path.name=='priorities.pdf':assert 'Priority: Urgent' in text and 'Priority: High' in text and 'Saved importance' in text
    if path.name=='cjk-and-bulgarian.pdf':assert '工作计划' in text, 'CJK text missing'
    if path.name=='long-relations.pdf':assert 'Relation appendix' in text and 'Член 29' in text
    print(f'PASS {path.name}: {len(doc)} pages, selectable Unicode, embedded fonts, margins and page numbers')
