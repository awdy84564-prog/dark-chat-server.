const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

let users = {}; 
let rooms = { "العامة": [], "سيرفر الساحل": [], "شباب دمشق": [] };
let micSlots = { "العامة": [null, null, null], "سيرفر الساحل": [null, null, null], "شباب دمشق": [null, null, null] };
let bannedIPs = new Set();
let mutedUsers = new Set();

io.on('connection', (socket) => {
    let userIP = socket.handshake.address;
    
    if (bannedIPs.has(userIP)) {
        socket.emit('banned', 'لقد تم حظرك نهائياً من هذا السيرفر من قبل الـ ROOT.');
        socket.disconnect();
        return;
    }

    // نظام تسجيل الدخول الحقيقي مع التحقق من كلمة المرور للـ ROOT
    socket.on('join_system', (data) => {
        let username = data.username.trim();
        let password = data.password ? data.password.trim() : "";
        let rank = "عضو عادي";

        // التحقق الأمني الصارم من هوية صاحب الموقع التلقائية
        if (username === "MUHAMMED") {
            if (password !== "muhammed0940539") {
                // إذا حاول شخص الدخول باسمك وبكلمة مرور خاطئة يتم رفضه فوراً
                socket.emit('login_failed', 'خطأ أمني: كلمة المرور الخاصة بالـ VIP ROOT غير صحيحة!');
                return;
            }
            rank = "VIP ROOT"; // منحك أعلى رتبة في النظام بعد نجاح التحقق
        } else {
            // منع الأعضاء العاديين من استخدام اسمك المحمي
            if (username.toUpperCase() === "MUHAMMED") {
                socket.emit('login_failed', 'هذا الاسم محمي ومخصص لصاحب الموقع فقط!');
                return;
            }
        }
        
        users[socket.id] = { username, rank, currentRoom: "العامة", ip: userIP };
        socket.join("العامة");
        rooms["العامة"].push(username);
        
        socket.emit('init_login', { username, rank, roomsList: Object.keys(rooms) });
        io.to("العامة").emit('update_users', rooms["العامة"]);
        io.to("العامة").emit('update_mics', micSlots["العامة"]);
    });

    socket.on('switch_room', (newRoom) => {
        const user = users[socket.id];
        if (!user) return;

        socket.leave(user.currentRoom);
        rooms[user.currentRoom] = rooms[user.currentRoom].filter(u => u !== user.username);
        io.to(user.currentRoom).emit('update_users', rooms[user.currentRoom]);

        user.currentRoom = newRoom;
        socket.join(newRoom);
        if(!rooms[newRoom]) rooms[newRoom] = [];
        rooms[newRoom].push(user.username);

        io.to(newRoom).emit('update_users', rooms[newRoom]);
        io.to(newRoom).emit('update_mics', micSlots[newRoom] || [null, null, null]);
    });

    socket.on('send_message', (data) => {
        const user = users[socket.id];
        if (!user || mutedUsers.has(user.username)) {
            return socket.emit('sys_error', 'أنت مكتوم من الكتابة حالياً بطلب من الإدارة.');
        }

        if (data.isPrivate) {
            const targetSocketId = Object.keys(users).find(id => users[id].username === data.target);
            if (targetSocketId) {
                io.to(targetSocketId).emit('receive_private', { from: user.username, msg: data.msg });
                socket.emit('receive_private', { from: `[إلى ${data.target}]`, msg: data.msg });
            }
        } else {
            io.to(user.currentRoom).emit('receive_message', {
                username: user.username,
                rank: user.rank,
                msg: data.msg
            });
        }
    });

    socket.on('request_mic', (slotIndex) => {
        const user = users[socket.id];
        if (!user || mutedUsers.has(user.username)) return;

        let currentMics = micSlots[user.currentRoom];
        if (currentMics && !currentMics[slotIndex]) {
            currentMics[slotIndex] = user.username;
            io.to(user.currentRoom).emit('update_mics', currentMics);
        }
    });

    socket.on('leave_mic', () => {
        const user = users[socket.id];
        if (!user) return;
        let currentMics = micSlots[user.currentRoom];
        if (currentMics) {
            for(let i=0; i<3; i++) {
                if(currentMics[i] === user.username) currentMics[i] = null;
            }
            io.to(user.currentRoom).emit('update_mics', currentMics);
        }
    });

    socket.on('admin_command', (data) => {
        const adminUser = users[socket.id];
        if (!adminUser || adminUser.rank !== "VIP ROOT") return; 

        const targetSocketId = Object.keys(users).find(id => users[id].username === data.target);

        if (data.action === 'mute') {
            mutedUsers.add(data.target);
            io.emit('sys_alert', `🔒 قام الـ ROOT بكتم العضو [ ${data.target} ]`);
        } else if (data.action === 'unmute') {
            mutedUsers.delete(data.target);
            io.emit('sys_alert', `🔓 قام الـ ROOT بفك الكتم عن [ ${data.target} ]`);
        } else if (data.action === 'kick' && targetSocketId) {
            io.to(targetSocketId).emit('kicked_out', 'لقد تم طردك من الغرفة الحالية.');
            io.sockets.sockets.get(targetSocketId).leave(users[targetSocketId].currentRoom);
        } else if (data.action === 'ban') {
            if (targetSocketId) {
                let targetIP = users[targetSocketId].ip;
                bannedIPs.add(targetIP);
                io.to(targetSocketId).emit('banned', 'تم حظرك نهائياً.');
                io.sockets.sockets.get(targetSocketId).disconnect();
            } else {
                mutedUsers.add(data.target); 
            }
            io.emit('sys_alert', `🚫 تم حظر العضو [ ${data.target} ] وآي بي جهازه نهائياً.`);
        } else if (data.action === 'create_room') {
            rooms[data.roomName] = [];
            micSlots[data.roomName] = [null, null, null];
            io.emit('update_room_list', Object.keys(rooms));
        }
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            rooms[user.currentRoom] = rooms[user.currentRoom].filter(u => u !== user.username);
            io.to(user.currentRoom).emit('update_users', rooms[user.currentRoom]);
            let currentMics = micSlots[user.currentRoom];
            if (currentMics) {
                for(let i=0; i<3; i++) { if(currentMics[i] === user.username) currentMics[i] = null; }
                io.to(user.currentRoom).emit('update_mics', currentMics);
            }
            delete users[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DARK CHAT ROOT يعمل الآن على المنفذ ${PORT}`));
