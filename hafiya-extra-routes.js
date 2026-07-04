module.exports = function(app, pool, authenticateToken) {
  app.get("/api/notifications", authenticateToken, async (req, res) => {
    const r = await pool.query(
      "SELECT * FROM app_notifications ORDER BY created_at DESC LIMIT 50"
    );
    res.json(r.rows);
  });

  app.post("/api/notifications/:id/read", authenticateToken, async (req, res) => {
    await pool.query("UPDATE app_notifications SET is_read=true WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  });

  app.post("/api/appointments/:id/confirm", authenticateToken, async (req, res) => {
    const id = req.params.id;

    await pool.query(`
      UPDATE appointments
      SET status='confirmé'
      WHERE id=$1
    `, [id]).catch(() => null);

    const appt = await pool.query("SELECT * FROM appointments WHERE id=$1", [id]).catch(() => ({ rows: [] }));
    const a = appt.rows[0] || {};

    const phone = a.phone || a.telephone || a.patient_phone || "";
    const patient = a.patient_name || a.fullname || "Patient";
    const date = a.requested_date || a.date_demande || a.date || "";
    const hour = a.requested_time || a.heure_demande || a.hour || "";

    await pool.query(`
      INSERT INTO sms_outbox(phone, message)
      VALUES($1, $2)
    `, [
      phone,
      `Bonjour ${patient}. Votre rendez-vous chez HAFIYA Laboratoire est confirmé pour le ${date} à ${hour}. Merci.`
    ]);

    await pool.query(`
      INSERT INTO app_notifications(title, message, type)
      VALUES('Rendez-vous confirmé', $1, 'appointment')
    `, [`Le rendez-vous de ${patient} a été confirmé.`]);

    res.json({ success: true });
  });

  app.post("/api/feedback", async (req, res) => {
    const { appointment_id, patient_name, phone, rating, comment } = req.body;

    await pool.query(`
      INSERT INTO appointment_feedback(appointment_id, patient_name, phone, rating, comment)
      VALUES($1,$2,$3,$4,$5)
    `, [appointment_id || null, patient_name || "", phone || "", rating || null, comment || ""]);

    res.json({ success: true, message: "Merci pour votre avis." });
  });

  app.get("/api/feedback", authenticateToken, async (req, res) => {
    const r = await pool.query("SELECT * FROM appointment_feedback ORDER BY created_at DESC");
    res.json(r.rows);
  });

  app.get("/api/chat/messages/:userId", authenticateToken, async (req, res) => {
    const me = req.user.id;
    const other = req.params.userId;

    const r = await pool.query(`
      SELECT *
      FROM chat_messages
      WHERE (sender_id=$1 AND receiver_id=$2)
         OR (sender_id=$2 AND receiver_id=$1)
      ORDER BY created_at ASC
    `, [me, other]);

    res.json(r.rows);
  });

  app.post("/api/chat/messages", authenticateToken, async (req, res) => {
    const sender = req.user.id;
    const { receiver_id, message } = req.body;

    const r = await pool.query(`
      INSERT INTO chat_messages(sender_id, receiver_id, message)
      VALUES($1,$2,$3)
      RETURNING *
    `, [sender, receiver_id, message]);

    res.json(r.rows[0]);
  });
};
