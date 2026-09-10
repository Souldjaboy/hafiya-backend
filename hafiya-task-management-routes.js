"use strict";

function roleOf(user) {
  return String(user?.role || "").trim().toLowerCase();
}
function isDirection(user) {
  return user?.is_super_admin === true || ["super_admin","admin","admin_entreprise","direction","directeur"].includes(roleOf(user));
}
function guard(req,res) {
  const tenant = String(req?.tenant_id || req?.user?.tenant_id || "").toLowerCase();
  if (tenant !== "hafiya" || !isDirection(req.user)) {
    res.status(403).json({ error:"Accès Direction HAFIYA requis." });
    return false;
  }
  return true;
}
function isoDate(v) {
  const s=String(v||"").slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:"";
}

module.exports = function registerHafiyaTaskManagement(app,pool,authenticateToken) {
  app.get("/hafiya/tasks", authenticateToken, async (req,res)=>{
    try {
      if (!guard(req,res)) return;
      const cid=Number(req.user.company_id||0);
      const from=isoDate(req.query.from)||new Date().toISOString().slice(0,10);
      const to=isoDate(req.query.to)||from;
      const r=await pool.query(
        `SELECT t.*,u.fullname,u.role
         FROM hafiya_staff_tasks t
         JOIN users u ON u.id=t.assigned_to
         WHERE t.company_id=$1 AND t.due_date BETWEEN $2 AND $3
         ORDER BY t.due_date ASC, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'haute' THEN 1 ELSE 2 END, u.fullname`,
        [cid,from,to]
      );
      res.json(r.rows);
    } catch(e) {
      console.error("HAFIYA TASKS LIST:",e);
      res.status(500).json({error:"Erreur lecture planning."});
    }
  });

  app.put("/hafiya/tasks/:id", authenticateToken, async (req,res)=>{
    try {
      if (!guard(req,res)) return;
      const cid=Number(req.user.company_id||0);
      const assignedTo=Number(req.body?.assigned_to||0);
      const title=String(req.body?.title||"").trim();
      const dueDate=isoDate(req.body?.due_date);
      if(!assignedTo||!title||!dueDate) return res.status(400).json({error:"Employé, tâche et date obligatoires."});
      const r=await pool.query(
        `UPDATE hafiya_staff_tasks SET assigned_to=$1,title=$2,description=$3,priority=$4,due_date=$5,updated_at=CURRENT_TIMESTAMP
         WHERE id=$6 AND company_id=$7 RETURNING *`,
        [assignedTo,title,String(req.body?.description||""),String(req.body?.priority||"normale"),dueDate,req.params.id,cid]
      );
      if(!r.rows[0]) return res.status(404).json({error:"Tâche introuvable."});
      res.json(r.rows[0]);
    } catch(e) {
      console.error("HAFIYA TASK UPDATE:",e);
      res.status(500).json({error:"Erreur modification tâche."});
    }
  });

  app.delete("/hafiya/tasks/:id", authenticateToken, async (req,res)=>{
    try {
      if (!guard(req,res)) return;
      const cid=Number(req.user.company_id||0);
      const r=await pool.query("DELETE FROM hafiya_staff_tasks WHERE id=$1 AND company_id=$2 RETURNING id",[req.params.id,cid]);
      if(!r.rows[0]) return res.status(404).json({error:"Tâche introuvable."});
      res.json({success:true,id:r.rows[0].id});
    } catch(e) {
      console.error("HAFIYA TASK DELETE:",e);
      res.status(500).json({error:"Erreur suppression tâche."});
    }
  });
};
