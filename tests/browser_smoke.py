"""End-to-end checks using real PDF.js, generated PDFs, and real report downloads.
Run: PDFDIFF_TLS_BRIDGE=1 python3 tests/browser_smoke.py
The optional bridge fetches only public library/font assets with verified system TLS.
AI calls are intercepted locally; no API key, paid call or document upload is used.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from urllib.parse import urlsplit
import json, os, re, csv, io, zipfile
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright
from pypdf import PdfReader, PdfWriter

REPO=Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def pdf(path,new=False,pages=2):
    c=Canvas(str(path),pagesize=(600,800))
    for page in range(pages):
        c.setFont('Helvetica',12)
        for i in range(12): c.drawString(70+(i%3)*150,280+(i//3)*50,f'Grid anchor {i+1:02d} page {page+1}')
        c.drawString(120,320,'Width 3200' if new and page==0 else 'Width 3000')
        c.drawString(100,510,'3 000 mm' if new else '3000 mm')
        if page==0:
            if new:c.drawString(350,230,'ADD VENT')
            else:c.drawString(90,230,'REMOVE DRAIN')
        c.rect(60,210,460,370)
        c.setLineWidth(3)
        c.line(180 if new and page==0 else 140,600,180 if new and page==0 else 140,720)
        c.showPage()
    c.save()

def scan(path,new=False):
    im=Image.new('RGB',(1000,700),'white');draw=ImageDraw.Draw(im)
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',38)
    for i,text in enumerate(['DRAWING REVIEW','ROOM ALPHA','WALL HEIGHT 3200' if new else 'WALL HEIGHT 3000','LEVEL 01','ANCHOR NORTH']):draw.text((70,70+i*100),text,fill='black',font=font)
    c=Canvas(str(path),pagesize=(1000,700));c.drawImage(ImageReader(im),0,0,width=1000,height=700);c.save()

with TemporaryDirectory(prefix='pdfdiff-e2e-') as tmp:
    root=Path(tmp);old=root/'T-100_rev01.pdf';new=root/'T-100_rev02.pdf';pdf(old);pdf(new,True)
    corrupt=root/'E-900_rev01.pdf';corrupt.write_bytes(b'not a PDF')
    valid=root/'E-900_rev02.pdf';pdf(valid)
    scanned_old=root/'S-100_rev01.pdf';scanned_new=root/'S-100_rev02.pdf';scan(scanned_old);scan(scanned_new,True)
    extra=root/'N-999.pdf';pdf(extra)
    archive=root/'old-package.zip'
    with zipfile.ZipFile(archive,'w') as z:
        for f in [old,corrupt,scanned_old]:z.write(f,f.name)
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(REPO)))
    thread=Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
    cache={}
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        def context():
            ctx=browser.new_context(accept_downloads=True,viewport={'width':1500,'height':1000})
            if os.environ.get('PDFDIFF_TLS_BRIDGE')=='1':
                def verified(route):
                    url=route.request.url
                    if url not in cache:
                        with urlopen(url,timeout=60) as response:cache[url]=(response.read(),response.headers.get('content-type','application/octet-stream'))
                    body,mime=cache[url];route.fulfill(status=200,body=body,headers={'content-type':mime,'access-control-allow-origin':'*'})
                ctx.route(re.compile(r'^https://(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)/'),verified)
            # Optional analytics is unrelated to comparison; tests do not send telemetry.
            ctx.route('https://www.googletagmanager.com/**',lambda r:r.abort())
            return ctx
        ctx=context();page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base,wait_until='networkidle');page.locator('#htGo').click();page.locator('#batchOpen').click()
        page.locator('#batchAFiles').set_input_files(archive)
        page.wait_for_function("document.querySelector('[data-side=A] .source-count').textContent.includes('3 PDFs')")
        page.locator('#batchBFiles').set_input_files([new,valid,scanned_new,extra])
        page.wait_for_function("document.querySelector('#batchCounts').textContent === '3 pairs'")
        assert page.locator('.pair-row').count()==3
        page.locator('#batchRun').click();page.wait_for_function("document.querySelector('#batchProgressText').textContent === 'Finished'",timeout=120000)
        assert 'Processing error' in page.locator('.pair-row').filter(has_text='E-900_rev01.pdf').inner_text()
        assert 'needs attention' in page.locator('.pair-row').filter(has_text='S-100_rev01.pdf').inner_text()
        assert 'N-999.pdf' in page.locator('#newFiles').inner_text()
        print('PASS: ZIP import, automatic filename pairing, all pages, corrupt-file isolation, scanned-page status, unpaired-new reporting',flush=True)
        row=page.locator('.pair-row').filter(has_text='T-100_rev01.pdf');row.get_by_text('Review results',exact=True).click()
        review=page.locator('dialog[open]')
        assert review.locator('.page-result').count()==2
        assert review.locator('.finding-card.dimension').count()==1
        assert review.locator('.finding-card.visual').count()>=1
        assert 'No detected differences' in review.locator('.page-result').nth(1).inner_text(), review.locator('.page-result').nth(1).inner_text()
        assert 'formatting-only' in review.inner_text()
        card=review.locator('.finding-card.dimension').first
        card.locator('select').select_option('discuss');card.locator('textarea').fill('Méretezés egyeztetendő — őű')
        review.locator('.finding-card.added textarea').fill('Keep this comment after recalculation')
        with page.expect_download() as dl:review.get_by_text('Export these results',exact=True).click()
        report=root/'report.pdf';dl.value.save_as(report)
        report_text='\n'.join(p.extract_text() for p in PdfReader(report).pages)
        assert 'Méretezés egyeztetendő' in report_text,report_text
        assert 'Width 3000' in report_text and 'Width 3200' in report_text
        assert any(p.images for p in PdfReader(report).pages)
        print('PASS: numeric + visual findings, formatting normalization, review notes, Unicode PDF report and image excerpts',flush=True)
        review.get_by_text('Close',exact=True).click()
        with page.expect_download() as dl:page.get_by_text('Save project',exact=True).click()
        project=root/'project.json';dl.value.save_as(project);saved=json.loads(project.read_text())
        assert all('file' not in f for f in saved['files']['A'])
        assert 'pcp_key' not in project.read_text()
        with page.expect_download() as dl:page.get_by_text('CSV',exact=True).click()
        csvpath=root/'report.csv';dl.value.save_as(csvpath)
        rows=list(csv.reader(io.StringIO(csvpath.read_text(encoding='utf-8-sig'))))
        assert any('Unpaired new file' in r for r in rows)
        assert any('Processing error' in r for r in rows)
        assert any('Méretezés egyeztetendő' in '|'.join(r) for r in rows)
        # Restore in a new browser context to prove it does not rely on old JS or source handles.
        ctx2=context();restored=ctx2.new_page();restored.on('pageerror',lambda e:errors.append(str(e)))
        restored.goto(base,wait_until='networkidle');restored.locator('#htGo').click();restored.locator('#batchOpen').click();restored.locator('#projectInput').set_input_files(project)
        restored.wait_for_function("document.querySelector('#batchMessage').textContent.includes('Project restored')")
        restored.locator('.pair-row').filter(has_text='T-100_rev01.pdf').get_by_text('Review results',exact=True).click()
        assert restored.locator('dialog .finding-card.dimension textarea').input_value()=='Méretezés egyeztetendő — őű'
        restored.locator('dialog').get_by_text('Close',exact=True).click()
        restored.locator('#batchAFiles').set_input_files(old);restored.wait_for_function("document.querySelector('[data-side=A] .source-count').textContent.includes('1 attached')")
        restored.locator('#batchBFiles').set_input_files(new);restored.wait_for_function("document.querySelector('[data-side=B] .source-count').textContent.includes('1 attached')")
        restored.locator('.pair-row').filter(has_text='T-100_rev01.pdf').get_by_text('Review results',exact=True).click()
        restored.locator('dialog .finding-card.dimension').get_by_text('Locate on drawing',exact=True).click()
        restored.wait_for_function("document.querySelector('#batchPane').hidden && typeof txtResult!=='undefined' && txtResult !== null")
        assert 'A 1 / B 1' in restored.locator('.batch-viewer-context').inner_text()
        print('PASS: project round-trip, source reattachment by content, review restoration and finding navigation',flush=True)
        # Late AI response is discarded after page navigation. The request is never sent externally.
        restored.route('https://api.anthropic.com/v1/messages',lambda route: route.fulfill(status=200,content_type='application/json',body=json.dumps({'content':[{'type':'text','text':'OUTDATED PAGE ONE SUMMARY'}]})))
        restored.evaluate("() => { window.aiRelease = null; window.callAnthropic = () => new Promise(resolve => { window.aiRelease = resolve; }); }")
        restored.locator('#aiSumB').click();restored.locator('#aiKey').fill('test-only-not-a-real-key');restored.locator('#aiVisual').check();restored.locator('#aiSend').click()
        restored.wait_for_function('typeof window.aiRelease === "function"')
        restored.locator('#aiX').click();restored.locator('#npB').click();restored.wait_for_function('cur === 2')
        restored.evaluate("window.aiRelease('OUTDATED PAGE ONE SUMMARY')")
        restored.wait_for_function("document.querySelector('#aiOut').textContent.includes('discarded')")
        assert restored.evaluate('lastAI === null')
        print('PASS: stale in-flight AI response cannot attach to another page',flush=True)
        # Draw an exclusion covering the changed dimension, rerun, verify it disappears.
        page.locator('.pair-row').filter(has_text='T-100_rev01.pdf').get_by_text('Exclude areas',exact=True).click()
        region=page.locator('dialog .region-canvas');page.wait_for_function("document.querySelector('.region-canvas').width > 1")
        box=region.bounding_box();assert box
        page.mouse.move(box['x']+box['width']*.17,box['y']+box['height']*.57);page.mouse.down();page.mouse.move(box['x']+box['width']*.48,box['y']+box['height']*.63,steps=5);page.mouse.up()
        page.locator('dialog').get_by_text('Save exclusions',exact=True).click()
        page.locator('#batchRun').click();page.wait_for_function("document.querySelector('#batchProgressText').textContent === 'Finished'",timeout=120000)
        row.get_by_text('Review results',exact=True).click()
        assert page.locator('dialog .finding-card.dimension').count()==0
        assert page.locator('dialog .finding-card.added textarea').input_value()=='Keep this comment after recalculation'
        print('PASS: user-drawn exclusions affect text and visual comparison',flush=True)
        page.locator('dialog').get_by_text('Close',exact=True).click()
        page.screenshot(path='/tmp/pdfdiff-workspace.png',full_page=True)
        assert not errors,errors
        print('PASS: no uncaught JavaScript errors',flush=True)
        # Partial page matches and explicit insertion mapping.
        ma=root/'M-500_rev01.pdf';mb=root/'M-500_rev02.pdf';pdf(ma)
        cover=root/'cover.pdf';c=Canvas(str(cover),pagesize=(600,800));c.drawString(90,600,'UNIQUE COVER SHEET');c.showPage();c.save()
        writer=PdfWriter();writer.add_page(PdfReader(cover).pages[0])
        for pg in PdfReader(new).pages:writer.add_page(pg)
        with mb.open('wb') as f:writer.write(f)
        mctx=context();mp=mctx.new_page();mp.on('pageerror',lambda e:errors.append(str(e)));mp.goto(base,wait_until='networkidle');mp.locator('#htGo').click();mp.locator('#batchOpen').click();mp.locator('#batchAFiles').set_input_files(ma);mp.wait_for_function("document.querySelector('[data-side=A] .source-count').textContent.includes('1 PDFs')");mp.locator('#batchBFiles').set_input_files(mb);mp.wait_for_function("document.querySelector('#batchCounts').textContent==='1 pairs'");mp.locator('#batchRun').click();mp.wait_for_function("document.querySelector('#batchProgressText').textContent==='Finished'")
        assert 'Review page pairing' in mp.locator('.pair-row').inner_text()
        mp.locator('.pair-row').get_by_text('Page pairing',exact=True).click();mp.locator('dialog .mapping-row select').nth(0).select_option('2');mp.locator('dialog .mapping-row select').nth(1).select_option('3');mp.locator('dialog').get_by_text('Save page pairing',exact=True).click();mp.locator('#batchRun').click();mp.wait_for_function("document.querySelector('#batchProgressText').textContent==='Finished'")
        mp.locator('.pair-row').get_by_text('Review results',exact=True).click();assert mp.locator('dialog .page-result').count()==3;assert 'New page' in mp.locator('dialog').inner_text();assert 'Old page 1 → new page 2' in mp.locator('dialog').inner_text();mp.locator('dialog').get_by_text('Close',exact=True).click()
        print('PASS: ambiguous page mapping requires review; manual pairing preserves an inserted page',flush=True)
        # A later competing revision must invalidate an earlier automatic filename match.
        dupe=root/'M-500_rev03.pdf';dupe.write_bytes(mb.read_bytes());mp.locator('#batchBFiles').set_input_files(dupe);mp.wait_for_function("document.querySelector('[data-side=B] .source-count').textContent.includes('2 PDFs')")
        assert 'Ambiguous filename' in mp.locator('.pair-row').inner_text();assert mp.locator('#batchRun').is_disabled()
        mp.locator('.pair-row select').select_option(label='M-500_rev02.pdf');assert mp.locator('#batchRun').is_enabled()
        print('PASS: competing revisions are never silently auto-selected; manual file pairing resolves ambiguity',flush=True)
        # Pause while a larger document is in progress, then resume all remaining pages.
        pa=root/'P-300_rev01.pdf';pb=root/'P-300_rev02.pdf';pdf(pa,pages=40);pdf(pb,True,pages=40)
        pctx=context();pp=pctx.new_page();pp.on('pageerror',lambda e:errors.append(str(e)));pp.goto(base,wait_until='networkidle');pp.locator('#htGo').click();pp.locator('#batchOpen').click();pp.locator('#batchAFiles').set_input_files(pa);pp.wait_for_function("document.querySelector('[data-side=A] .source-count').textContent.includes('1 PDFs')");pp.locator('#batchBFiles').set_input_files(pb);pp.wait_for_function("document.querySelector('#batchCounts').textContent==='1 pairs'");pp.locator('#batchRun').click();pp.wait_for_function("document.querySelector('#batchProgressText').textContent.includes(' · page ')");pp.locator('#batchPause').click();pp.wait_for_function("document.querySelector('#batchProgressText').textContent.startsWith('Paused')")
        assert '40/40' not in pp.locator('.pair-row').inner_text();pp.locator('#batchRun').click();pp.wait_for_function("document.querySelector('#batchProgressText').textContent==='Finished'",timeout=120000);assert '40/40' in pp.locator('.pair-row').inner_text()
        print('PASS: pause retains partial results and resume processes all 40 pages',flush=True)
        assert not errors,errors
        mctx.close();pctx.close()
        # Actual OCR path, opt in because its language model is ~11 MB.
        if os.environ.get('PDFDIFF_TEST_OCR')=='1':
            octx=context();op=octx.new_page();op.goto(base,wait_until='networkidle');op.locator('#htGo').click();op.locator('#batchOpen').click();op.locator('#batchAFiles').set_input_files(scanned_old);op.wait_for_function("document.querySelector('[data-side=A] .source-count').textContent.includes('1 PDFs')");op.locator('#batchBFiles').set_input_files(scanned_new);op.wait_for_function("document.querySelector('#batchCounts').textContent === '1 pairs'");op.locator('#batchOCR').check();op.locator('#batchRun').click();op.wait_for_function("document.querySelector('#batchProgressText').textContent === 'Finished'",timeout=180000);op.locator('.pair-row').get_by_text('Review results',exact=True).click();assert 'OCR was used' in op.locator('dialog').inner_text();assert op.locator('dialog .finding-card.dimension').count()>=1;print('PASS: real OCR worker and language model recognize a scanned dimension change',flush=True);octx.close()
        browser.close()
    server.shutdown()
