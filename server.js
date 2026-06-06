const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let activeUsers = {};
let bannedIPs = new Set(); 

const ADMIN_NAME = "DARK VIP ROOT";
const OWNER_PASSWORD = "muhammed0940";

const ROLES = {
    "GUEST": { name: "زائر", level: 1, color: "#FFFFFF" },
    "MEMBER": { name: "عضو", level: 2, color: "#00FFCC" },
    "MODERATOR": { name: "مشرف", level: 3, color: "#FFCC00" },
    "ADMIN": { name: "إدمن", level: 4, color: "#FF3366" },
    "MASTER": { name: "ماستر", level: 5, color: "#9933FF" },
    "CROWN": { name: "تاج", level: 6, color: "#FFD700" },
    "OWNER": { name: "مطور/صاحب الموقع", level: 7, color: "#00FF00" }
};

let micSlots = Array(8).fill(null).map((_, index) => ({
    slotId: index,
    position: index < 4 ? "top" : "bottom", 
    userId: null,
    username: null,
    isLocked: false 
}));

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    const userIP = socket.handshake.address;

    if (bannedIPs.has(userIP)) {
        socket.emit('login_error', "🚫 أنت محظور من دخول هذا السيرفر.");
        socket.disconnect();
        return;
    }

    socket.on('register_user', (data) => {
        let selectedRole = data.role && ROLES[data.role] ? data.role : "GUEST";
        let finalUsername = data.username || "مستخدم مجهول";

        if (finalUsername === ADMIN_NAME) {
            if (data.password === OWNER_PASSWORD) {
                selectedRole = "OWNER";
            } else {
                socket.emit('login_error', "❌ اسم المستخدم هذا محجوز ومحمى بكلمة مرور!");
                return;
            }
        } else {
            if (["OWNER", "CROWN", "MASTER"].includes(selectedRole)) {
                selectedRole = "GUEST"; 
            }
        }
        
        activeUsers[socket.id] = {
            id: socket.id,
            username: finalUsername,
            role: selectedRole,
            room: "المضافة العامة",
            isMuted: false,
            ip: userIP
        };
        
        socket.join("المضافة العامة");
        socket.emit('registration_success', activeUsers[socket.id]);
        socket.emit('update_mics', micSlots);

        io.to("المضافة العامة").emit('sys_broadcast', {
            text: `📢 انضم [${ROLES[selectedRole].name}] ${activeUsers[socket.id].username} إلى الشات.`
        });
        
        updateUserList();
    });

    socket.on('send_chat_msg', (msgText) => {
        const user = activeUsers[socket.id];
        if (!user) return;
        
        if (user.isMuted) {
            socket.emit('sys_broadcast', { text: "❌ لا يمكنك إرسال رسائل، أنت مكتوم حالياً." });
            return;
        }

        if (msgText.includes(OWNER_PASSWORD)) {
            socket.emit('sys_broadcast', { text: "⚠️ تنبيه: رسالتك تحتوي على كلمات سرية محظورة ولم يتم إرسالها." });
            return; 
        }

        const roleInfo = ROLES[user.role];
        io.to(user.room).emit('receive_chat_msg', {
            id: user.id,
            username: user.username,
            text: msgText,
            color: roleInfo.color,
            roleName: roleInfo.name,
            role: user.role
        });
    });

    // ================= لوحة تحكم الإدارة السريعة للشبكة =================
    socket.on('admin_action', (data) => {
        const admin = activeUsers[socket.id];
        const target = activeUsers[data.targetId];
        if (!admin) return;

        if (data.action === 'kick' && target) {
            if (ROLES[admin.role].level > ROLES[target.role].level) {
                io.to(target.room).emit('sys_broadcast', { text: `🚨 تم طرد ${target.username} بواسطة ${admin.username}.` });
                io.sockets.sockets.get(data.targetId)?.disconnect();
            } else { socket.emit('sys_broadcast', { text: "❌ صلاحيتك أقل من الهدف." }); }
        }

        if (data.action === 'mute' && target) {
            if (ROLES[admin.role].level > ROLES[target.role].level) {
                target.isMuted = !target.isMuted;
                io.to(target.room).emit('sys_broadcast', { 
                    text: `🔒 تم ${target.isMuted ? 'كتم' : 'إلغاء كتم'} المستخدِم ${target.username} بواسطة ${admin.username}.` 
                });
            } else { socket.emit('sys_broadcast', { text: "❌ صلاحيتك أقل من الهدف." }); }
        }

        if (data.action === 'ban' && target) {
            if (ROLES[admin.role].level > ROLES[target.role].level) {
                bannedIPs.add(target.ip);
                io.to(target.room).emit('sys_broadcast', { text: `🚫 تم حظر ${target.username} نهائياً بواسطة ${admin.username}.` });
                io.sockets.sockets.get(data.targetId)?.disconnect();
            } else { socket.emit('sys_broadcast', { text: "❌ صلاحيتك أقل من الهدف." }); }
        }
    });

    // ================= نظام إدارة الـ 8 مايكات المتطور صوتياً =================
    socket.on('request_mic', (slotId) => {
        const user = activeUsers[socket.id];
        if (!user || slotId < 0 || slotId > 7) return;

        if (micSlots[slotId].isLocked) {
            socket.emit('sys_broadcast', { text: "❌ هذا المايك مقفل من قبل الإدارة." });
            return;
        }
        if (micSlots[slotId].userId !== null) {
            socket.emit('sys_broadcast', { text: "❌ هذا المايك مشغول حالياً." });
            return;
        }

        leaveAnyMic(socket.id);

        micSlots[slotId].userId = socket.id;
        micSlots[slotId].username = user.username;

        io.emit('update_mics', micSlots);
        io.emit('sys_broadcast', { text: `🎤 صعد [${ROLES[user.role].name}] ${user.username} على المايك رقم ${slotId + 1}` });
        
        // إخطار الجميع أن هناك شخصاً يطلب فتح بث صوتي الآن
        socket.broadcast.to("المضافة العامة").emit('mic_stream_started', { broadcasterId: socket.id, slotId: slotId });
    });

    socket.on('leave_mic', () => {
        leaveAnyMic(socket.id);
    });

    socket.on('admin_toggle_mic_lock', (slotId) => {
        const admin = activeUsers[socket.id];
        if (!admin || ROLES[admin.role].level < 3) { 
            socket.emit('sys_broadcast', { text: "❌ لا تملك صلاحية التحكم بالمايكات." });
            return;
        }

        micSlots[slotId].isLocked = !micSlots[slotId].isLocked;
        if (micSlots[slotId].isLocked && micSlots[slotId].userId) {
            const dischargedId = micSlots[slotId].userId;
            micSlots[slotId].userId = null;
            micSlots[slotId].username = null;
            io.to(dischargedId).emit('force_leave_mic');
        }

        io.emit('update_mics', micSlots);
    });

    // ================= وسيط نقل بث الإشارات الصوتية (WebRTC Signaling) =================
    socket.on('audio_offer', (data) => {
        io.to(data.targetId).emit('audio_offer', { sdp: data.sdp, senderId: socket.id });
    });

    socket.on('audio_answer', (data) => {
        io.to(data.targetId).emit('audio_answer', { sdp: data.sdp, senderId: socket.id });
    });

    socket.on('ice_candidate', (data) => {
        io.to(data.targetId).emit('ice_candidate', { candidate: data.candidate, senderId: socket.id });
    });

    socket.on('disconnect', () => {
        if (activeUsers[socket.id]) {
            leaveAnyMic(socket.id); 
            io.to(activeUsers[socket.id].room).emit('sys_broadcast', {
                text: `❌ غادر ${activeUsers[socket.id].username} الشات.`
            });
            delete activeUsers[socket.id];
            updateUserList();
        }
    });

    function updateUserList() {
        io.emit('update_user_list', Object.values(activeUsers));
    }

    function leaveAnyMic(userId) {
        micSlots.forEach(slot => {
            if (slot.userId === userId) {
                const uname = slot.username;
                slot.userId = null;
                slot.username = null;
                io.emit('update_mics', micSlots);
                io.emit('sys_broadcast', { text: `📉 نزل ${uname} من المايك رقم ${slot.slotId + 1}` });
                io.to("المضافة العامة").emit('mic_stream_stopped', { broadcasterId: userId });
            }
        });
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🔥 LUGANA DARK CHAT LIVE ON PORT ${PORT}!`);
});
