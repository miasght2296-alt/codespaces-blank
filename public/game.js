document.addEventListener('contextmenu', e => e.preventDefault());

const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let map = [], players = {}, bullets = [], buffs = [], mapW = 20, mapH = 20, cellSize = 20;
let myConfig = { mode: '', diff: '', tank: 'T01' }, inMatch = false;

// Hệ thống Nhạc và Âm thanh
let isMuted = false, vol = 1.0;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let bgmInterval = null;

function playSound(type) {
    if (isMuted) return;
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    if (type === 'shoot') { osc.type = 'square'; osc.frequency.setValueAtTime(150, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1); gain.gain.setValueAtTime(0.4 * vol, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
    if (type === 'hit') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.3); gain.gain.setValueAtTime(0.8 * vol, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3); osc.start(); osc.stop(audioCtx.currentTime + 0.3); }
    if (type === 'click') { osc.type = 'sine'; osc.frequency.setValueAtTime(600, audioCtx.currentTime); gain.gain.setValueAtTime(0.2 * vol, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05); osc.start(); osc.stop(audioCtx.currentTime + 0.05); }
}

function playBGM() {
    if (bgmInterval) clearInterval(bgmInterval);
    const notes = [150, 200, 150, 220]; let step = 0;
    bgmInterval = setInterval(() => {
        if (isMuted || !inMatch) return;
        let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
        osc.type = 'triangle'; osc.frequency.value = notes[step % 4];
        osc.connect(gain); gain.connect(audioCtx.destination);
        gain.gain.setValueAtTime(0.1 * vol, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2); step++;
    }, 400);
}
function stopBGM() { if (bgmInterval) clearInterval(bgmInterval); }

function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function selectMode(m) {
    playSound('click'); myConfig.mode = m;
    if (m === 'pve') showScreen('screenDifficulty');
    else if (m === 'random') showScreen('screenTank');
    else showScreen('screenTank');
}
function selectDiff(d) { playSound('click'); myConfig.diff = d; showScreen('screenTank'); }
function showJoinRoom() { playSound('click'); showScreen('screenJoin'); }
function updateTankUI() { playSound('click'); document.querySelectorAll('.tank-card').forEach(c => c.classList.remove('selected')); document.getElementById('card-' + myConfig.tank).classList.add('selected'); }

function openSettings() { playSound('click'); document.getElementById('modalSettings').style.display = 'flex'; }
function closeSettings() { playSound('click'); document.getElementById('modalSettings').style.display = 'none'; }
function toggleTheme() { document.body.classList.toggle('light-mode'); playSound('click'); }
function changeVol() { vol = document.getElementById('volSlider').value / 100; if (vol > 0) { isMuted = false; document.getElementById('muteIcon').innerText = '🔊'; } playSound('click'); }
function toggleMute() { isMuted = !isMuted; document.getElementById('muteIcon').innerText = isMuted ? '🔇' : '🔊'; document.getElementById('volSlider').value = isMuted ? 0 : vol * 100; playSound('click'); }

function quitGame() {
    playSound('click');
    if (!inMatch) { closeSettings(); showScreen('screenMode'); return; }
    if (confirm("Đang trong trận, thoát sẽ bị tính THUA. Chắc chưa?")) {
        socket.emit('quitGame'); backToMenu();
    }
}

function backToMenu() {
    playSound('click');
    stopBGM();
    inMatch = false;
    document.getElementById('gameOverModal').style.display = 'none';
    closeSettings();
    if (document.exitFullscreen) document.exitFullscreen().catch(e => { });
    showScreen('screenMode');
    socket.emit('leaveRoom');
}

function playAgain() {
    playSound('click');
    document.getElementById('gameOverModal').style.display = 'none';
    startGame();
}

function cancelMatch() {
    playSound('click');
    socket.emit('leaveRoom');
    backToMenu();
}

function startGame() {
    playSound('click');
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(e => { });
    showScreen('screenGame');
    document.getElementById('gameOverModal').style.display = 'none';

    if (myConfig.mode === 'random') {
        document.getElementById('matchTitle').innerText = "TÌM KIẾM ĐỐI THỦ...";
        document.getElementById('matchSub').innerText = "Ghép trận ngẫu nhiên toàn cầu";
        socket.emit('joinRandom', myConfig);
    } else {
        document.getElementById('matchTitle').innerText = "ĐANG TẠO PHÒNG...";
        document.getElementById('matchSub').innerText = "Hãy gửi mã phòng cho bạn bè";
        socket.emit('createRoom', myConfig);
    }
}

function joinRoomByCode() {
    let code = document.getElementById('roomCodeInp').value;
    if (!code) return alert("Chưa nhập mã phòng kìa Yorrn!");
    playSound('click'); if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(e => { });
    showScreen('screenGame'); socket.emit('joinRoom', { roomId: code, tank: myConfig.tank });
}

const zone = document.getElementById('joystickZone'); const knob = document.getElementById('joystickKnob');
let joyActive = false;
zone.addEventListener('touchstart', (e) => { joyActive = true; handleJoy(e.touches[0]); });
zone.addEventListener('touchmove', (e) => { e.preventDefault(); if (joyActive) handleJoy(e.touches[0]); });
zone.addEventListener('touchend', () => { joyActive = false; knob.style.transform = `translate(0px, 0px)`; });

function handleJoy(t) {
    let rect = zone.getBoundingClientRect();
    let cx = rect.left + rect.width / 2; let cy = rect.top + rect.height / 2;
    let dx = t.clientX - cx; let dy = t.clientY - cy;
    let dist = Math.min(Math.hypot(dx, dy), 35);
    let angle = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;
    socket.emit('joystickMove', { angle: angle, force: dist / 35 });
}

document.getElementById('btnShoot').addEventListener('touchstart', (e) => { e.preventDefault(); playSound('shoot'); socket.emit('shoot'); });

const winPraise = ["Đỉnh cao! Bạn múa xe như Faker!", "Chiến thắng áp đảo, đối thủ chỉ biết khóc!", "Mắt quạ tay ưng, tay to xử lý khét lẹt!", "Bắn ảo thật đấy, vị thần xe tăng là đây!"];
const loseMock = ["Ủa alo? Lái xe hay đi bộ dạo phố vậy?", "Trời ơi, tự đâm đầu vào đạn luôn?", "Lắp não vào trước khi bắn nhé bạn ơi!", "Thua đậm! Đề nghị xóa game tải lại."];

socket.on('init', (d) => {
    map = d.map; mapW = d.w; mapH = d.h;
    canvas.width = mapW * 20; canvas.height = mapH * 20;
    cellSize = 20;
    document.getElementById('status').innerText = d.msg;

    if (d.waiting) {
        document.getElementById('matchmakingModal').style.display = 'flex';
        inMatch = false; stopBGM();
    } else {
        document.getElementById('matchmakingModal').style.display = 'none';
        if (audioCtx.state === 'suspended') audioCtx.resume();
        inMatch = true; playBGM();
    }
});

socket.on('updateState', (d) => { players = d.players; bullets = d.bullets; buffs = d.buffs; requestAnimationFrame(draw); });

socket.on('opponentLeft', () => {
    document.getElementById('status').innerText = "Đối thủ đã thoát phòng!";
    stopBGM();
    setTimeout(() => { backToMenu(); }, 2000);
});

socket.on('gameOver', (d) => {
    inMatch = false; stopBGM(); playSound('hit');

    // SỬA LỖI KẸT NÚT ĐIỀU KHIỂN: Reset ngay cần gạt Joystick về 0
    joyActive = false;
    document.getElementById('joystickKnob').style.transform = `translate(0px, 0px)`;

    let isWin = (socket.id === d.winnerId);
    let modal = document.getElementById('gameOverModal');
    let title = document.getElementById('goTitle');
    let evalText = document.getElementById('goEval');

    document.getElementById('matchmakingModal').style.display = 'none';
    modal.style.display = 'block';
    if (isWin) {
        title.innerText = "BẠN ĐÃ THẮNG! 🏆"; title.className = "win-text";
        evalText.innerText = "Đánh giá AI: " + winPraise[Math.floor(Math.random() * winPraise.length)];
    } else {
        title.innerText = "BẠN ĐÃ THUA! 💀"; title.className = "lose-text";
        evalText.innerText = "Đánh giá AI: " + loseMock[Math.floor(Math.random() * loseMock.length)];
    }
});

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#27ae60'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2ecc71';
    for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
            if ((x + y) % 2 === 0) ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }

    for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
            if (map[y][x] === 1) {
                ctx.fillStyle = '#7f8c8d'; ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                ctx.fillStyle = '#95a5a6'; ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize - 5);
            }
        }
    }

    buffs.forEach(b => {
        ctx.fillStyle = b.type === 'speed' ? '#00d2d3' : '#ff9f43';
        ctx.beginPath(); ctx.arc(b.x * cellSize, b.y * cellSize, cellSize * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '12px Arial'; ctx.fillText(b.type === 'speed' ? '>>' : '~', b.x * cellSize - 6, b.y * cellSize + 4);
    });

    for (let id in players) {
        let p = players[id]; if (p.hp <= 0) continue;
        let sX = p.x * cellSize; let sY = p.y * cellSize; let size = cellSize * 0.9;

        if (p.hasSpeedBuff) { ctx.beginPath(); ctx.arc(sX, sY, size, 0, Math.PI * 2); ctx.strokeStyle = '#00d2d3'; ctx.lineWidth = 2; ctx.stroke(); }
        if (p.hasSlowDebuff) { ctx.beginPath(); ctx.arc(sX, sY, size, 0, Math.PI * 2); ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = 2; ctx.stroke(); }

        ctx.save(); ctx.translate(sX, sY); ctx.rotate(p.angle);
        if (p.tank === 'T01') {
            ctx.fillStyle = '#111'; ctx.fillRect(-size / 1.8, -size / 1.3, size * 1.1, size / 3); ctx.fillRect(-size / 1.8, size / 1.3 - size / 3, size * 1.1, size / 3);
            ctx.fillStyle = '#2d3436'; ctx.fillRect(-size / 2, -size / 2, size, size);
            ctx.fillStyle = '#e74c3c'; ctx.fillRect(size / 3, -size / 2, size / 6, size);
            ctx.fillStyle = '#636e72'; ctx.fillRect(size / 4, -size / 8, size, size / 4);
            ctx.fillStyle = '#e74c3c'; ctx.fillRect(size, -size / 8, size / 6, size / 4);
            ctx.fillStyle = '#1e272e'; ctx.fillRect(-size / 4, -size / 3, size / 1.5, size / 1.5);
        } else {
            ctx.fillStyle = '#2c3e50'; ctx.fillRect(-size / 2.2, -size / 1.2, size, size / 3.5); ctx.fillRect(-size / 2.2, size / 1.2 - size / 3.5, size, size / 3.5);
            ctx.fillStyle = '#4b5320'; ctx.fillRect(-size / 2, -size / 2.2, size, size * 0.9);
            ctx.fillStyle = '#556b2f'; ctx.fillRect(size / 4, -size / 10, size * 0.9, size / 5);
            ctx.beginPath(); ctx.arc(0, 0, size / 2.5, 0, Math.PI * 2); ctx.fillStyle = '#3a4216'; ctx.fill();
            ctx.beginPath(); ctx.arc(0, 0, size / 8, 0, Math.PI * 2); ctx.fillStyle = '#ecf0f1'; ctx.fill();
        }
        ctx.restore();
    }
    bullets.forEach(b => {
        ctx.beginPath(); ctx.arc(b.x * cellSize, b.y * cellSize, cellSize * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = '#f1c40f'; ctx.shadowBlur = 10; ctx.shadowColor = '#f39c12'; ctx.fill(); ctx.shadowBlur = 0;
    });
}
