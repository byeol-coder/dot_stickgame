// 스틱 무대 스모크 테스트 (jsdom): 커밋 전 1회성 검증 스크립트.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

const html = readFileSync('./game-source.html', 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://example.com/game-source.html',
  pretendToBeVisual: true,
  beforeParse(window) {
    // jsdom 미지원 API 스텁
    window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }));
    window.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect(){}, fillRect(){}, beginPath(){}, arc(){}, fill(){}, save(){}, restore(){},
      createLinearGradient: () => ({ addColorStop(){} }),
      createRadialGradient: () => ({ addColorStop(){} }),
      set fillStyle(v){}, get fillStyle(){ return ''; },
      set shadowColor(v){}, set shadowBlur(v){},
    });
    window.speechSynthesis = { speak(u){ if (u && u.onend) setTimeout(u.onend, 0); }, cancel(){}, getVoices: () => [] };
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.fetch = () => Promise.reject(new Error('no network in test'));
    window.AudioContext = undefined; // sfx는 무음 경로로
    window.requestAnimationFrame = cb => setTimeout(cb, 0);
  },
});

const { window } = dom;
const { document } = window;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

const live = () => [...document.querySelectorAll('#stickRow .lstick')].filter(el => !el.classList.contains('is-taken'));

await sleep(120);

console.log('1. 시작 화면 → 게임 시작');
document.getElementById('startBtn').click();
await sleep(80);
ok(!document.getElementById('screenPlay').classList.contains('hidden'), '플레이 화면 표시');
ok(live().length === 10, `스틱 무대에 10개 생성 (실제 ${live().length})`);
ok(document.querySelector('#screenPlay .preview-wrap').classList.contains('is-collapsed'), '미리보기 기본 접힘');
ok(document.getElementById('previewToggleBtn').getAttribute('aria-expanded') === 'false', '토글 aria-expanded=false');

console.log('2. 선택 예고(arm)');
document.getElementById('choice2').click();
await sleep(30);
ok(document.querySelectorAll('#stickRow .lstick.is-armed').length === 2, '2개 선택 시 2개 armed');
document.getElementById('choice1').click();
await sleep(30);
ok(document.querySelectorAll('#stickRow .lstick.is-armed').length === 1, '1개 선택 시 1개 armed');

console.log('3. 가져가기 + 닷 고민/응수');
document.getElementById('takeBtn').click();
await sleep(60);
ok(document.querySelectorAll('#stickRow .lstick.is-taken').length >= 1, '가져간 스틱 is-taken');
const tag = document.getElementById('turnTag');
await sleep(400);
ok(tag.classList.contains('is-thinking') || tag.textContent.includes('고민'), '닷 고민 중 표시');
await sleep(2200);
ok(live().length >= 7 && live().length <= 8, `닷 응수 후 스틱 감소 (남은 ${live().length}, 7~8 기대)`);
ok(tag.textContent === '당신 차례', '차례 복귀');
ok(document.getElementById('statusLine').textContent.includes('남았어요'), '상태 줄 토스트 텍스트');
ok(String(live().length) === document.getElementById('countBig').textContent, '무대 스틱 수 = countBig');

console.log('4. 미리보기 토글');
document.getElementById('previewToggleBtn').click();
await sleep(30);
ok(!document.querySelector('#screenPlay .preview-wrap').classList.contains('is-collapsed'), '펼치기 동작');
ok(document.getElementById('previewToggleBtn').getAttribute('aria-expanded') === 'true', 'aria-expanded=true');
document.getElementById('previewToggleBtn').click();
await sleep(30);

console.log('5. 마지막 빛까지 강제 진행');
// 내부 상태를 직접 만지지 않고 UI로만: 계속 가져가서 1개 상태 도달 시도
for (let i = 0; i < 12 && live().length > 1; i++) {
  const btn2 = document.getElementById('choice2');
  if (!btn2.disabled && live().length > 2) btn2.click();
  else document.getElementById('choice1').click();
  await sleep(20);
  const take = document.getElementById('takeBtn');
  if (!take.disabled) take.click();
  await sleep(2600); // 닷 고민 + 응수 대기
  if (!document.getElementById('screenResult').classList.contains('hidden')) break;
}
const resultShown = !document.getElementById('screenResult').classList.contains('hidden');
const lastLightOn = document.getElementById('stickStage').classList.contains('is-last-light');
ok(resultShown || live().length >= 1, `게임 진행 종착 (결과화면=${resultShown}, 남은=${live().length}, last-light=${lastLightOn})`);
if (!resultShown && live().length === 1) ok(lastLightOn, '스틱 1개 → is-last-light 점등');

console.log('6. 결과/재시작 레이스');
if (!resultShown) {
  // 마지막 1개 가져가 승리
  document.getElementById('choice1').click();
  await sleep(20);
  document.getElementById('takeBtn').click();
  await sleep(1200);
}
ok(!document.getElementById('screenResult').classList.contains('hidden'), '결과 화면 도달');
document.getElementById('againBtn').click();
await sleep(150);
ok(live().length === 10, `재시작 후 무대 10개 재구성 (실제 ${live().length})`);
ok(!document.getElementById('stickStage').classList.contains('is-last-light') || live().length === 1, '재시작 시 last-light 해제');

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
