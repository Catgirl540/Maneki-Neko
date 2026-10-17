// Read-only decryption verification, restricted to an isolated restored database.
import { createDecipheriv } from 'node:crypto'
import { openBankDatabase, PROFILES_KEY } from './database.mjs'

let bank
try {
  const url=new URL(process.env.BANK_DATABASE_URL)
  if (process.env.BANK_MAINTENANCE!=='1' || !/^bank_restore_[a-z0-9_]+$/.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error('Isolated restoration database required')
  bank=await openBankDatabase(process.env.BANK_DATABASE_URL,{autoMigrate:false})
  const name=(await bank.db.query('SELECT current_database() AS name')).rows[0].name
  if (!/^bank_restore_[a-z0-9_]+$/.test(name)) throw new Error('Wrong database')
  const profiles=JSON.parse(bank.storage.getItem(PROFILES_KEY)??'{}')
  const hasAi=(await bank.db.query("SELECT to_regclass('ai_sessions.sessions') IS NOT NULL AS present")).rows[0].present
  let aiSessions=0,aiEvents=0
  if(hasAi) {
    const encoded=process.env.LUCKYCAT_SESSION_DATA_KEY,key=Buffer.from(encoded??'','base64')
    if(key.length!==32 || key.toString('base64')!==encoded)throw new Error('Matching AI key required')
    const open=(value,context)=>{
      if(!value.startsWith('aesgcm:v1:'))throw new Error('Invalid encrypted session')
      const bytes=Buffer.from(value.slice(10),'base64url'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12))
      decipher.setAAD(Buffer.from(context));decipher.setAuthTag(bytes.subarray(12,28))
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'))
    }
    await bank.db.transaction(async()=>{
      const sessions=(await bank.db.query('SELECT namespace,id,legacy_context_cipher FROM ai_sessions.sessions')).rows
      for(const row of sessions)if(row.legacy_context_cipher)open(row.legacy_context_cipher,`ai-session:${row.namespace}:${row.id}:legacy`)
      const events=(await bank.db.query('SELECT namespace,session_id,seq,event_type,body_cipher FROM ai_sessions.events ORDER BY namespace,session_id,seq')).rows
      for(const row of events){const event=open(row.body_cipher,`ai-session:${row.namespace}:${row.session_id}:event:${row.seq}`);if(event.type!==row.event_type || event.type==='card-secret')throw new Error('Invalid restored event')}
      aiSessions=sessions.length;aiEvents=events.length
    },{isolationLevel:'REPEATABLE READ',readOnly:true})
  }
  console.log(JSON.stringify({ok:true,database:name,customerProfilesDecrypted:Object.keys(profiles).length,aiSessionsVerified:aiSessions,aiEventsDecrypted:aiEvents,readOnly:true}))
} catch {
  console.error('{"ok":false,"code":"RESTORED_DATA_VERIFICATION_FAILED"}')
  process.exitCode=1
} finally {if(bank)await bank.close()}
