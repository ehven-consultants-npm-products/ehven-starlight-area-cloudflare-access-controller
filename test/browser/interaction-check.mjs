
const check = (value, message) => { if (!value) throw Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(condition) {
 for(let i=0;i<30;i++){ if(condition())return; await tick(); }
 throw Error('DOM did not update');
}
try {
 const identity = document.querySelector('[data-access-identity]');
 const overview = document.querySelector('#test-overview');
 const lesson = document.querySelector('#test-lesson');
 const originalLabel = overview.querySelector('span');
 await until(() => overview.dataset.courseLocked === 'true');
 check(identity.textContent === 'first@example.org', 'identity');
 check(reads === 1, 'shared snapshot');
 check(overview.getAttribute('href') === '/previews/two/', 'PRA link');
 check(!!overview.querySelector('svg[aria-hidden=true]'), 'decorative lock');
 check(overview.getAttribute('aria-label').includes('request access'), 'accessible label');
 check(lesson.hidden, 'lesson hidden');
 check(document.querySelector('site-search').hasAttribute('data-access-unavailable'), 'search hidden');
 const shortcut = new KeyboardEvent('keydown', {key:'k',ctrlKey:true,cancelable:true});
 window.dispatchEvent(shortcut);
 check(shortcut.defaultPrevented,'shortcut suppressed');
 allowed = true;
 document.dispatchEvent(new Event('astro:before-swap'));
 check(identity.hidden && !lesson.hidden, 'cleanup');
 check(overview.getAttribute('href') === '/course/two/', 'original href restored');
 check(originalLabel === overview.querySelector('span') && !originalLabel.querySelector('svg'), 'original label retained');
 document.dispatchEvent(new Event('astro:page-load'));
 await until(() => identity.textContent === 'second@example.org');
 check(reads === 2, 'fresh snapshot after remount');
 check(!document.querySelector('site-search').hasAttribute('data-access-unavailable'), 'search available to all-grant learner');
 window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}));
 window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}));
 await until(() => identity.textContent === 'second@example.org');
 check(reads === 3, 'fresh snapshot after restore');
 document.documentElement.dataset.accessResult = 'PASS';
} catch(error) {
 document.documentElement.dataset.accessResult = 'FAIL: ' + error.message;
}
