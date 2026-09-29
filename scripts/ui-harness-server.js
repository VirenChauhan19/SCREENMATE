/** Local UI fixture server. No real profiles, credentials, or employer requests. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = new Set([
  '/fixtures/ui/panel.html', '/fixtures/ui/panel.js',
  '/fixtures/ui/chrome.js', '/fixtures/ui/form.html',
  '/fixtures/ui/compatibility.js',
  '/extension/options/options.html', '/extension/options/options.js',
  '/extension/popup/popup.html', '/extension/popup/popup.js', '/extension/popup/common.js',
  ...['scan', 'act', 'nav', 'prefs', 'panel', 'frames', 'main'].map(n => `/extension/content/${n}.js`),
]);
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  const file = url.pathname === '/' ? '/fixtures/ui/panel.html' : url.pathname;
  const cases = { greenhouse: 'portals/greenhouse.html', lever: 'portals/lever.html',
    ashby: 'portals/ashby.html', taleo: 'portals/taleo-frame.html', workday: 'workday.html',
    edgecases: 'ui/edgecases.html' };
  if (['/compatibility','/compatibility-page'].includes(file) && cases[url.searchParams.get('case')]) {
    const name = url.searchParams.get('case');
    const scripts = ['scan','act','nav','prefs'].map(n => `<script src="/extension/content/${n}.js"></script>`).join('');
    const source = fs.readFileSync(path.join(root,'fixtures',cases[name]),'utf8')
      .replace('</body>', `<div id="compatibility-results" role="status"></div><button id="run-compatibility">Run compatibility checks</button>${scripts}<script src="/fixtures/ui/compatibility.js" data-case="${name}"></script></body>`);
    const html=source.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if (file === '/compatibility-page') { res.end(source); return; }
    res.end(`<html><body style="margin:0"><iframe title="Compatibility fixture" style="border:0;width:100%;height:100vh" srcdoc="${html}"></iframe></body></html>`);return;
  }
  // Keep the fixture separate from an already-installed SCREENMATE content script.
  // Its real manifest does not inject into srcdoc frames.
  if (file === '/integration' || file === '/performance' || file === '/autofill') {
    let source = fs.readFileSync(path.join(root,'fixtures/ui/form.html'),'utf8');
    if (file === '/autofill') source = source.replace('/fixtures/ui/chrome.js','/fixtures/ui/chrome.js?mode=autofill')
      .replace('<label>Desired salary', '<label>Notice period?<input name="noticeAgain" required></label><label>Desired salary')
      .replace('</body>', `<script>
        document.querySelector('[name=sponsorship]').addEventListener('change', () => {
          if (!document.querySelector('[name=school]')) {
            const label = document.createElement('label'); label.textContent = 'School';
            const input = document.createElement('input'); input.name = 'school'; input.required = true;
            label.append(input); document.querySelector('form').append(label);
          }
        });
      </script></body>`);
    if (file === '/performance') source = source.replace('/fixtures/ui/chrome.js','/fixtures/ui/chrome.js?mode=performance')
      .replace(/<label>Notice period.*?<\/label>/, '<label>University<input name="university" required></label>')
      .replace(/<label>Do you require sponsorship\?.*?<\/label>/, '<label>Degree<input name="degree" required></label>')
      .replace(/<label>Desired salary.*?<\/label>/, '<label>Portfolio<input name="portfolio" required></label>')
      .replace('</body>', '<script src="/fixtures/ui/performance.js"></script></body>');
    const html = source.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<html><body style="margin:0"><iframe title="Local application fixture" style="border:0;width:100%;height:100vh" srcdoc="${html}"></iframe></body></html>`); return;
  }
  if (file === '/api/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok:true,requiresKey:false,configured:{openrouter:true,exa:true}})); return;
  }
  if (!allowed.has(file) && file !== '/fixtures/ui/performance.js') { res.writeHead(404).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  if (file.endsWith('.html') && file.startsWith('/extension/')) {
    res.end(fs.readFileSync(path.join(root, file), 'utf8').replace('<head>', '<head><script src="/fixtures/ui/chrome.js"></script>'));
  } else fs.createReadStream(path.join(root, file)).pipe(res);
}).listen(8101, '127.0.0.1', () => console.log('UI fixtures: http://127.0.0.1:8101'));
