"""Real browser workflow against an isolated app and deterministic mocked models."""
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from werkzeug.serving import make_server
from playwright.sync_api import sync_playwright, expect
import requests
from app import create_app
from test_knowledge import fake_model, pdf_bytes


def main():
    output = Path('data/browser-smoke')
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        app = create_app({'TESTING': True, 'SECRET_KEY': 'isolated-browser-test',
                          'DATABASE': str(Path(temp) / 'test.db'), 'AUTH_MODE': 'development',
                          'SESSION_COOKIE_SECURE': False, 'VECTOR_DATABASE_URL': ''})
        original_post = requests.post
        requests.post = fake_model
        server = make_server('127.0.0.1', 0, app, threaded=True)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='msedge', headless=True)
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(f'http://127.0.0.1:{server.server_port}')
                page.get_by_role('button', name='Enter development workspace').click()
                page.get_by_role('button', name='Admin console').click()
                page.locator('#base-url').fill('http://localhost:11434/v1')
                page.locator('#model').fill('chat-model')
                page.get_by_role('button', name='Save settings', exact=True).click()
                expect(page.locator('#toast')).to_have_text('Model settings saved')
                page.locator('#embedding-url').fill('http://localhost:11434/v1')
                page.locator('#embedding-model').fill('embed-v1')
                page.locator('#embedding-dimensions').fill('3')
                page.get_by_role('button', name='Test & save embedding settings').click()
                expect(page.locator('#toast')).to_contain_text('Embedding settings saved')
                page.screenshot(path=str(output / 'embedding-settings.png'), full_page=True)
                page.locator('[data-tab="knowledge"]').click()
                page.locator('#repo-name').fill('People policies')
                page.locator('#repo-description').fill('Internal policies and benefits')
                page.get_by_role('button', name='Create repository', exact=True).click()
                expect(page.locator('#toast')).to_have_text('Repository created')
                page.locator('#doc-repo').select_option(label='People policies')
                page.locator('#doc-file').set_input_files({'name': 'Leave policy.pdf', 'mimeType': 'application/pdf',
                    'buffer': pdf_bytes(['Introduction to company policies.', 'Annual leave allowance is 25 days.'])})
                page.get_by_role('button', name='Add to knowledge', exact=True).click()
                expect(page.locator('.index-status')).to_have_text('ready')
                page.screenshot(path=str(output / 'knowledge-ready.png'), full_page=True)
                page.get_by_role('button', name='New conversation').click()
                page.locator('#prompt').fill('How much vacation do I get?')
                page.get_by_role('button', name='Send message', exact=True).click()
                expect(page.locator('.citation')).to_have_count(1)
                expect(page.locator('.message:not(.user) .text')).to_contain_text('25 days')
                page.screenshot(path=str(output / 'answer-citations.png'), full_page=True)
                with page.expect_popup() as popup:
                    page.locator('.citation').click()
                source = popup.value
                expect(source.locator('#source-label')).to_have_text('Page 2')
                expect(source.locator('#source-excerpt')).to_contain_text('25 days')
                expect(source.locator('#source-original')).to_have_attribute('href', __import__('re').compile(r'/file#page=2$'))
                source.screenshot(path=str(output / 'source-page.png'), full_page=True)
                original = source.request.get(f'http://127.0.0.1:{server.server_port}' + source.locator('#source-original').get_attribute('href').split('#')[0])
                assert original.status == 200 and original.body().startswith(b'%PDF')
                page.set_viewport_size({'width': 390, 'height': 844})
                page.screenshot(path=str(output / 'mobile-chat.png'), full_page=True)
                assert not errors, errors
                browser.close()
                print('PASS: browser login, model settings, embeddings, PDF upload, semantic answer, page citation, protected original, mobile render')
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)
            requests.post = original_post


if __name__ == '__main__':
    main()
