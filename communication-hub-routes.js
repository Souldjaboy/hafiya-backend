module.exports = function(app, pool, authenticateToken) {
  app.get("/communication/conversations", authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const r = await pool.query(`
      SELECT c.*
      FROM chat_conversations c
      JOIN chat_conversation_members m ON m.conversation_id=c.id
      WHERE m.user_id=$1
      ORDER BY c.created_at DESC
    `, [userId]);
    res.json(r.rows);
  });

  app.post("/communication/conversations", authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { type, name, members } = req.body;

    const c = await pool.query(`
      INSERT INTO chat_conversations(type, name, created_by)
      VALUES($1,$2,$3)
      RETURNING *
    `, [type || "private", name || "Nouvelle conversation", userId]);

    const conversationId = c.rows[0].id;
    const allMembers = Array.from(new Set([userId, ...(members || [])]));

    for (const m of allMembers) {
      await pool.query(
        "INSERT INTO chat_conversation_members(conversation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [conversationId, m]
      );
    }

    res.json(c.rows[0]);
  });

  app.get("/communication/conversations/:id/messages", authenticateToken, async (req, res) => {
    const r = await pool.query(`
      SELECT m.*, u.fullname AS sender_name, u.role AS sender_role
      FROM chat_messages_v2 m
      LEFT JOIN users u ON u.id=m.sender_id
      WHERE m.conversation_id=$1
      ORDER BY m.created_at ASC
    `, [req.params.id]);
    res.json(r.rows);
  });

  app.post("/communication/conversations/:id/messages", authenticateToken, async (req, res) => {
    const r = await pool.query(`
      INSERT INTO chat_messages_v2(conversation_id, sender_id, message)
      VALUES($1,$2,$3)
      RETURNING *
    `, [req.params.id, req.user.id, req.body.message || ""]);
    res.json(r.rows[0]);
  });
};
