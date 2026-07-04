const fs = require("fs");
const path = require("path");
const multer = require("multer");

module.exports = function(app, pool, authenticateToken) {
  const uploadDir = path.join(__dirname, "uploads", "chat-media");
  fs.mkdirSync(uploadDir, { recursive: true });

  app.use("/uploads/chat-media", require("express").static(uploadDir));

  const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname || "") || ".webm";
      cb(null, "media-" + Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
    }
  });

  const upload = multer({ storage });

  app.post("/api/communication/upload-voice", authenticateToken, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Fichier manquant" });
    res.json({
      url: `/uploads/chat-media/${req.file.filename}`,
      mime: req.file.mimetype
    });
  });

  app.post("/api/communication/conversations/:id/voice", authenticateToken, async (req, res) => {
    const { media_url, media_mime, duration } = req.body;
    const r = await pool.query(`
      INSERT INTO chat_messages_v2
      (conversation_id, sender_id, message, message_type, media_url, media_mime, media_duration)
      VALUES($1,$2,$3,'voice',$4,$5,$6)
      RETURNING *
    `, [req.params.id, req.user.id, "Message vocal", media_url, media_mime || "audio/webm", duration || 0]);
    res.json(r.rows[0]);
  });

  app.post("/api/communication/call-signal", authenticateToken, async (req, res) => {
    const { conversation_id, receiver_id, signal_type, payload } = req.body;

    const r = await pool.query(`
      INSERT INTO communication_call_signals
      (conversation_id, sender_id, receiver_id, signal_type, payload)
      VALUES($1,$2,$3,$4,$5)
      RETURNING *
    `, [conversation_id || null, req.user.id, receiver_id || null, signal_type, payload || {}]);

    res.json(r.rows[0]);
  });

  app.get("/api/communication/call-signals", authenticateToken, async (req, res) => {
    const since = Number(req.query.since || 0);

    const r = await pool.query(`
      SELECT *
      FROM communication_call_signals
      WHERE id > $1
        AND (receiver_id=$2 OR receiver_id IS NULL)
      ORDER BY id ASC
      LIMIT 100
    `, [since, req.user.id]);

    res.json(r.rows);
  });
};
