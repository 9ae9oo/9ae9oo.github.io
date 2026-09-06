// 실행: deno run --allow-read scripts/test-dashboard-store.js
// 실제 브라우저 저장소 대신 작은 테스트용 보관함을 써서 사용자 데이터를 건드리지 않습니다.
globalThis.window = globalThis;
let saved = null;
globalThis.localStorage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
globalThis.MW = { util: { debounce: fn => fn, toast: () => {}, uid: type => type + '-test' } };
for (const file of ['js/app.js', 'js/store.js', 'js/settings.js', 'js/shell.js']) {
  new Function(Deno.readTextFileSync(file));
}
new Function(Deno.readTextFileSync('js/store.js'))();
function check(ok, label) { if (!ok) throw new Error(label); console.log('PASS ' + label); }
function restore(data) { MW.store.importJson(JSON.stringify(data)); return MW.store.state; }

const old = MW.store.defaults();
old.version = 6;
old.works = [];
old.memos = [{ id: 'memo-test', body: 'keep', createdAt: 1, updatedAt: 1, locked: false, bookmarked: false }];
old.settings.homeWidgets = [
  { id: 'money', type: 'money', enabled: true },
  { id: 'next', type: 'next', enabled: false },
  { id: 'today', type: 'today', enabled: true },
  { id: 'habits', type: 'habits', enabled: false }
];
old.settings.homeCardSpans = { today: 3, money: 2, invalid: 9 };
old.settings.homeCardHeights = { today: 300 };
old.settings.theme.dashRowHeight = 'invalid';
let state = restore(old);
check(state.version === 7, 'schema version');
check(state.settings.homeWidgets.map(w => w.type).join(',') === 'money,tomorrow,postponed,today,habits', 'split preserves position');
check(state.settings.homeWidgets.slice(1, 3).every(w => !w.enabled), 'split preserves hidden state');
check(state.settings.homeCardSpans.today === 4 && state.settings.homeCardSpans.money === 2, 'old full width and custom width');
check(state.settings.homeCardSpans.tomorrow === 1 && state.settings.homeCardSpans.postponed === 1, 'split starts at one cell');
check(state.settings.homeCardRowSpans.today === 3, 'pixel height converts to rows');
check(state.settings.theme.dashRowHeight === 'normal' && !state.settings.homeCardSpans.invalid, 'invalid settings repaired');
check(state.works.length === 0 && state.memos[0].body === 'keep', 'user data and intentionally empty works preserved');
state.settings.homeCardRowSpans.today = 4;
state.settings.homeCardSpans.tomorrow = 4;
const once = JSON.stringify(state);
check(JSON.stringify(restore(state)) === once, 'reload does not repeat migration or reset four-cell sizes');
const legacy = restore({ version: 3, settings: { homeOrder: ['inbox', 'calendar'] } });
check(legacy.settings.homeWidgets.filter(w => w.type !== 'image').slice(0, 3).map(w => w.type).join(',') === 'tomorrow,postponed,today', 'legacy homeOrder converts');
const fresh = MW.store.defaults();
check(fresh.settings.homeWidgets.filter(w => w.type === 'tomorrow' || w.type === 'postponed').length === 2, 'fresh install has split cards');
console.log('Dashboard syntax and migration checks passed.');
