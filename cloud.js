const $ = id => document.getElementById(id);
const lock = $('cloudLock');
const status = $('cloudStatus');

const baseRoster = structuredClone(DEFAULT_ROSTER);

let syncing = false;
let loaded = false;
let seen = '';
let pending = 0;
let refreshing = false;
let loggingOut = false;
const logoutButton = $('cloudLogout');

const SYNC_INTERVAL = 1000;
const IDLE_TIMEOUT = 30000;
let lastInteraction = Date.now();
let idleNotified = false;
const syncButton = document.createElement('button');
syncButton.type = 'button';
syncButton.textContent = '↻ 동기화';
syncButton.title = '서버 최신 데이터 가져오기';
syncButton.style.cssText = 'margin-left:8px;padding:5px 9px;border:1px solid #cad4d0;border-radius:7px;background:#fff;color:#365e51;cursor:pointer;font-size:12px';
status.insertAdjacentElement('afterend', syncButton);
syncButton.addEventListener('click', () => { lastInteraction = Date.now(); idleNotified = false; refresh(); });
for (const eventName of ['pointerdown', 'keydown']) {
  document.addEventListener(eventName, () => {
    const idle = Date.now() - lastInteraction >= IDLE_TIMEOUT;
    lastInteraction = Date.now();
    if (idle && !document.hidden) refresh();
  }, { passive: true });
}


const api = async (path, options = {}) => {
  const res = await fetch('/api/' + path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options
  });

  const body = await res.json().catch(() => ({
    error: '서버 응답을 읽지 못했습니다.'
  }));

  if (!res.ok) {
    throw Object.assign(
      Error(body.error || '요청 실패'),
      { status: res.status }
    );
  }

  return body;
};

const post = (path, data) => api(path, {
  method: 'POST',
  headers: {
    'content-type': 'application/json'
  },
  body: JSON.stringify(data)
});

function changesBetween(before, after) {
  const changes = [];

  const old = new Map(
    before.roster.map(p => [p.id, p])
  );

  const now = new Map(
    after.roster.map(p => [p.id, p])
  );

  for (const [id, p] of now) {
    const prior = old.get(id);

    if (!prior) {
      changes.push({
        type: 'roster',
        action: 'add',
        id,
        name: p.name
      });
    } else {
      if (p.name !== prior.name) {
        changes.push({
          type: 'roster',
          action: 'rename',
          id,
          name: p.name
        });
      }

      if (!!p.lunchExempt !== !!prior.lunchExempt) {
        changes.push({
          type: 'roster',
          action: 'exempt',
          id,
          value: !!p.lunchExempt
        });
      }
    }
  }

  for (const id of old.keys()) {
    if (!now.has(id)) {
      changes.push({
        type: 'roster',
        action: 'delete',
        id
      });
    }
  }

  for (const field of [
    'off',
    'early',
    'lunchDone',
    'dinnerNo',
    'attendance'
  ]) {
    const oldSet = new Set(
      before.daily[field] || []
    );

    const newSet = new Set(
      after.daily[field] || []
    );

    for (const id of new Set([
      ...oldSet,
      ...newSet
    ])) {
      if (oldSet.has(id) !== newSet.has(id)) {
        changes.push({
          type: 'status',
          field,
          id,
          value: newSet.has(id)
        });
      }
    }
  }

  const oldDep = new Map(
    (before.daily.lunchDepartures || [])
      .map(x => [x.id, x])
  );

  const newDep = new Map(
    (after.daily.lunchDepartures || [])
      .map(x => [x.id, x])
  );

  for (const id of new Set([
    ...oldDep.keys(),
    ...newDep.keys()
  ])) {
    if (oldDep.has(id) !== newDep.has(id)) {
      changes.push({
        type: 'departure',
        id,
        value: newDep.has(id)
      });
    }
  }

  return changes;
}

window.computeChanges = changesBetween;

function project(events, today) {
  const persons = new Map(
    baseRoster.map(p => [p.id, { ...p }])
  );

  const days = new Map();

  const getDay = day => {
    if (!days.has(day)) {
      days.set(day, {
        date: day,
        attendance: [],
        off: [],
        early: [],
        lunchDone: [],
        lunchDepartures: [],
        dinnerNo: [],
        undo: null
      });
    }

    return days.get(day);
  };

  for (const event of events) {
    const d = getDay(event.day);

    for (const c of event.changes || []) {
      if (c.type === 'roster') {
        if (c.action === 'add') {
          persons.set(c.id, {
            id: c.id,
            name: c.name,
            lunchExempt: false
          });
        } else if (c.action === 'delete') {
          persons.delete(c.id);
        } else if (
          c.action === 'rename' &&
          persons.has(c.id)
        ) {
          persons.get(c.id).name = c.name;
        } else if (
          c.action === 'exempt' &&
          persons.has(c.id)
        ) {
          persons.get(c.id).lunchExempt = c.value;
        }
      } else if (c.type === 'status') {
        const arr = d[c.field];

        if (!Array.isArray(arr)) continue;

        d[c.field] = arr.filter(x => x !== c.id);

        if (c.value) {
          d[c.field].push(c.id);
        }
      } else if (c.type === 'departure') {
        d.lunchDepartures =
          d.lunchDepartures.filter(
            x => x.id !== c.id
          );

        if (c.value) {
          d.lunchDepartures.push({
            id: c.id,
            name: persons.get(c.id)?.name || '',
            at: event.at
          });
        }
      }
    }
  }

  const yesterday = new Date(
    `${today}T12:00:00+09:00`
  );

  yesterday.setDate(
    yesterday.getDate() - 1
  );

  const yesterdayKey =
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(yesterday);

  const hist = [...days.values()]
    .filter(x => x.date !== today)
    .map(x => ({
      date: x.date,
      lunchDepartures: x.lunchDepartures
    }));

  return {
    roster: [...persons.values()],
    daily: getDay(today),
    history: hist,
    today,
    yesterdayKey
  };
}

function setStatus(message, color) {
  status.textContent = message;
  status.style.color = color;
}

async function refresh() {
  if (loggingOut || syncing || pending > 0) return;

  syncing = true;

  try {
    const result = await api('state');

    // 서버 응답을 기다리는 동안
    // 새로운 저장이 시작됐다면 화면을 덮어쓰지 않음
    if (pending > 0 || loggingOut) return;

    const fingerprint =
      JSON.stringify(result.events);

    if (
      fingerprint !== seen ||
      !loaded ||
      daily?.date !== result.today
    ) {
      const state = project(
        result.events,
        result.today
      );

      roster = state.roster;
      daily = state.daily;
      window.staffHistory = state.history;

      seen = fingerprint;
      loaded = true;

      renderHome();
      showTab(currentTab);
    }

    lock.classList.add('hidden');
    logoutButton.classList.remove('hidden');
    window._cloudReady = true;

    setStatus(
      '● 서버 연결됨',
      '#365e51'
    );
  } catch (err) {
    setStatus(
      '● 연결 오류',
      '#b65a5c'
    );

    if (err.status === 401) {
      window._cloudReady = false;
      logoutButton.classList.add('hidden');
      lock.classList.remove('hidden');
      $('cloudLoginError').textContent =
        '로그인이 필요합니다.';
    }
  } finally {
    syncing = false;
  }
}

// 저장 요청은 반드시 순서대로 처리
let queue = Promise.resolve();

window.sendChanges = changes => {
  if (!changes || !changes.length) {
    return Promise.resolve();
  }

  // 저장 대기 중인 요청 수 관리
  pending++;

  setStatus(
    '● 저장 중',
    '#ad7645'
  );

  // 저장할 날짜와 변경 사항을
  // 요청 시점에 고정
  const day = daily.date;
  const payload = structuredClone(changes);

  const job = queue.then(async () => {
    await post('change', {
      day,
      changes: payload
    });
  });

  // 실패한 요청 때문에
  // 다음 저장이 막히지 않도록 처리
  queue = job.catch(() => {});

  return job.then(
    async () => {
      pending--;

      if (pending === 0) {
        await refresh();
      }
    },
    async err => {
      pending--;

      setStatus(
        '● 저장 실패',
        '#b65a5c'
      );

      alert(
        '서버 저장 실패: ' +
        err.message +
        '\n화면을 다시 불러옵니다.'
      );

      if (pending === 0) {
        await refresh();
      }
    }
  );
};

$('cloudLoginForm').addEventListener(
  'submit',
  async e => {
    e.preventDefault();

    const button =
      e.target.querySelector('button');

    button.disabled = true;

    try {
      await post('login', {
        password: $('cloudPassword').value
      });

      $('cloudPassword').value = '';

      $('cloudLoginError').textContent = '';

      await refresh();
    } catch (err) {
      $('cloudLoginError').textContent =
        err.message;
    } finally {
      button.disabled = false;
    }
  }
);

// 서버 세션 쿠키 삭제 후 로그인 화면으로 전환
logoutButton.addEventListener('click', async () => {
  if (loggingOut) return;
  if (!confirm('로그아웃하시겠습니까?')) return;
  if (pending > 0) { alert('저장이 완료된 후 로그아웃해 주세요.'); return; }
  loggingOut = true;
  logoutButton.disabled = true;
  setStatus('● 로그아웃 중', '#ad7645');
  try {
    await post('logout', {});
    window._cloudReady = false;
    loaded = false;
    seen = '';
    $('cloudPassword').value = '';
    $('cloudLoginError').textContent = '';
    logoutButton.classList.add('hidden');
    lock.classList.remove('hidden');
    setStatus('● 로그인 필요', '#77827c');
  } catch (err) {
    alert('로그아웃 실패: ' + err.message);
  } finally {
    loggingOut = false;
    logoutButton.disabled = false;
  }
});

// 최초 실행
refresh();

// 1초 자동 동기화, 30초 미조작 시 중지
setInterval(() => {
  if (document.hidden || pending > 0 || !window._cloudReady) return;
  if (Date.now() - lastInteraction >= IDLE_TIMEOUT) {
    if (!idleNotified) setStatus('● 자동 동기화 대기', '#77827c');
    idleNotified = true;
    return;
  }
  idleNotified = false;
  refresh();
}, SYNC_INTERVAL);

// 백그라운드에서 돌아오면 즉시 동기화
document.addEventListener(
  'visibilitychange',
  () => {
    if (!document.hidden && pending === 0) {
      lastInteraction = Date.now();
      idleNotified = false;
      refresh();
    }
  }
);

// 인터넷 연결 복구 시 동기화
window.addEventListener(
  'online',
  () => {
    if (pending === 0) {
      refresh();
    }
  }
);
