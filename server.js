const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let rooms = {};
let randomQueue = null;

function generateDynamicMap() {
    let w = Math.floor(Math.random() * 10) + 25;
    let h = Math.floor(Math.random() * 10) + 25;
    let map = Array(h).fill().map(() => Array(w).fill(0));
    let mapType = Math.random();

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (x === 0 || x === w - 1 || y === 0 || y === h - 1) map[y][x] = 1;
            else {
                if (mapType < 0.3) {
                    if (x % 3 === 0 && y % 3 === 0 && Math.random() > 0.3) map[y][x] = 1;
                } else if (mapType < 0.6) {
                    if (x % 5 === 0 && y > 3 && y < h - 4) map[y][x] = 1;
                } else {
                    if (x > w / 3 && x < w * 2 / 3 && y > h / 3 && y < h * 2 / 3 && Math.random() > 0.4) map[y][x] = 1;
                }
            }
        }
    }
    map[1][1] = map[1][2] = map[2][1] = 0; map[h - 2][w - 2] = map[h - 2][w - 3] = map[h - 3][w - 2] = 0;
    return { map, w, h };
}

// Hàm dọn dẹp: Bắt người chơi thoát hết các phòng cũ trước khi vào phòng mới
function leaveOldRooms(socket) {
    socket.rooms.forEach(room => {
        if (room !== socket.id) socket.leave(room);
    });
}

// Lấy ID phòng hiện tại an toàn hơn
function getCurrentRoom(socket) {
    return Array.from(socket.rooms).find(r => r !== socket.id);
}

io.on('connection', (socket) => {

    socket.on('createRoom', (config) => {
        leaveOldRooms(socket); // Dọn phòng cũ
        let roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        let mapData = generateDynamicMap();
        rooms[roomId] = { ...mapData, players: {}, bullets: [], buffs: [], botInterval: null, config };

        socket.join(roomId);
        rooms[roomId].players[socket.id] = { x: 1.5, y: 1.5, angle: Math.PI / 4, hp: 1, tank: config.tank, type: 'human' };

        if (config.mode === 'pve') {
            rooms[roomId].players['BOT'] = { x: mapData.w - 2.5, y: mapData.h - 2.5, angle: Math.PI + Math.PI / 4, hp: 1, tank: config.tank === 'T01' ? 'T02' : 'T01', type: 'bot' };
            let shootDelay = config.diff === 'hard' ? 800 : config.diff === 'normal' ? 1500 : 2500;
            rooms[roomId].botInterval = setInterval(() => botLogic(roomId), shootDelay);
            io.to(roomId).emit('init', { ...mapData, roomId, msg: `Bắn Máy (${config.diff})`, waiting: false });
        } else {
            io.to(roomId).emit('init', { ...mapData, roomId, msg: `Phòng: ${roomId} - Chờ đối thủ...`, waiting: true });
        }
    });

    socket.on('joinRoom', (data) => {
        leaveOldRooms(socket); // Dọn phòng cũ
        let roomId = data.roomId.toUpperCase();
        if (!rooms[roomId]) return socket.emit('gameOver', { winnerId: null, loserId: socket.id });
        let r = rooms[roomId];
        let pCount = Object.keys(r.players).filter(k => r.players[k].type === 'human').length;
        if (pCount >= 2) return socket.emit('gameOver', { winnerId: null, loserId: socket.id });

        socket.join(roomId);
        r.players[socket.id] = { x: r.w - 2.5, y: r.h - 2.5, angle: Math.PI + Math.PI / 4, hp: 1, tank: data.tank, type: 'human' };
        io.to(roomId).emit('init', { map: r.map, w: r.w, h: r.h, roomId, msg: `CHIẾN ĐẤU!`, waiting: false });
    });

    socket.on('joinRandom', (config) => {
        leaveOldRooms(socket); // Dọn phòng cũ
        if (randomQueue) {
            let p1 = randomQueue;
            let p2 = { id: socket.id, tank: config.tank };
            randomQueue = null;

            let roomId = "RND" + Math.random().toString(36).substring(2, 6).toUpperCase();
            let mapData = generateDynamicMap();
            rooms[roomId] = { ...mapData, players: {}, bullets: [], buffs: [], botInterval: null, config: { mode: 'pvp' } };

            let s1 = io.sockets.sockets.get(p1.id);
            if (s1) s1.join(roomId);
            socket.join(roomId);

            rooms[roomId].players[p1.id] = { x: 1.5, y: 1.5, angle: Math.PI / 4, hp: 1, tank: p1.tank, type: 'human' };
            rooms[roomId].players[p2.id] = { x: mapData.w - 2.5, y: mapData.h - 2.5, angle: Math.PI + Math.PI / 4, hp: 1, tank: p2.tank, type: 'human' };

            io.to(roomId).emit('init', { ...mapData, roomId, msg: `Đã tìm thấy đối thủ!`, waiting: false });
        } else {
            randomQueue = { id: socket.id, tank: config.tank };
            socket.emit('init', { map: [], w: 20, h: 20, roomId: 'WAIT', msg: "Đang tìm đối thủ...", waiting: true });
        }
    });

    socket.on('joystickMove', (data) => {
        let rId = getCurrentRoom(socket); if (!rId || !rooms[rId]) return;
        let p = rooms[rId].players[socket.id]; if (!p || p.hp <= 0) return;

        p.angle = data.angle;
        let speed = p.hasSpeedBuff ? 0.12 : 0.06;
        if (p.hasSlowDebuff) speed = 0.03;

        let newX = p.x + Math.cos(p.angle) * (speed * data.force);
        let newY = p.y + Math.sin(p.angle) * (speed * data.force);

        if (rooms[rId].map[Math.floor(newY)][Math.floor(newX)] === 0) { p.x = newX; p.y = newY; }

        rooms[rId].buffs = rooms[rId].buffs.filter(b => {
            if (Math.hypot(p.x - b.x, p.y - b.y) < 1) {
                if (b.type === 'speed') { p.hasSpeedBuff = true; setTimeout(() => p.hasSpeedBuff = false, 5000); }
                if (b.type === 'slow') { p.hasSlowDebuff = true; setTimeout(() => p.hasSlowDebuff = false, 5000); }
                return false;
            }
            return true;
        });
    });

    socket.on('shoot', () => {
        let rId = getCurrentRoom(socket); if (!rId || !rooms[rId]) return;
        let p = rooms[rId].players[socket.id]; if (!p || p.hp <= 0) return;
        rooms[rId].bullets.push({ x: p.x + Math.cos(p.angle) * 0.6, y: p.y + Math.sin(p.angle) * 0.6, vx: Math.cos(p.angle) * 0.4, vy: Math.sin(p.angle) * 0.4, bounces: 0, owner: socket.id });
    });

    socket.on('quitGame', () => {
        let rId = getCurrentRoom(socket); if (!rId || !rooms[rId]) return;
        let winnerId = Object.keys(rooms[rId].players).find(id => id !== socket.id);
        io.to(rId).emit('gameOver', { winnerId: winnerId, loserId: socket.id });
        if (rooms[rId].botInterval) clearInterval(rooms[rId].botInterval);
        delete rooms[rId];
    });

    socket.on('leaveRoom', () => {
        if (randomQueue && randomQueue.id === socket.id) randomQueue = null;
        let rId = getCurrentRoom(socket);
        if (rId && rooms[rId]) {
            delete rooms[rId].players[socket.id];
            let pCount = Object.keys(rooms[rId].players).filter(k => rooms[rId].players[k].type === 'human').length;
            if (pCount === 0 || (pCount === 1 && !rooms[rId].players['BOT'])) {
                io.to(rId).emit('opponentLeft');
                if (rooms[rId].botInterval) clearInterval(rooms[rId].botInterval);
                delete rooms[rId];
            }
        }
        leaveOldRooms(socket);
    });

    socket.on('disconnect', () => {
        if (randomQueue && randomQueue.id === socket.id) randomQueue = null;
        let rId = getCurrentRoom(socket);
        if (rId && rooms[rId]) {
            delete rooms[rId].players[socket.id];
            let pCount = Object.keys(rooms[rId].players).filter(k => rooms[rId].players[k].type === 'human').length;
            if (pCount === 0 || (pCount === 1 && !rooms[rId].players['BOT'])) {
                let winnerId = Object.keys(rooms[rId].players)[0];
                io.to(rId).emit('gameOver', { winnerId: winnerId, loserId: socket.id });
                if (rooms[rId].botInterval) clearInterval(rooms[rId].botInterval);
                delete rooms[rId];
            }
        }
    });
});

function botLogic(rId) {
    let r = rooms[rId]; if (!r) return;
    let bot = r.players['BOT'];
    let humanId = Object.keys(r.players).find(id => r.players[id].type === 'human');
    let human = r.players[humanId];
    if (bot && bot.hp > 0 && human && human.hp > 0) {
        bot.angle = Math.atan2(human.y - bot.y, human.x - bot.x);
        r.bullets.push({ x: bot.x + Math.cos(bot.angle) * 0.6, y: bot.y + Math.sin(bot.angle) * 0.6, vx: Math.cos(bot.angle) * 0.3, vy: Math.sin(bot.angle) * 0.3, bounces: 0, owner: 'BOT' });
    }
}

setInterval(() => {
    for (let rId in rooms) {
        if (rooms[rId].buffs.length < 3) {
            let r = rooms[rId];
            let bx = Math.floor(Math.random() * (r.w - 2)) + 1; let by = Math.floor(Math.random() * (r.h - 2)) + 1;
            if (r.map[by] && r.map[by][bx] === 0) r.buffs.push({ x: bx + 0.5, y: by + 0.5, type: Math.random() > 0.5 ? 'speed' : 'slow' });
        }
    }
}, 10000);

setInterval(() => {
    for (let rId in rooms) {
        let r = rooms[rId];
        let bot = r.players['BOT']; let humId = Object.keys(r.players).find(id => r.players[id].type === 'human');
        if (bot && bot.hp > 0 && humId && r.players[humId].hp > 0) {
            let h = r.players[humId];
            let dist = Math.hypot(h.x - bot.x, h.y - bot.y);
            if (dist > 4) {
                bot.x += Math.cos(bot.angle) * 0.04; bot.y += Math.sin(bot.angle) * 0.04;
                if (r.map[Math.floor(bot.y)][Math.floor(bot.x)] === 1) { bot.x -= Math.cos(bot.angle) * 0.04; bot.y -= Math.sin(bot.angle) * 0.04; }
            }
        }

        for (let i = r.bullets.length - 1; i >= 0; i--) {
            let b = r.bullets[i]; b.x += b.vx; b.y += b.vy;
            let gX = Math.floor(b.x); let gY = Math.floor(b.y);

            if (r.map[gY] && r.map[gY][gX] === 1) {
                let pX = Math.floor(b.x - b.vx); let pY = Math.floor(b.y - b.vy);
                if (r.map[gY][pX] === 0) b.vx *= -1; else if (r.map[pY] && r.map[pY][gX] === 0) b.vy *= -1; else { b.vx *= -1; b.vy *= -1; }
                b.bounces++;
            }
            if (b.bounces > 15) { r.bullets.splice(i, 1); continue; }

            for (let pid in r.players) {
                let p = r.players[pid];
                if (p.hp > 0 && Math.hypot(p.x - b.x, p.y - b.y) < 0.45) {
                    p.hp -= 1; r.bullets.splice(i, 1);
                    if (p.hp <= 0) {
                        let winnerId = b.owner === pid ? Object.keys(r.players).find(id => id !== pid) : b.owner;
                        if (winnerId === undefined) winnerId = Object.keys(r.players).find(id => id !== pid);

                        io.to(rId).emit('gameOver', { winnerId: winnerId, loserId: pid });
                        if (r.botInterval) clearInterval(r.botInterval);
                        delete rooms[rId];
                        break;
                    }
                }
            }
        }
        if (rooms[rId]) io.to(rId).emit('updateState', { players: r.players, bullets: r.bullets, buffs: r.buffs });
    }
}, 1000 / 40);

http.listen(3000, () => console.log('Server chạy Port 3000'));
