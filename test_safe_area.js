// Safe areas (safeArea.js): when the page trusts the browser's insets.
import { trustInsets, _viewportWith } from './safeArea.js';

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const S25_DDG = 'Mozilla/5.0 (Linux; Android 15; SM-S938U Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 DuckDuckGo/5';
const S25_CHROME = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

check(trustInsets({ userAgent: IPHONE }), 'an iPhone keeps its insets (the home indicator is real)');
check(trustInsets({ userAgent: DESKTOP }), 'a computer keeps its insets (they are zero anyway)');
check(!trustInsets({ userAgent: S25_DDG }), 'an Android in-app browser tab drops them (the status and nav bars are outside the page)');
check(!trustInsets({ userAgent: S25_CHROME }), 'an Android Chrome tab drops them');
check(trustInsets({ userAgent: S25_CHROME, fullscreen: true }), 'an Android page in fullscreen keeps them (it IS under the bars)');
check(trustInsets({ userAgent: S25_DDG, standalone: true }), 'an installed Android page keeps them');

const base = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
check(_viewportWith(base, false) === 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no', `dropping cover keeps the rest: ${_viewportWith(base, false)}`);
check(_viewportWith(_viewportWith(base, false), true) === base, 'and putting it back restores the meta exactly');
check(_viewportWith(base, true) === base, 'cover is never doubled');

if (fails.length) { console.error('FAIL: safe area\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('PASS: safe area -- iPhones and computers keep the browser\'s insets, an Android tab drops them (its status and nav bars are outside the page) unless fullscreen or installed, and the viewport meta round-trips');
