const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;

const ROLES = {
  'ضيف': { name: 'ضيف', level: 0, color: '#aaaaaa' },
  'ادمن': { name: 'ادمن', level: 1, color: '#00aaff' },
  'اونر': { name: 'اونر', level: 2, color: '#ffaa00' },
  'المؤسس': { name: 'المؤسس', level: 3, color: '#FFD700' }
};

const PASSWORDS = {
  'dark2025': 'المؤسس',
  'owner123': 'اونر',
  'admin123': 'ادمن'
};

let rooms = {
  'الغرفة العامة': {
    users: {},
    mics: Array(8).fill(null).map(() => ({
      userId: null, username: null, role: null,
      isLocked: false, isMuted: false
    }))
  }
};

let bannedIPs = new Set();

function leaveAnyMic(socket, roomName) {
  const room = rooms[roomName];
  if (!room) return;
  const slotIndex = room.mics.findIndex(s => s.userId === socket.id);
  if (slotIndex!== -1) {
    const user = room.users[socket.id];
    room.mics[slotIndex] = { userId: null, username: null, role: null, isLocked: room.mics[slotIndex].isLocked, isMuted: false };
    io.to(roomName).emit('update_mics', room.mics);
    if (user) {
      io.to(roomName).emit('sys_broadcast', { text: `🎤 نزل [${ROLES[user.role].name}] ${user.username} من المايك رقم ${slotIndex + 1}` });
      io.to(roomName).emit('mic_stream_stopped', { broadcasterId: socket.id });
    }
  }
}

io.on('connection', (socket) => {
  const userIP = socket.handshake.address;

  if (bannedIPs.has(userIP)) {
    socket.emit('login_error', '🚫 انت محظور من السيرفر');
    socket.disconnect();
    return;
  }

  socket.on('join_room', (data) => {
    const { username, password, roomName = 'الغرفة العامة' } = data;
    const cleanRoomName = roomName.trim();

    if (!rooms[cleanRoomName]) {
      rooms[cleanRoomName] = {
        users: {},
        mics: Array(8).fill(null).map(() => ({
          userId: null, username: null, role: null,
          isLocked: false, isMuted: false
        }))
      };
    }

    const room = rooms[cleanRoomName];
    // تعديل 1: نشيل المسافات ونخلي سمول عشان الباسوورد ما تعلق
    let role = PASSWORDS[password.trim().toLowerCase()] || 'ضيف';

    if (socket.currentRoom && rooms[socket.currentRoom]?.users[socket.id]) {
      leaveAnyMic(socket, socket.currentRoom);
      socket.leave(socket.currentRoom);
      // تعديل 2: نرسل حدث خروج عشان ينشال من القائمة
      socket.to(socket.currentRoom).emit('user_left', socket.id);
      delete rooms[socket.currentRoom].users[socket.id];
    }

    room.users[socket.id] = {
      username, role, socketId: socket.id,
      color: ROLES[role].color, ip: userIP, isMuted: false
    };

    socket.join(cleanRoomName);
    socket.currentRoom = cleanRoomName;

    socket.emit('room_state', {
      mics: room.mics,
      users: Object.values(room.users),
      myData: room.users[socket.id],
      roomName: cleanRoomName,
      allRooms: Object.keys(rooms)
    });

    socket.to(cleanRoomName).emit('user_joined', room.users[socket.id]);
    io.emit('update_rooms_list', Object.keys(rooms));
  });

  socket.on('create_room', (newRoomName) => {
    const user = rooms[socket.currentRoom]?.users[socket.id];
    const cleanName = newRoomName.trim();
    if (!user || ROLES[user.role].level < 2) {
      socket.emit('sys_broadcast', { text: "❌ فقط الاونر والمؤسس يقدر ينشئ غرف" });
      return;
    }
    if (rooms[cleanName]) {
      socket.emit('sys_broadcast', { text: "❌ الغرفة موجودة مسبقاً" });
      return;
    }
    rooms[cleanName] = {
      users: {},
      mics: Array(8).fill(null).map(() => ({
        userId: null, username: null, role: null,
        isLocked: false, isMuted: false
      }))
    };
    io.emit('update_rooms_list', Object.keys(rooms));
    io.emit('sys_broadcast', { text: `✅ تم انشاء غرفة [${cleanName}] بواسطة ${user.username}` });
  });

  socket.on('request_mic', (slotId) => {
    const room = rooms[socket.currentRoom];
    const user = room?.users[socket.id];
    if (!user || slotId < 0 || slotId > 7) return;
    if (user.isMuted) {
      socket.emit('sys_broadcast', { text: "🔇 انت مكتوم ما تقدر تطلع مايك" });
      return;
    }
    if (room.mics[slotId].isLocked && ROLES[user.role].level < 1) {
      socket.emit('sys_broadcast', { text: "❌ هذا المايك مقفل من قبل الإدارة" });
      return;
    }
    if (room.mics[slotId].userId!== null) {
      socket.emit('sys_broadcast', { text: "❌ هذا المايك مشغول حالياً" });
      return;
    }
    leaveAnyMic(socket, socket.currentRoom);
    room.mics[slotId].userId = socket.id;
    room.mics[slotId].username = user.username;
    room.mics[slotId].role = user.role;
    io.to(socket.currentRoom).emit('update_mics', room.mics);
    io.to(socket.currentRoom).emit('sys_broadcast', { text: `🎤 صعد [${ROLES[user.role].name}] ${user.username} على المايك رقم ${slotId + 1}` });
    socket.to(socket.currentRoom).emit('mic_stream_started', { broadcasterId: socket.id, slotId: slotId });
    room.mics.forEach((slot, index) => {
      if (slot.userId && slot.userId!== socket.id) {
        socket.emit('mic_stream_started', { broadcasterId: slot.userId, slotId: index });
      }
    });
  });

  socket.on('leave_mic', () => {
    leaveAnyMic(socket, socket.currentRoom);
  });

  socket.on('send_message', (text) => {
    const room = rooms[socket.currentRoom];
    const user = room?.users[socket.id];
    if (!user || user.isMuted) {
      if (user?.isMuted) socket.emit('sys_broadcast', { text: "🔇 انت مكتوم" });
      return;
    }
    io.to(socket.currentRoom).emit('new_message', {
      id: socket.id,
      username: user.username,
      role: user.role,
      roleName: ROLES[user.role].name,
      color: ROLES[user.role].color,
      text: text
    });
  });

  socket.on('admin_action', (data) => {
    const room = rooms[socket.currentRoom];
    const admin = room?.users[socket.id];
    const target = room?.users[data.targetId];
    if (!admin ||!target || ROLES[admin.role].level < 1) return;
    if (ROLES[admin.role].level <= ROLES[target.role].level && admin.socketId!== target.socketId) {
      socket.emit('sys_broadcast', { text: "❌ لا تملك صلاحية على هذا المستخدم" });
      return;
    }
    switch (data.action) {
      case 'kick':
        io.to(data.targetId).emit('force_disconnect', '👢 تم طردك من الغرفة');
        io.sockets.sockets.get(data.targetId)?.disconnect();
        io.to(socket.currentRoom).emit('sys_broadcast', { text: `👢 تم طرد ${target.username} بواسطة ${admin.username}` });
        break;
      case 'ban':
        bannedIPs.add(target.ip);
        io.to(data.targetId).emit('force_disconnect', '🚫 تم حظرك من السيرفر نهائياً');
        io.sockets.sockets.get(data.targetId)?.disconnect();
        io.to(socket.currentRoom).emit('sys_broadcast', { text: `🚫 تم حظر ${target.username} بواسطة ${admin.username}` });
        break;
      case 'mute':
        target.isMuted =!target.isMuted;
        io.to(socket.currentRoom).emit('sys_broadcast', { text: `🔇 ${target.isMuted? 'تم كتم' : 'تم الغاء كتم'} ${target.username} بواسطة ${admin.username}` });
        break;
      case 'set_role':
        if (ROLES[admin.role].level < 3) {
          socket.emit('sys_broadcast', { text: "❌ فقط المؤسس يقدر يعطي رتب" });
          return;
        }
        target.role = data.newRole;
        target.color = ROLES[data.newRole].color;
        io.to(socket.currentRoom).emit('user_updated', target);
        io.to(target.socketId).emit('role_changed', { newRole: data.newRole });
        io.to(socket.currentRoom).emit('sys_broadcast', { text: `⭐ تم ترقية ${target.username} الى ${ROLES[data.newRole].name} بواسطة ${admin.username}` });
        break;
    }
  });

  socket.on('admin_toggle_mic_lock', (slotId) => {
    const room = rooms[socket.currentRoom];
    const user = room?.users[socket.id];
    if (!user || ROLES[user.role].level < 1) return;
    room.mics[slotId].isLocked =!room.mics[slotId].isLocked;
    io.to(socket.currentRoom).emit('update_mics', room.mics);
    io.to(socket.currentRoom).emit('sys_broadcast', { text: `${room.mics[slotId].isLocked? '🔒' : '🔓'} المايك ${slotId + 1} ${room.mics[slotId].isLocked? 'تقفل' : 'تفتح'} بواسطة ${user.username}` });
  });

  socket.on('webrtc_offer', (data) => {
    io.to(data.to).emit('webrtc_offer', { offer: data.offer, from: socket.id });
  });
  socket.on('webrtc_answer', (data) => {
    io.to(data.to).emit('webrtc_answer', { answer: data.answer, from: socket.id });
  });
  socket.on('webrtc_ice_candidate', (data) => {
    io.to(data.to).emit('webrtc_ice_candidate', { candidate: data.candidate, from: socket.id });
  });

  socket.on('disconnect', () => {
    if (socket.currentRoom && rooms[socket.currentRoom]) {
      leaveAnyMic(socket, socket.currentRoom);
      const user = rooms[socket.currentRoom].users[socket.id];
      if (user) {
        // تعديل 3: نرسل id بس عشان الواجهة تحذفه
        socket.to(socket.currentRoom).emit('user_left', socket.id);
        delete rooms[socket.currentRoom].users[socket.id];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
