import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { AgentMemoryCandidate, AgentProactiveOpportunity, AgentProactiveSettings, AgentProactiveSettingsPatch, ProactiveCandidateStatus, ProactiveCategory, ProactiveFeedbackAction } from "../../shared/types.js";

const DEFAULT_SETTINGS:AgentProactiveSettings={
 enabled:true,quietMode:false,maxPerDay:5,cooldownHours:24,
 categories:{preference_confirmation:true,follow_up_confirmation:true,follow_up_due:true,repeated_tool_failure:true,blocker:true},
};
const keyOf=(scope:string|null)=>createHash("sha256").update(scope||"__personal_workspace__").digest("hex").slice(0,32);
const keysOf=(scope:string|null)=>scope===null?[keyOf(null)]:[keyOf(scope),keyOf(null)];
const parse=<T>(value:unknown,fallback:T):T=>{try{return JSON.parse(String(value??"")) as T;}catch{return fallback;}};
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(n)?n:min));

export interface CandidateInput{scope:string|null;taskId:string|null;sessionId:string|null;category:string;strength:"explicit"|"strong_signal"|"repeated_correction";statement:string;sourceRef:string|null;expiresAt:number;}
export interface OpportunityInput{scope:string|null;taskId:string|null;category:ProactiveCategory;title:string;explanation:string;suggestedAction:string;sourceRefs:string[];confidence:number;impact:number;urgency:number;dedupeKey:string;eventId:string;status?:AgentProactiveOpportunity["status"];expiresAt?:number|null;dueAt?:number|null;payload?:Record<string,unknown>;}
export interface ProactiveEventRecord{eventId:string;scope:string|null;taskId:string|null;eventType:string;occurredAt:number;sourceRef:string|null;payload:Record<string,unknown>;}

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_RETENTION_MS = 30 * DAY_MS;
const FEEDBACK_RETENTION_MS = 365 * DAY_MS;
const TERMINAL_RETENTION_MS = 365 * DAY_MS;
const CANDIDATE_RETENTION_MS = 180 * DAY_MS;
const MAX_PROACTIVE_EVENTS = 20_000;

export class ProactiveStore{
 private readonly db:DatabaseSync;
 private eventWrites=0;
 constructor(databasePath:string){
  if(databasePath!==":memory:"){mkdirSync(path.dirname(databasePath),{recursive:true,mode:0o700});try{chmodSync(path.dirname(databasePath),0o700);}catch{}}
  this.db=new DatabaseSync(databasePath);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  this.db.exec(`
   CREATE TABLE IF NOT EXISTS proactive_events(event_id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,scope_value TEXT,task_id TEXT,event_type TEXT NOT NULL,occurred_at INTEGER NOT NULL,source_ref TEXT,payload_json TEXT NOT NULL,processed_at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_proactive_events_recent ON proactive_events(scope_key,task_id,event_type,occurred_at DESC);
   CREATE INDEX IF NOT EXISTS idx_proactive_events_occurred ON proactive_events(occurred_at DESC);
   CREATE TABLE IF NOT EXISTS memory_candidates(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,scope_value TEXT,task_id TEXT,session_id TEXT,category TEXT NOT NULL,strength TEXT NOT NULL,statement TEXT NOT NULL,fingerprint TEXT NOT NULL,source_ref TEXT,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,accepted_note_id TEXT,UNIQUE(scope_key,fingerprint));
   CREATE INDEX IF NOT EXISTS idx_memory_candidates_status ON memory_candidates(scope_key,status,created_at DESC);
   CREATE TABLE IF NOT EXISTS proactive_opportunities(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,scope_value TEXT,task_id TEXT,category TEXT NOT NULL,title TEXT NOT NULL,explanation TEXT NOT NULL,suggested_action TEXT NOT NULL,source_refs_json TEXT NOT NULL,confidence REAL NOT NULL,impact REAL NOT NULL,urgency REAL NOT NULL,rank_score REAL NOT NULL,status TEXT NOT NULL,dedupe_key TEXT NOT NULL,event_id TEXT NOT NULL,payload_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER,due_at INTEGER,snoozed_until INTEGER,last_presented_at INTEGER);
   CREATE INDEX IF NOT EXISTS idx_proactive_opportunities_scope ON proactive_opportunities(scope_key,status,rank_score DESC,created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_proactive_opportunities_dedupe ON proactive_opportunities(scope_key,dedupe_key,status);
   CREATE TABLE IF NOT EXISTS proactive_feedback(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,category TEXT NOT NULL,dedupe_key TEXT NOT NULL,action TEXT NOT NULL,created_at INTEGER NOT NULL,suppress_until INTEGER);
   CREATE INDEX IF NOT EXISTS idx_proactive_feedback_scope ON proactive_feedback(scope_key,dedupe_key,suppress_until DESC);
   CREATE TABLE IF NOT EXISTS proactive_settings(id TEXT PRIMARY KEY,settings_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
  `);
  if(databasePath!==":memory:")try{chmodSync(databasePath,0o600);}catch{}
  this.pruneHistory();
 }
 private pruneHistory(now=Date.now()):void{
  this.db.prepare("DELETE FROM proactive_events WHERE occurred_at<?").run({},now-EVENT_RETENTION_MS);
  this.db.prepare("DELETE FROM proactive_events WHERE event_id IN (SELECT event_id FROM proactive_events ORDER BY occurred_at DESC LIMIT -1 OFFSET ?)").run({},MAX_PROACTIVE_EVENTS);
  this.db.prepare("DELETE FROM proactive_feedback WHERE created_at<? AND (suppress_until IS NULL OR suppress_until<=?)").run({},now-FEEDBACK_RETENTION_MS,now);
  this.db.prepare("DELETE FROM proactive_opportunities WHERE status IN ('dismissed','acted','expired','accepted') AND updated_at<?").run({},now-TERMINAL_RETENTION_MS);
  this.db.prepare("DELETE FROM memory_candidates WHERE status IN ('rejected','expired') AND updated_at<?").run({},now-CANDIDATE_RETENTION_MS);
 }
 getSettings():AgentProactiveSettings{
  const row=this.db.prepare("SELECT settings_json FROM proactive_settings WHERE id='global'").get({}) as {settings_json?:unknown}|undefined;
  const saved=parse<Partial<AgentProactiveSettings>>(row?.settings_json,{});
  return{enabled:saved.enabled!==false,quietMode:saved.quietMode===true,maxPerDay:clamp(Math.floor(Number(saved.maxPerDay??5)),1,20),cooldownHours:clamp(Math.floor(Number(saved.cooldownHours??24)),1,720),categories:{...DEFAULT_SETTINGS.categories,...(saved.categories??{})}};
 }
 saveSettings(input:AgentProactiveSettingsPatch):AgentProactiveSettings{
  const old=this.getSettings();
  const next:AgentProactiveSettings={enabled:typeof input.enabled==="boolean"?input.enabled:old.enabled,quietMode:typeof input.quietMode==="boolean"?input.quietMode:old.quietMode,maxPerDay:clamp(Math.floor(Number(input.maxPerDay??old.maxPerDay)),1,20),cooldownHours:clamp(Math.floor(Number(input.cooldownHours??old.cooldownHours)),1,720),categories:{...old.categories,...(input.categories??{})}};
  this.db.prepare("INSERT INTO proactive_settings(id,settings_json,updated_at) VALUES('global',?,?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at").run({},JSON.stringify(next),Date.now());return next;
 }
 recordEvent(event:ProactiveEventRecord):boolean{
  const source=event.payload;
  let safePayload:Record<string,unknown>={};
  switch(event.eventType){
   case "agent.turn.completed":
    safePayload={hasPrompt:typeof source.prompt==="string"&&Boolean((source.prompt as string).trim())};
    break;
   case "agent.turn.failed":
    safePayload={blocked:source.blocked===true};
    break;
   case "agent.tool.failed":
    safePayload={toolName:String(source.toolName??source.name??"unknown").trim().slice(0,120)};
    break;
   case "memory.preference.candidate":
    safePayload={
      category:String(source.category??"").slice(0,80),
      strength:String(source.strength??"").slice(0,40),
      scopeSuggestion:source.scopeSuggestion==="personal"?"personal":"workspace",
    };
    break;
   case "agent.workspace.changed":
    safePayload={source:String(source.source??"").slice(0,40),changeCount:clamp(Number(source.changeCount??0),0,100000)};
    break;
   case "app.activated":
    safePayload={source:String(source.source??"").slice(0,40)};
    break;
   default:
    safePayload={};
  }
  const result=this.db.prepare("INSERT OR IGNORE INTO proactive_events(event_id,scope_key,scope_value,task_id,event_type,occurred_at,source_ref,payload_json,processed_at) VALUES(?,?,?,?,?,?,?,?,?)")
   .run({},event.eventId,keyOf(event.scope),event.scope,event.taskId,event.eventType,event.occurredAt,event.sourceRef,JSON.stringify(safePayload),Date.now());
  const inserted=Number(result.changes)===1;
  if(inserted&&++this.eventWrites>=100){this.eventWrites=0;this.pruneHistory();}
  return inserted;
 }
 createCandidate(input:CandidateInput):AgentMemoryCandidate|null{
  const statement=input.statement.trim().replace(/\s+/g," ").slice(0,240);if(!statement)return null;
  const scopeKey=keyOf(input.scope),fingerprint=createHash("sha256").update(input.category+"\n"+statement.toLocaleLowerCase()).digest("hex");
  const existing=this.db.prepare("SELECT id FROM memory_candidates WHERE scope_key=? AND fingerprint=?").get({},scopeKey,fingerprint);
  if(existing)return null;
  const id=randomUUID(),now=Date.now();
  this.db.prepare("INSERT INTO memory_candidates(id,scope_key,scope_value,task_id,session_id,category,strength,statement,fingerprint,source_ref,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)")
   .run({},id,scopeKey,input.scope,input.taskId,input.sessionId,input.category,input.strength,statement,fingerprint,input.sourceRef,now,now,input.expiresAt);
  return this.getCandidate(id,input.scope);
 }
 getCandidate(id:string,scope:string|null):AgentMemoryCandidate|null{
  const keys=keysOf(scope),row=this.db.prepare("SELECT * FROM memory_candidates WHERE id=? AND scope_key IN ("+keys.map(()=>"?").join(",")+")").get({},id,...keys) as Record<string,unknown>|undefined;
  return row?this.toCandidate(row):null;
 }
 listCandidates(scope:string|null,limit=30):AgentMemoryCandidate[]{
  const keys=keysOf(scope),rows=this.db.prepare("SELECT * FROM memory_candidates WHERE scope_key IN ("+keys.map(()=>"?").join(",")+") AND status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT ?").all({},...keys,Date.now(),clamp(Math.floor(limit),1,100)) as Array<Record<string,unknown>>;
  return rows.map(row=>this.toCandidate(row));
 }
 updateCandidate(id:string,scope:string|null,status:ProactiveCandidateStatus,noteId?:string):void{
  const keys=keysOf(scope),r=this.db.prepare("UPDATE memory_candidates SET status=?,accepted_note_id=?,updated_at=? WHERE id=? AND scope_key IN ("+keys.map(()=>"?").join(",")+")").run({},status,noteId??null,Date.now(),id,...keys);
  if(Number(r.changes)!==1)throw new Error("Memory Preference Candidate 不存在或已失效。");
 }
 createOpportunity(input:OpportunityInput):AgentProactiveOpportunity|null{
  const settings=this.getSettings();if(!settings.enabled||!settings.categories[input.category])return null;
  const scopeKey=keyOf(input.scope),now=Date.now(),dedupe=input.dedupeKey.trim().slice(0,240);if(!dedupe)return null;
  const existing=this.db.prepare("SELECT * FROM proactive_opportunities WHERE scope_key=? AND dedupe_key=? AND status IN ('new','presented','pending_confirmation','scheduled','accepted','snoozed') AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 1").get({},scopeKey,dedupe,now) as Record<string,unknown>|undefined;
  if(existing)return this.toOpportunity(existing);
  const suppressed=this.db.prepare("SELECT id FROM proactive_feedback WHERE scope_key=? AND dedupe_key=? AND suppress_until>? LIMIT 1").get({},scopeKey,dedupe,now);
  if(suppressed)return null;
  const id=randomUUID(),confidence=clamp(input.confidence,0,1),impact=clamp(input.impact,0,1),urgency=clamp(input.urgency,0,1),score=confidence*30+impact*35+urgency*35;
  this.db.prepare("INSERT INTO proactive_opportunities(id,scope_key,scope_value,task_id,category,title,explanation,suggested_action,source_refs_json,confidence,impact,urgency,rank_score,status,dedupe_key,event_id,payload_json,created_at,updated_at,expires_at,due_at,snoozed_until,last_presented_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)")
   .run({},id,scopeKey,input.scope,input.taskId,input.category,input.title.slice(0,160),input.explanation.slice(0,1200),input.suggestedAction.slice(0,240),JSON.stringify([...new Set(input.sourceRefs)].slice(0,20)),confidence,impact,urgency,score,input.status??"new",dedupe,input.eventId,JSON.stringify(input.payload??{}),now,now,input.expiresAt??null,input.dueAt??null,null);
  return this.getOpportunity(id,input.scope);
 }
 getOpportunity(id:string,scope:string|null):AgentProactiveOpportunity|null{
  const keys=keysOf(scope),row=this.db.prepare("SELECT * FROM proactive_opportunities WHERE id=? AND scope_key IN ("+keys.map(()=>"?").join(",")+")").get({},id,...keys) as Record<string,unknown>|undefined;
  return row?this.toOpportunity(row):null;
 }
 recentToolFailures(scope:string|null,taskId:string|null,toolName:string,since:number,limit=12):Array<{sourceRef:string|null;occurredAt:number}>{
  const rows=this.db.prepare("SELECT occurred_at,source_ref,payload_json FROM proactive_events WHERE scope_key=? AND event_type='agent.tool.failed' AND task_id IS ? AND occurred_at>=? ORDER BY occurred_at DESC LIMIT ?").all({},keyOf(scope),taskId,since,clamp(Math.floor(limit),1,50)) as Array<Record<string,unknown>>;
  const name=toolName.trim().toLocaleLowerCase();
  return rows.filter(row=>String(parse<Record<string,unknown>>(row.payload_json,{}).toolName??"").trim().toLocaleLowerCase()===name).map(row=>({sourceRef:typeof row.source_ref==="string"?row.source_ref:null,occurredAt:Number(row.occurred_at)}));
 }
 resolveCandidateOpportunity(candidateId:string,scope:string|null,status:AgentProactiveOpportunity["status"]):void{
  const keys=keysOf(scope),rows=this.db.prepare(
    "SELECT id,payload_json FROM proactive_opportunities WHERE scope_key IN ("+keys.map(()=>"?").join(",")+") AND category='preference_confirmation' AND status NOT IN ('dismissed','acted','expired')"
  ).all({},...keys) as Array<Record<string,unknown>>;
  for(const row of rows){
    const payload=parse<Record<string,unknown>>(row.payload_json,{});
    if(String(payload.candidateId??"")===candidateId)this.updateOpportunity(String(row.id),scope,status);
  }
 }
 updateOpportunity(id:string,scope:string|null,status:AgentProactiveOpportunity["status"],options:{snoozedUntil?:number|null;category?:ProactiveCategory;title?:string}={}):void{
  const keys=keysOf(scope),r=this.db.prepare("UPDATE proactive_opportunities SET status=?,snoozed_until=?,category=COALESCE(?,category),title=COALESCE(?,title),updated_at=? WHERE id=? AND scope_key IN ("+keys.map(()=>"?").join(",")+")").run({},status,options.snoozedUntil??null,options.category??null,options.title??null,Date.now(),id,...keys);
  if(Number(r.changes)!==1)throw new Error("Proactive Opportunity 不存在或不属于当前 Workspace。");
 }
 recordFeedback(scope:string|null,category:string,dedupeKey:string,action:ProactiveFeedbackAction,suppressUntil:number|null):void{
  this.db.prepare("INSERT INTO proactive_feedback(id,scope_key,category,dedupe_key,action,created_at,suppress_until) VALUES(?,?,?,?,?,?,?)").run({},randomUUID(),keyOf(scope),category,dedupeKey,action,Date.now(),suppressUntil);
 }
 refreshLifecycle(scope:string|null,now=Date.now()):boolean{
  const keys=keysOf(scope),p=keys.map(()=>"?").join(",");
  let changes=0;
  changes+=Number(this.db.prepare("UPDATE proactive_opportunities SET status='expired',updated_at=? WHERE scope_key IN ("+p+") AND expires_at IS NOT NULL AND expires_at<=? AND status NOT IN ('dismissed','acted','expired')").run({},now,...keys,now).changes);
  changes+=Number(this.db.prepare("UPDATE proactive_opportunities SET status='new',snoozed_until=NULL,updated_at=? WHERE scope_key IN ("+p+") AND status='snoozed' AND snoozed_until IS NOT NULL AND snoozed_until<=?").run({},now,...keys,now).changes);
  changes+=Number(this.db.prepare("UPDATE proactive_opportunities SET status='new',category='follow_up_due',explanation='这是你之前确认的跟进事项：'||title||'。现在可以继续处理，或将提醒延后。',updated_at=? WHERE scope_key IN ("+p+") AND status='scheduled' AND due_at IS NOT NULL AND due_at<=?").run({},now,...keys,now).changes);
  changes+=Number(this.db.prepare("UPDATE memory_candidates SET status='expired',updated_at=? WHERE scope_key IN ("+p+") AND status='pending' AND expires_at<=?").run({},now,...keys,now).changes);
  return changes>0;
 }
 listActive(scope:string|null,limit=30,now=Date.now()):AgentProactiveOpportunity[]{
  const settings=this.getSettings();if(!settings.enabled)return[];
  this.refreshLifecycle(scope,now);
  const keys=keysOf(scope),p=keys.map(()=>"?").join(",");
  const day=new Date(now);day.setHours(0,0,0,0);
  const already=Number((this.db.prepare("SELECT COUNT(*) AS count FROM proactive_opportunities WHERE scope_key IN ("+p+") AND last_presented_at>=?").get({},...keys,day.getTime()) as {count?:number}).count??0);
  const remaining=Math.max(0,settings.maxPerDay-already);
  const rows=this.db.prepare("SELECT * FROM proactive_opportunities WHERE scope_key IN ("+p+") AND status IN ('new','presented','pending_confirmation') AND (expires_at IS NULL OR expires_at>?) ORDER BY rank_score DESC,urgency DESC,created_at DESC LIMIT ?").all({},...keys,Date.now(),clamp(Math.floor(limit),1,100)) as Array<Record<string,unknown>>;
  const eligible=rows.filter(row=>settings.categories[String(row.category) as ProactiveCategory]);
  const existing=eligible.filter(row=>Number(row.last_presented_at??0)>=day.getTime());
  const fresh=eligible.filter(row=>Number(row.last_presented_at??0)<day.getTime());
  const selected=[...existing,...fresh.slice(0,remaining)];
  for(const row of selected)if(Number(row.last_presented_at??0)<day.getTime())this.db.prepare("UPDATE proactive_opportunities SET status=CASE WHEN status='new' THEN 'presented' ELSE status END,last_presented_at=?,updated_at=? WHERE id=? AND status IN ('new','presented','pending_confirmation')").run({},now,now,String(row.id));
  return selected.map(row=>this.getOpportunity(String(row.id),scope)).filter((item):item is AgentProactiveOpportunity=>item!==null);
 }
 private toCandidate(row:Record<string,unknown>):AgentMemoryCandidate{
  return{id:String(row.id),scope:typeof row.scope_value==="string"?row.scope_value:null,taskId:typeof row.task_id==="string"?row.task_id:null,sessionId:typeof row.session_id==="string"?row.session_id:null,category:String(row.category),strength:String(row.strength) as AgentMemoryCandidate["strength"],statement:String(row.statement),status:String(row.status) as ProactiveCandidateStatus,sourceRef:typeof row.source_ref==="string"?row.source_ref:null,createdAt:Number(row.created_at),updatedAt:Number(row.updated_at),expiresAt:Number(row.expires_at),acceptedNoteId:typeof row.accepted_note_id==="string"?row.accepted_note_id:null};
 }
 private toOpportunity(row:Record<string,unknown>):AgentProactiveOpportunity{
  return{id:String(row.id),scope:typeof row.scope_value==="string"?row.scope_value:null,taskId:typeof row.task_id==="string"?row.task_id:null,category:String(row.category) as ProactiveCategory,title:String(row.title),explanation:String(row.explanation),suggestedAction:String(row.suggested_action),sourceRefs:parse<string[]>(row.source_refs_json,[]),confidence:Number(row.confidence),impact:Number(row.impact),urgency:Number(row.urgency),rankScore:Number(row.rank_score),status:String(row.status) as AgentProactiveOpportunity["status"],dedupeKey:String(row.dedupe_key),payload:parse<Record<string,unknown>>(row.payload_json,{}),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at),expiresAt:row.expires_at==null?null:Number(row.expires_at),dueAt:row.due_at==null?null:Number(row.due_at),snoozedUntil:row.snoozed_until==null?null:Number(row.snoozed_until),lastPresentedAt:row.last_presented_at==null?null:Number(row.last_presented_at)};
 }
 close():void{this.db.close();}
}
