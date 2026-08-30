import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5199/modal-preview.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const of = await p.evaluate(() => ({ docW: document.documentElement.scrollWidth, winW: window.innerWidth }));
console.log('horizontal overflow?', JSON.stringify(of));
await p.screenshot({ path: '/private/tmp/claude-501/-Users-deep-Code-happy-DeepFamily/8d1d8ed1-06c4-4e77-bd6c-19f3b02a9986/scratchpad/phone.png', fullPage: true });
await b.close();
