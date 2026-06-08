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

// قواعد البيانات المؤقتة في ذاكرة السيرفر للغرف، المستخدمين، والعقوبات
let users = {}; 
let rooms = { "العامة": [], "سيرفر الساحل": [], "شباب دمشق": [] };
let micSlots = { "العامة": [null, null, null], "سيرفر الساحل": [null, null, null], "شباب دمشق": [null, null, null] };
let bannedIPs = new Set();
let mutedUsers = new Set();

io.on('connection', (socket) => {
    let userIP = socket.handshake.address;
    
    // فحص الحظر التلقائي عند الدخول (حظر IP)
    if (bannedIPs.has(userIP)) {
        socket.emit('banned', 'لقد تم حظرك نهائياً من هذا السيرفر من قبل الـ ROOT.');
        socket.disconnect();
        return;
    }

    // 1. نظام تسجيل الدخول وتحديد الرتبة تلقائياً
    socket.on('join_system', (username) => {
        let rank = "عضو عادي";
        // التحقق الأمني من المالك الحقيقي للتطبيق
        if (username.trim() === "MUHAMMED") {
            rank = "VIP ROOT";
        }
        
        users[socket.id] = { username, rank, currentRoom: "العامة", ip: userIP };
        socket.join("العامة");
        rooms["العامة"].push(username);
        
        socket.emit('init_login', { username, rank, roomsList: Object.keys(rooms) });
        io.to("العامة").emit('update_users', rooms["العامة"]);
        io.to("العامة").emit('update_mics', micSlots["العامة"]);
    });

    // 2. نظام الانتقال بين الغرف المستقلة
    socket.on('switch_room', (newRoom) => {
        const user = users[socket.id];
        if (!user) return;

        // مغادرة الغرفة السابقة
        socket.leave(user.currentRoom);
        rooms[user.currentRoom] = rooms[user.currentRoom].filter(u => u !== user.username);
        io.to(user.currentRoom).emit('update_users', rooms[user.currentRoom]);

        // دخول الغرفة الجديدة
        user.currentRoom = newRoom;
        socket.join(newRoom);
        if(!rooms[newRoom]) rooms[newRoom] = [];
        rooms[newRoom].push(user.username);

        io.to(newRoom).emit('update_users', rooms[newRoom]);
        io.to(newRoom).emit('update_mics', micSlots[newRoom] || [null, null, null]);
    });

    // 3. معالجة الرسائل العامة والخاصة وحظر الكتم
    socket.on('send_message', (data) => {
        const user = users[socket.id];
        if (!user || mutedUsers.has(user.username)) {
            return socket.emit('sys_error', 'أنت مكتوم من الكتابة حالياً بطلب من الإدارة.');
        }

        if (data.isPrivate) {
            // نظام الدردشة الخاصة الحقيقي (البحث عن معرف المستلم عن طريق الاسم)
            const targetSocketId = Object.keys(users).find(id => users[id].username === data.target);
            if (targetSocketId) {
                io.to(targetSocketId).emit('receive_private', { from: user.username, msg: data.msg });
                socket.emit('receive_private', { from: `[إلى ${data.target}]`, msg: data.msg });
            }
        } else {
            // إرسال رسالة عامة للغرفة المستقلة فقط
            io.to(user.currentRoom).emit('receive_message', {
                username: user.username,
                rank: user.rank,
                msg: data.msg
            });
        }
    });

    // 4. نظام إدارة المايك الصوتي المباشر وحجزه
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

    // 5. أوامر التحكم الصارمة الخاصة بالـ VIP ROOT (MUHAMMED) فقط
    socket.on('admin_command', (data) => {
        const adminUser = users[socket.id];
        if (!adminUser || adminUser.rank !== "VIP ROOT") return; // حماية مطلقة

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
                mutedUsers.add(data.target); // احتياطاً إذا خرج
            }
            io.emit('sys_alert', `🚫 تم حظر العضو [ ${data.target} ] وآي بي جهازه نهائياً.`);
        } else if (data.action === 'create_room') {
            rooms[data.roomName] = [];
            micSlots[data.roomName] = [null, null, null];
            io.emit('update_room_list', Object.keys(rooms));
        }
    });

    // معالجة انقطاع الاتصال المفاجئ وتنظيف السيرفر
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
