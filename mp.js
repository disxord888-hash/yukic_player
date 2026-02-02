// Yuki Player Logic - Performance Optimized

// State
let queue = [];
let currentIndex = -1;
let selectedListIndex = -1;
let player = null;
let isPlayerReady = false;
let isLocked = false;
let lockTimer = null;
let lockStartTime = 0;
let isLoop = false;
let isShuffle = false;

const MAX_QUEUE = 32767;

// DOM Elements
const el = {
    nowTitle: document.getElementById('now-title'),
    nowAuthor: document.getElementById('now-author'),
    queueList: document.getElementById('queue-list'),
    queueStatus: document.getElementById('queue-status'),
    addUrl: document.getElementById('add-url'),
    addTitle: document.getElementById('add-title'),
    addAuthor: document.getElementById('add-author'),
    fileInput: document.getElementById('file-input'),
    lockOverlay: document.getElementById('lock-overlay'),
    lockProgress: document.getElementById('lock-progress'),
    btnLock: document.getElementById('btn-lock'),
    btnLoop: document.getElementById('btn-loop'),
    btnShuffle: document.getElementById('btn-shuffle')
};

function updateUIStates() {
    el.btnLoop.style.background = isLoop ? 'var(--primary)' : 'var(--bg-item)';
    el.btnShuffle.style.background = isShuffle ? 'var(--primary)' : 'var(--bg-item)';
}

// --- YouTube API ---
function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtube-player', {
        height: '100%', width: '100%', videoId: '',
        playerVars: { 'playsinline': 1, 'controls': 1, 'disablekb': 1, 'iv_load_policy': 3 },
        events: {
            'onReady': (e) => { isPlayerReady = true; },
            'onStateChange': (e) => { if (e.data === YT.PlayerState.ENDED) skipNext(); }
        }
    });
}

// --- Utilities ---
function extractId(u) {
    if (!u) return null;
    if (u.length === 11) return u;
    if (u.includes('/shorts/')) return u.split('/shorts/')[1]?.split(/[?&]/)[0];
    const m = u.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|music\.youtube\.com\/watch\?v=)([^#&?]*).*/);
    return (m && m[2].length === 11) ? m[2] : null;
}
function extractPlaylistId(u) { return u.match(/[?&]list=([^#&?]+)/)?.[1]; }

async function isStrictlyShort(id) {
    return new Promise((res) => {
        const i = new Image();
        i.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        i.onload = () => res(i.width > 0 && i.width < i.height);
        i.onerror = () => res(false);
    });
}

async function fetchMeta(id) {
    try {
        const r = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
        const d = await r.json();
        const short = await isStrictlyShort(id);
        return {
            title: d.title || "Unknown Title",
            author: d.author_name || "Unknown Artist",
            isShort: short || (d.title && d.title.toLowerCase().includes('#shorts'))
        };
    } catch (e) { return null; }
}

async function fetchPlaylistAndAdd(plId) {
    try {
        const u = `https://www.youtube.com/playlist?list=${plId}`;
        const p = `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`;
        const r = await fetch(p);
        const d = await r.json();
        const m = d.contents.match(/ytInitialData\s*=\s*(\{.*?\});/) || d.contents.match(/var ytInitialData\s*=\s*(\{.*?\});/);
        if (m) {
            const j = JSON.parse(m[1]);
            const tabs = j.contents?.twoColumnBrowseResultsRenderer?.tabs;
            const content = tabs ? tabs[0]?.content : j.contents;
            const section = (content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents)
                || (content?.playlistVideoListRenderer?.contents);

            if (section && Array.isArray(section)) {
                const total = section.length;
                let addedCount = 0;

                // Process in chunks of 10
                for (let i = 0; i < total; i += 10) {
                    const chunk = section.slice(i, i + 10);
                    for (const item of chunk) {
                        const v = item.playlistVideoRenderer;
                        if (!v || !v.videoId) continue;
                        const t = v.title?.runs?.[0]?.text || v.title?.simpleText || "Title";
                        if (t.toLowerCase().includes('#shorts')) continue;

                        if (queue.length < MAX_QUEUE) {
                            queue.push({ id: v.videoId, title: t, author: v.shortBylineText?.runs?.[0]?.text || "Artist" });
                            addedCount++;
                        }
                    }
                    // Re-render after each chunk to show progress
                    renderQueue();
                    if (currentIndex === -1 && queue.length > 0) playIndex(0);

                    // Small delay to keep UI responsive and mimic "chunk loading"
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }
    } catch (e) { console.error("PL error", e); }
}

// --- Main ---
async function addToQueue(uOrId, tIn, aIn) {
    if (queue.length >= MAX_QUEUE) return;
    const plId = extractPlaylistId(uOrId);

    if (plId) {
        await fetchPlaylistAndAdd(plId);
        return;
    }

    const id = extractId(uOrId);
    if (!id) return;

    const item = { id, title: tIn || "Loading...", author: aIn || "..." };
    queue.push(item);
    const idx = queue.length - 1;
    renderQueue();

    if (!tIn || !aIn) {
        const m = await fetchMeta(id);
        if (m) {
            if (m.isShort) {
                queue.splice(idx, 1); renderQueue();
                alert("Shorts動画（縦長）のため除外されました");
                return;
            }
            queue[idx].title = m.title; queue[idx].author = m.author;
            // Update UI directly if active
            if (currentIndex === idx) { el.nowTitle.value = m.title; el.nowAuthor.value = m.author; }
            const activeTitle = document.querySelector(`.queue-item[data-idx="${idx}"] .q-title`);
            const activeAuthor = document.querySelector(`.queue-item[data-idx="${idx}"] .q-author`);
            if (activeTitle) activeTitle.innerText = m.title;
            if (activeAuthor) activeAuthor.innerText = m.author;
        }
    }
    if (currentIndex === -1) playIndex(idx);
}

function renderQueue() {
    const frag = document.createDocumentFragment();
    el.queueList.innerHTML = '';
    queue.forEach((item, i) => {
        const li = document.createElement('li');
        li.className = `queue-item ${i === currentIndex ? 'active' : ''} ${i === selectedListIndex ? 'selected' : ''}`;
        li.setAttribute('data-idx', i);
        li.innerHTML = `<span class="q-idx">${i + 1}</span><div class="q-info"><span class="q-title">${safe(item.title)}</span><span class="q-author">${safe(item.author)}</span></div>`;
        li.onclick = () => { selectedListIndex = i; renderItemsActive(); };
        li.ondblclick = () => playIndex(i);
        frag.appendChild(li);
    });
    el.queueList.appendChild(frag);
    el.queueStatus.innerText = `${queue.length} / ${MAX_QUEUE}`;
}

function renderItemsActive() {
    document.querySelectorAll('.queue-item').forEach((li, idx) => {
        li.classList.toggle('active', idx === currentIndex);
        li.classList.toggle('selected', idx === selectedListIndex);
    });
}

function playIndex(i) {
    if (i < 0 || i >= queue.length) return;
    currentIndex = i;
    const item = queue[i];
    if (isPlayerReady) player.loadVideoById(item.id);
    el.nowTitle.value = item.title; el.nowAuthor.value = item.author;
    renderItemsActive();
    setTimeout(() => {
        const a = document.querySelector('.queue-item.active');
        if (a) a.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
}

function safe(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ""; }

function skipNext() {
    if (isLoop) return playIndex(currentIndex);
    if (isShuffle && queue.length > 1) {
        let n = currentIndex; while (n === currentIndex) n = Math.floor(Math.random() * queue.length);
        return playIndex(n);
    }
    if (currentIndex < queue.length - 1) playIndex(currentIndex + 1);
    else if (isPlayerReady) player.stopVideo();
}
function skipPrev() { if (currentIndex > 0) playIndex(currentIndex - 1); else if (isPlayerReady) player.seekTo(0); }

// Event Handlers
document.getElementById('btn-add').onclick = () => {
    addToQueue(el.addUrl.value, el.addTitle.value, el.addAuthor.value);
    el.addUrl.value = el.addTitle.value = el.addAuthor.value = '';
};
document.getElementById('btn-delete').onclick = () => {
    if (selectedListIndex >= 0) {
        queue.splice(selectedListIndex, 1);
        if (currentIndex === selectedListIndex) {
            if (queue.length > 0) { currentIndex = Math.min(currentIndex, queue.length - 1); playIndex(currentIndex); }
            else { player.stopVideo(); currentIndex = -1; }
        } else if (currentIndex > selectedListIndex) currentIndex--;
        selectedListIndex = -1; renderQueue();
    }
};
document.getElementById('btn-clear').onclick = () => {
    if (confirm("情報をすべて初期化（消去）しますか？")) { queue = []; currentIndex = selectedListIndex = -1; if (isPlayerReady) player.stopVideo(); renderQueue(); }
};
document.getElementById('btn-dedupe').onclick = () => {
    const s = new Set(); const old = queue.length; const id = currentIndex >= 0 ? queue[currentIndex].id : null;
    queue = queue.filter(x => !s.has(x.id) && s.add(x.id));
    currentIndex = id ? queue.findIndex(x => x.id === id) : -1;
    renderQueue(); alert(`重複 ${old - queue.length} 件を削除しました`);
};

// Lock Timer Logic
el.btnLock.onmousedown = el.lockOverlay.onmousedown = () => {
    lockStartTime = Date.now(); el.lockProgress.style.display = 'block';
    lockTimer = setInterval(() => {
        const p = Math.min(((Date.now() - lockStartTime) / 4000) * 100, 100);
        el.lockProgress.style.width = p + '%';
        if (p >= 100) { clearInterval(lockTimer); isLocked = !isLocked; el.lockOverlay.classList.toggle('active', isLocked); el.lockProgress.style.width = '0%'; }
    }, 50);
};
window.onmouseup = () => { if (lockTimer) { clearInterval(lockTimer); lockTimer = null; } el.lockProgress.style.display = 'none'; };

// Controls
document.getElementById('btn-prev').onclick = () => !isLocked && skipPrev();
document.getElementById('btn-next').onclick = () => !isLocked && skipNext();
document.getElementById('btn-pause').onclick = () => {
    if (!isLocked && isPlayerReady) {
        const s = player.getPlayerState();
        if (s === 1) player.pauseVideo(); else player.playVideo();
    }
};
document.getElementById('btn-stop').onclick = () => !isLocked && isPlayerReady && player.stopVideo();
document.getElementById('btn-seek-back').onclick = () => !isLocked && isPlayerReady && player.seekTo(player.getCurrentTime() - 2);
document.getElementById('btn-seek-fwd').onclick = () => !isLocked && isPlayerReady && player.seekTo(player.getCurrentTime() + 2);
document.getElementById('btn-first').onclick = () => !isLocked && playIndex(0);
document.getElementById('btn-last').onclick = () => !isLocked && playIndex(queue.length - 1);
el.btnLoop.onclick = () => { isLoop = !isLoop; updateUIStates(); };
el.btnShuffle.onclick = () => { isShuffle = !isShuffle; updateUIStates(); };

el.nowTitle.oninput = () => {
    if (currentIndex >= 0) {
        queue[currentIndex].title = el.nowTitle.value;
        const target = document.querySelector(`.queue-item[data-idx="${currentIndex}"] .q-title`);
        if (target) target.innerText = el.nowTitle.value;
    }
};
el.nowAuthor.oninput = () => {
    if (currentIndex >= 0) {
        queue[currentIndex].author = el.nowAuthor.value;
        const target = document.querySelector(`.queue-item[data-idx="${currentIndex}"] .q-author`);
        if (target) target.innerText = el.nowAuthor.value;
    }
};

// IO
document.getElementById('btn-export').onclick = () => {
    const b = new Blob([JSON.stringify(queue, null, 2)], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'playlist.txt'; a.click();
};
document.getElementById('btn-import').onclick = () => el.fileInput.click();
el.fileInput.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = (ev) => {
        try { const d = JSON.parse(ev.target.result); if (Array.isArray(d)) { queue = d.slice(0, MAX_QUEUE); currentIndex = -1; renderQueue(); if (queue.length > 0) playIndex(0); } } catch (e) { }
    }; r.readAsText(f);
};

// Keys
document.addEventListener('keydown', (e) => {
    if (isLocked || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 's') skipPrev(); else if (k === 'k') skipNext();
    else if (k === 'f') isPlayerReady && player.seekTo(player.getCurrentTime() - 2);
    else if (k === 'h') isPlayerReady && player.seekTo(player.getCurrentTime() + 2);
    else if (k === 'g') document.getElementById('btn-pause').click();
    else if (k === 'o') document.getElementById('btn-stop').click();
    else if (k === 'd') playIndex(0); else if (k === 'j') playIndex(queue.length - 1);
    else if (k === 'q') el.btnLoop.click(); else if (k === 'w') el.btnShuffle.click();
    else if (k === '[') { if (selectedListIndex >= 0) { queue.splice(selectedListIndex + 1, 0, { ...queue[selectedListIndex] }); renderQueue(); } else el.addUrl.focus(); }
    else if (k === ']') document.getElementById('btn-delete').click();
    const n = parseInt(e.key);
    if (!isNaN(n)) {
        if (n >= 1 && n <= 5) { const t = currentIndex + (n - 6); if (t >= 0) playIndex(t); }
        else { const v = n === 0 ? 10 : n; const t = currentIndex + (v - 5); if (t < queue.length) playIndex(t); }
    }
});
