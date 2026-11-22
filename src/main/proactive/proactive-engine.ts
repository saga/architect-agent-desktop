import { createHash } from "node:crypto";
import type { AgentProactiveOpportunity, ProactiveCategory, ProactiveFeedbackAction } from "../../shared/types.js";
import { ProactiveStore } from "./proactive-store.js";

export type AgentDomainEventType="agent.turn.completed"|"agent.turn.failed"|"agent.tool.failed"|"agent.task.created"|"agent.task.switched"|"agent.workspace.changed"|"memory.preference.candidate"|"memory.note.updated"|"app.activated";
export interface AgentDomainEvent{eventId:string;type:AgentDomainEventType;occurredAt:number;scope:string|null;taskId:string|null;sessionId?:string|null;sourceRef?:string|null;payload:Record<string,unknown>;}
export interface FollowUpCandidate{statement:string;dueAt:number;title:string;}
const DAY=86_400_000,FAILURE_WINDOW=30*60_000,FAILURE_THRESHOLD=3;
const WEEKDAYS={monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0} as const;
const CHINESE_DAYS:Record<string,number>={"日":0,"天":0,"一":1,"二":2,"三":3,"四":4,"五":5,"六":6};
const PROMISE=/\b(?:i(?:'ll| will)|we(?:'ll| will)|i plan to|we plan to|i intend to|remind me to|remind me in|remind me on|follow up|need to follow up|by (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|我会|我将在|我计划|我打算|我来|提醒我|记得提醒我|需要跟进|跟进.{0,12}(?:明天|后天|下周|周[一二三四五六日天])/iu;
function makeLocalDate(year:number,month:number,day:number):Date|null{const d=new Date(year,month,day,9,0,0,0);return d.getFullYear()===year&&d.getMonth()===month&&d.getDate()===day?d:null;}
function weekdayAfter(now:Date,weekday:number,forceNext:boolean):Date{
 const current=new Date(now.getFullYear(),now.getMonth(),now.getDate(),9,0,0,0);
 if(forceNext){
  const mondayOffset=(current.getDay()+6)%7;
  const nextMonday=new Date(current);nextMonday.setDate(current.getDate()-mondayOffset+7);
  nextMonday.setDate(nextMonday.getDate()+(weekday+6)%7);
  return nextMonday;
 }
 let offset=(weekday-current.getDay()+7)%7;if(offset===0)offset=7;
 current.setDate(current.getDate()+offset);return current;
}
function parseDue(prompt:string,nowMs:number):Date|null{
 const now=new Date(nowMs);let date:Date|null=null;let m=prompt.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
 if(m)date=makeLocalDate(+m[1],+m[2]-1,+m[3]);
 if(!date&&(m=prompt.match(/(\d{1,2})月(\d{1,2})日/))){let year=now.getFullYear();date=makeLocalDate(year,+m[1]-1,+m[2]);if(date&&date.getTime()<new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime())date=makeLocalDate(++year,+m[1]-1,+m[2]);}
 if(!date&&(m=prompt.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i))){const month=new Date(m[1]+" 1, 2000").getMonth();let year=now.getFullYear();date=makeLocalDate(year,month,+m[2]);if(date&&date.getTime()<new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime())date=makeLocalDate(++year,month,+m[2]);}
 if(!date){
  const zh=prompt.match(/(?:下周|下星期)([一二三四五六日天])|(?:周|星期)([一二三四五六日天])/u);
  const nextWeekEnglish=prompt.match(/\bnext\s+week\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const english=prompt.match(/\b(next\s+|this\s+|by\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const offsetMatch=prompt.match(/\b(?:in|within)\s+(\d{1,2})\s+days?\b|\b(?:in|within)\s+(\d{1,2})\s+weeks?\b|(?:在)?(\d{1,2})天后|(?:在)?(\d{1,2})周后/u);
  const offsetDays=offsetMatch?(offsetMatch[1]?Number(offsetMatch[1]):offsetMatch[2]?Number(offsetMatch[2])*7:offsetMatch[3]?Number(offsetMatch[3]):Number(offsetMatch[4])*7):0;
  const chineseOffset=prompt.match(/(一|二|两|三|四|五|六|七|八|九|十)天后/u);
  const chineseDays:Record<string,number>={"一":1,"二":2,"两":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10};
  if(/\bday after tomorrow\b|大后天/iu.test(prompt))date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+3,9);
  else if(/\btomorrow\b|明天|后天/iu.test(prompt))date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+( /后天/u.test(prompt)?2:1),9);
  else if(chineseOffset)date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+chineseDays[chineseOffset[1]!]!,9);
  else if(offsetDays>0&&offsetDays<=180)date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offsetDays,9);
  else if(/\btoday\b|今天|今日/iu.test(prompt))date=new Date(now.getFullYear(),now.getMonth(),now.getDate(),17);
  else if(zh){const day=zh[1]??zh[2]!;date=weekdayAfter(now,CHINESE_DAYS[day]!,Boolean(zh[1]));}
  else if(nextWeekEnglish)date=weekdayAfter(now,WEEKDAYS[nextWeekEnglish[1]!.toLowerCase() as keyof typeof WEEKDAYS],true);
  else if(english)date=weekdayAfter(now,WEEKDAYS[english[2]!.toLowerCase() as keyof typeof WEEKDAYS],Boolean(english[1]&&/next/i.test(english[1])));
  else if(/\bnext week\b|下周|下星期/iu.test(prompt))date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+7,9);
 }
 if(!date)return null;
 let h=date.getHours(),min=0;
 const clock=prompt.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/i),ampm=prompt.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i),zhClock=prompt.match(/(上午|早上|中午|下午|晚上)(\d{1,2})(?:点|时)(\d{1,2}分)?/u);
 if(clock){h=+clock[1];min=+clock[2];}
 else if(ampm){h=(+ampm[1]%12)+(ampm[3]!.toLowerCase()==="pm"?12:0);min=+(ampm[2]??0);}
 else if(zhClock){h=+zhClock[2];if(zhClock[1]==="下午"||zhClock[1]==="晚上")h=h%12+12;else if(zhClock[1]==="中午"&&h<11)h+=12;min=+(zhClock[3]??"0").replace(/\D/g,"");}
 else if(date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth()&&date.getDate()===now.getDate()){const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),17);if(today.getTime()<=nowMs)today.setTime(nowMs+15*60_000);return today;}
 if(h<0||h>23||min<0||min>59)return null;date.setHours(h,min,0,0);return date.getTime()>nowMs?date:null;
}
export function detectFollowUpCandidate(prompt:string,now=Date.now()):FollowUpCandidate|null{
 const statement=prompt.trim().replace(/\s+/g," ").slice(0,300);if(!statement||!PROMISE.test(statement))return null;
 const due=parseDue(statement,now);if(!due)return null;
 const action=statement.replace(/\b(?:by|on|before|next|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi," ").replace(/(?:明天|后天|大后天|下周[一二三四五六日天]?|下星期[一二三四五六日天]?|周[一二三四五六日天]|星期[一二三四五六日天]?|20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日)/g," ").replace(/\s+/g," ").trim();
 return{statement,dueAt:due.getTime(),title:"待跟进："+(action||"用户承诺事项").slice(0,72)};
}
const str=(p:Record<string,unknown>,k:string,max=400)=>typeof p[k]==="string"?(p[k] as string).replace(/\s+/g," ").slice(0,max):"";
const toolOf=(p:Record<string,unknown>)=>str(p,"toolName",120)||str(p,"name",120)||"unknown";
export class ProactiveOpportunityEngine{
 constructor(private readonly store:ProactiveStore){}
 ingest(event:AgentDomainEvent):AgentProactiveOpportunity|null{
  if(!this.store.recordEvent({eventId:event.eventId,scope:event.scope,taskId:event.taskId,eventType:event.type,occurredAt:event.occurredAt,sourceRef:event.sourceRef??null,payload:event.payload}))return null;
  const refs=event.sourceRef?[event.sourceRef]:[];
  if(!this.store.getSettings().enabled&&event.type!=="memory.preference.candidate"){this.evaluatePending(event.scope);return null;}
  if(event.type==="memory.preference.candidate"){
   const strength=event.payload.strength,category=str(event.payload,"category",80)||"communication",statement=str(event.payload,"statement",240);
   if(!statement||!["explicit","strong_signal","repeated_correction"].includes(String(strength)))return null;
   const scope=event.payload.scopeSuggestion==="personal"?null:event.scope;
   const candidate=this.store.createCandidate({scope,taskId:event.taskId,sessionId:event.sessionId??null,category,strength:strength as "explicit"|"strong_signal"|"repeated_correction",statement,sourceRef:event.sourceRef??null,expiresAt:event.occurredAt+30*DAY});
   if(!candidate)return null;
   return this.store.createOpportunity({scope,taskId:event.taskId,category:"preference_confirmation",title:"确认一项长期偏好",explanation:"你在最近的对话中表达了这项偏好。确认后才会保存为 Memory Note；未经确认不会成为长期规则。",suggestedAction:"确认后保存为用户偏好",sourceRefs:refs,confidence:strength==="explicit"?0.96:0.82,impact:0.55,urgency:0.3,dedupeKey:"preference:"+category+":"+createHash("sha256").update(statement.toLowerCase()).digest("hex").slice(0,24),eventId:event.eventId,status:"pending_confirmation",expiresAt:candidate.expiresAt,payload:{candidateId:candidate.id,statement,preferenceCategory:category,strength}});
  }
  if(event.type==="agent.turn.completed"){
   const candidate=detectFollowUpCandidate(str(event.payload,"prompt",1000),event.occurredAt);if(!candidate)return null;
   const hash=createHash("sha256").update(candidate.statement.toLowerCase()).digest("hex").slice(0,24);
   return this.store.createOpportunity({scope:event.scope,taskId:event.taskId,category:"follow_up_confirmation",title:candidate.title,explanation:"检测到一项带有明确日期的用户承诺。确认后才会在到期时提醒，不会自动创建 Schedule 或执行任务。",suggestedAction:"确认此跟进时间",sourceRefs:refs,confidence:0.9,impact:0.65,urgency:0.45,dedupeKey:"follow-up:"+hash,eventId:event.eventId,status:"pending_confirmation",expiresAt:candidate.dueAt+14*DAY,dueAt:candidate.dueAt,payload:{statement:candidate.statement}});
  }
  if(event.type==="agent.tool.failed"){
   const name=toolOf(event.payload),failures=this.store.recentToolFailures(event.scope,event.taskId,name,event.occurredAt-FAILURE_WINDOW,12);
   if(failures.length<FAILURE_THRESHOLD)return null;
   const evidence=[...new Set([...failures.map(x=>x.sourceRef),event.sourceRef].filter((x):x is string=>Boolean(x)))].slice(0,10);
   return this.store.createOpportunity({scope:event.scope,taskId:event.taskId,category:"repeated_tool_failure",title:"工具连续失败："+name,explanation:"同一工具在 30 分钟内失败 "+failures.length+" 次。建议检查最近 Trace，先定位共同原因，不假设存在可用替代方案。",suggestedAction:"检查失败记录",sourceRefs:evidence,confidence:0.94,impact:0.7,urgency:0.72,dedupeKey:"tool-failure:"+(event.taskId??"no-task")+":"+name.toLowerCase(),eventId:event.eventId,expiresAt:event.occurredAt+7*DAY,payload:{toolName:name,failureCount:failures.length}});
  }
  if(event.type==="agent.turn.failed"){
   const error=str(event.payload,"error",500);if(!event.payload.blocked&&!/blocked|waiting for input|missing prerequisite|被阻塞|无法继续|缺少必要输入|等待用户/u.test(error))return null;
   return this.store.createOpportunity({scope:event.scope,taskId:event.taskId,category:"blocker",title:"当前任务可能被阻塞",explanation:error||"最近一次执行未能继续。建议检查来源 Trace，确认缺少的输入或权限。",suggestedAction:"检查阻塞原因",sourceRefs:refs,confidence:0.82,impact:0.8,urgency:0.8,dedupeKey:"blocker:"+(event.taskId??"no-task")+":"+createHash("sha256").update(error.toLowerCase()).digest("hex").slice(0,16),eventId:event.eventId,expiresAt:event.occurredAt+3*DAY});
  }
  this.evaluatePending(event.scope);return null;
 }
 evaluatePending(scope:string|null):boolean{return this.store.refreshLifecycle(scope);}
 listActive(scope:string|null,limit=30):AgentProactiveOpportunity[]{this.evaluatePending(scope);return this.store.listActive(scope,limit);}
 feedback(input:{id:string;scope:string|null;action:ProactiveFeedbackAction;snoozeUntil?:number}):void{
  const item=this.store.getOpportunity(input.id,input.scope);if(!item)throw new Error("Proactive Opportunity 不存在或不属于当前 Workspace。");
  const now=Date.now();
  const settings=this.store.getSettings();
  if(input.action==="snooze"){const until=input.snoozeUntil??now+settings.cooldownHours*60*60_000;this.store.updateOpportunity(input.id,input.scope,"snoozed",{snoozedUntil:until});this.store.recordFeedback(item.scope,item.category,item.dedupeKey,input.action,until);return;}
  if(input.action==="dismiss"||input.action==="irrelevant"){this.store.updateOpportunity(input.id,input.scope,"dismissed");this.store.recordFeedback(item.scope,item.category,item.dedupeKey,input.action,now+(input.action==="irrelevant"?90*DAY:settings.cooldownHours*60*60_000));return;}
  if(input.action==="accept"&&item.category==="follow_up_confirmation"){if(item.dueAt===null)throw new Error("跟进事项缺少有效时间，无法加入提醒。");this.store.updateOpportunity(input.id,input.scope,"scheduled");this.store.recordFeedback(item.scope,item.category,item.dedupeKey,input.action,null);return;}
  this.store.updateOpportunity(input.id,input.scope,input.action==="accept"?"accepted":"acted");this.store.recordFeedback(item.scope,item.category,item.dedupeKey,input.action,null);
 }
}
