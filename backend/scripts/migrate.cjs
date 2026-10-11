// Repeatable migration runner: applies database/NN_*.sql in order, once each, each in a transaction.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Client}=require('pg');
(async()=>{
  const dir=process.env.MIGRATIONS_DIR||path.join(__dirname,'..','..','database');
  const files=fs.readdirSync(dir).filter(f=>/^\d\d_.*\.sql$/.test(f)).sort();
  const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
  await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum TEXT, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  for(const f of files){
    const sql=fs.readFileSync(path.join(dir,f),'utf8'),sum=crypto.createHash('sha256').update(sql).digest('hex');
    const r=await c.query('SELECT checksum FROM schema_migrations WHERE id=$1',[f]);
    if(r.rows.length){console.log('skip',f,r.rows[0].checksum===sum?'':'(CHANGED since applied!)');continue;}
    const own=/^\s*BEGIN\s*;/mi.test(sql); // files that manage their own transaction are not wrapped again
    try{if(!own)await c.query('BEGIN');await c.query(sql);if(own)await c.query('BEGIN');
      await c.query('INSERT INTO schema_migrations(id,checksum) VALUES($1,$2) ON CONFLICT (id) DO NOTHING',[f,sum]);
      await c.query('COMMIT');console.log('applied',f);}
    catch(e){try{await c.query('ROLLBACK');}catch{}console.error('FAILED',f,e.message);process.exit(1);}
  }
  await c.end();
})();
