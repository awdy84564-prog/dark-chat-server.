const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");

const io = new Server(server, { 
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  } 
});

app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;

const ROLES = {
  'GUEST': { name: 'زائر', level: 0, color: '#ffffff' },
  'MEMBER': { name: 'عضو', level: 1, color: '#00ffcc' },
  'MODERATOR': { name: 'مشرف الغرفة', level: 2, color: '#ffcc00' },
  'ADMIN': { name: 'إدمن التطبيق', level: 3, color: '#ff3366' },
  'MASTER': { name: 'ماستر', level: 4, color: '#9933ff' },
  'CROWN': { name: 'تاج', level: 5, color: '#ffd700' },
  'OWNER': { name: 'صاحب الموقع', level: 6, color: '#00ff00' }
};

const PASSWORDS = {
  'muhammed0940': 'OWNER',
  'crown2026': 'CROWN',
  'master2026': 'MASTER',
  'admin123': 'ADMIN',
  'mod123': 'MODERATOR',
  'member123': 'MEMBER'
};

let rooms = {
  'الغرفة العامة': {
    users: {},
    mics: Array(8).fill(null).map((_, index) => ({
      userId: null, username: null, role: null, position: index < 4 ? "top" : "bottom",
      isLocked: false, isMuted: false
    }))
  }
};

let bannedIPs = new Set();
let messageLogs = {};

function leaveAnyMic(socket, roomName) {
  const room = rooms[roomName];
  if (!room) return;
  const slotIndex = room.mics.findIndex(s => s.userId === socket.id);
  if (slotIndex !== -1) {
    const user = room.users[socket.id];
    room.mics[slotIndex] = { 
      userId: null, username: null, role: null, position: slotIndex < 4 ? "top" : "bottom", 
      isLocked: room.mics[slotIndex].isLocked, isMuted: false 
    };
    io.to(roomName).emit('update_mics', room.mics);
    if (user) {
      io.to(roomName).emit('sys_broadcast', { text: `📉 نزل [${ROLES[user.role].name}] ${user.username} من المايك رقم ${slotIndex + 1}` });
      io.to(roomName).emit('user_left_mic_stream', { userId: socket.id });
    }
  }
}
io.on('connection', (socket) => {
    const clientIP = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    if (bannedIPs.has(clientIP)) {
        socket.emit('banned', { reason: "🚫 تم حظر جهازك أو شبكتك نهائياً." });
        socket.disconnect(true);
        return;
    }

    let currentRoom = 'الغرفة العامة';

    socket.on('register_user', (data) => {
        let assignedRole = 'GUEST';
        if (data.password && PASSWORDS[data.password]) {
            assignedRole = PASSWORDS[data.password];
        } else if (data.password && !PASSWORDS[data.password]) {
            socket.emit('auth_error', { text: "⚠️ كلمة مرور الرتبة غير صحيحة!" });
        }

        const userObj = { id: socket.id, username: data.username || `زائر`, role: assignedRole, ip: clientIP };
        rooms[currentRoom].users[socket.id] = userObj;
        socket.join(currentRoom);

        socket.emit('registration_success', {
            username: userObj.username, role: userObj.role, roleName: ROLES[userObj.role].name, color: ROLES[userObj.role].color, room: currentRoom
        });

        socket.emit('update_mics', rooms[currentRoom].mics);
        
        io.to(currentRoom).emit('update_users_list', Object.values(rooms[currentRoom].users).map(u => ({
            username: u.username, role: u.role, roleName: ROLES[u.role].name, color: ROLES[u.role].color
        })));

        io.to(currentRoom).emit('sys_broadcast', { text: `📢 انضم [${ROLES[userObj.role].name}] ${userObj.username} إلى الدردشة الآن.` });
    });

    socket.on('send_chat_msg', (text) => {
        const room = rooms[currentRoom];
        if (!room) return;
        const user = room.users[socket.id];
        if (!user) return;

        io.to(currentRoom).emit('receive_chat_msg', {
            username: user.username, text: text, role: user.role, roleName: ROLES[user.role].name, color: ROLES[user.role].color
        });
    });

    socket.on('request_mic_slot', (slotIndex) => {
        const room = rooms[currentRoom];
        if (!room || slotIndex < 0 || slotIndex >= 8) return;
        const user = room.users[socket.id];
        if (!user) return;

        if (room.mics[slotIndex].userId !== null) return;

        leaveAnyMic(socket, currentRoom); 
        
        room.mics[slotIndex] = {
            userId: socket.id, username: user.username, role: user.role, position: slotIndex < 4 ? "top" : "bottom", isLocked: false, isMuted: false
        };

        io.to(currentRoom).emit('update_mics', room.mics);
        io.to(currentRoom).emit('sys_broadcast', { text: `🎤 اعتلى [${ROLES[user.role].name}] ${user.username} المايك رقم ${slotIndex + 1}` });
        
        socket.to(currentRoom).emit('user_joined_mic_stream', { userId: socket.id });
    });

    socket.on('sending_signal', data => {
        io.to(data.userToSignal).emit('user_joined_stream_signal', { signal: data.signal, callerId: data.callerId });
    });

    socket.on('returning_signal', data => {
        io.to(data.callerId).emit('received_returned_signal', { signal: data.signal, id: socket.id });
    });

    socket.on('leave_mic', () => { leaveAnyMic(socket, currentRoom); });

    socket.on('admin_action', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;
        
        const adminUser = room.users[socket.id];
        const targetUser = Object.values(room.users).find(u => u.username === data.targetUsername);

        if (!adminUser || !targetUser) return;

        if (ROLES[adminUser.role].level > ROLES[targetUser.role].level) {
            if (data.action === 'kick') {
                io.to(targetUser.id).emit('kicked_from_app', { reason: "تم طردك من الغرفة بواسطة الإدارة." });
                const targetSocket = io.sockets.sockets.get(targetUser.id);
                if (targetSocket) {
                    leaveAnyMic(targetSocket, currentRoom);
                    targetSocket.leave(currentRoom);
                }
                delete room.users[targetUser.id];
                io.to(currentRoom).emit('sys_broadcast', { text: `🚫 قام المشرف بطرد ${targetUser.username} خارج الدردشة.` });
            } 
            else if (data.action === 'ban') {
                bannedIPs.add(targetUser.ip); 
                io.to(targetUser.id).emit('banned', { reason: "تم حظر جهازك نهائياً من قبل صاحب الموقع." });
                const targetSocket = io.sockets.sockets.get(targetUser.id);
                if (targetSocket) targetSocket.disconnect(true);
                io.to(currentRoom).emit('sys_broadcast', { text: `⛔ تم حظر جهاز الحساب ${targetUser.username} نهائياً بالـ IP.` });
            }
            
            io.to(currentRoom).emit('update_users_list', Object.values(room.users).map(u => ({
                username: u.username, role: u.role, roleName: ROLES[u.role].name, color: ROLES[u.role].color
            })));
        } else {
            socket.emit('sys_broadcast', { text: "❌ خطأ حماية: لا تملك الصلاحية الكافية للتحكم بهذا المستخدم!" });
        }
    });

    socket.on('disconnect', () => {
        const room = rooms[currentRoom];
        if (room && room.users[socket.id]) {
            leaveAnyMic(socket, currentRoom);
            delete room.users[socket.id];
            io.to(currentRoom).emit('update_users_list', Object.values(room.users).map(u => ({
                username: u.username, role: u.role, roleName: ROLES[u.role].name, color: ROLES[u.role].color
            })));
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 SERVER RUNNING ON PORT: ${PORT}`);
});
