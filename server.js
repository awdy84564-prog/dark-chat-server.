socket.on('request_mic', (slotId) => {
  const user = activeUsers[socket.id];
  if (!user || slotId < 0 || slotId > 7) return;

  if (micSlots[slotId].isLocked) {
    socket.emit('sys_broadcast', { text: "❌ هذا المايك مقفل من قبل الإدارة." });
    return;
  }

  if (micSlots[slotId].userId!== null) {
    socket.emit('sys_broadcast', { text: "❌ هذا المايك مشغول حالياً." });
    return;
  }

  leaveAnyMic(socket.id);
  micSlots[slotId].userId = socket.id;
  micSlots[slotId].username = user.username;

  io.emit('update_mics', micSlots);
  io.emit('sys_broadcast', { text: `🎤 صعد [${ROLES[user.role].name}] ${user.username} على المايك رقم ${slotId + 1}` });

  // 1. اخبر الكل ان في شخص جديد طلع مايك
  socket.broadcast.to("المضافة العامة").emit('mic_stream_started', {
    broadcasterId: socket.id,
    slotId: slotId
  });

  // 2. هذا هو السطر الناقص: اخبر الشخص الجديد عن كل الناس اللي على المايك حالياً
  micSlots.forEach(slot => {
    if (slot.userId && slot.userId!== socket.id) {
      socket.emit('mic_stream_started', {
        broadcasterId: slot.userId,
        slotId: slot.slotId
      });
    }
  });
});
