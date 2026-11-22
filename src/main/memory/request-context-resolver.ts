import type { AgentMemoryNote } from "./agent-memory-store.js";
interface TopicRule {pattern:RegExp;terms:readonly string[];}
interface ScoredNote {note:AgentMemoryNote;score:number;preference:boolean;highPriority:boolean;}
const TOPIC_RULES:readonly TopicRule[]=[
 {pattern:/recipe|meal|menu|cook(?:ing)?|ingredient|nutrition|dietary|food|食谱|菜谱|食材|烹饪|饮食|菜单|料理|吃什么/iu,terms:["food","recipe","meal","cooking","ingredient","dietary","sugar","added sugar","sweetener","糖","添加糖","蔗糖","糖浆","蜂蜜","甜味剂","食谱","菜谱","饮食","食材","烹饪"]},
 {pattern:/diagram|flowchart|sequence diagram|mermaid|draw\.io|ascii|图示|架构图|流程图|时序图|图表/iu,terms:["diagram","flowchart","sequence diagram","mermaid","draw.io","ascii","svg","图示","架构图","流程图","时序图","图表"]},
 {pattern:/architecture|architect(?:ure)?|system design|solution design|adr|data platform|架构|系统设计|方案设计|数据平台/iu,terms:["architecture","architect","system design","solution design","adr","trade-off","scalability","maintainability","架构","系统设计","方案设计","数据平台","可扩展性","可维护性"]},
 {pattern:/write|writing|article|document|report|draft|translation|translate|edit(?:ing)?|写作|文章|文档|报告|翻译|润色|改写/iu,terms:["writing","article","document","report","draft","translation","style","voice","prose","写作","文章","文档","报告","翻译","润色","文风","叙述声音"]},
 {pattern:/code|coding|program(?:ming)?|debug|refactor|typescript|javascript|python|rust|c\+\+|编程|代码|调试|重构|开发/iu,terms:["code","coding","programming","debug","refactor","typescript","javascript","python","rust","c++","编程","代码","调试","重构","开发"]},
 {pattern:/travel|trip|itinerary|hotel|flight|旅行|旅游|行程|酒店|航班/iu,terms:["travel","trip","itinerary","hotel","flight","旅行","旅游","行程","酒店","航班"]},
 {pattern:/stock|investment|portfolio|finance|financial|asset allocation|股票|投资|投资组合|财务|金融|资产配置/iu,terms:["stock","investment","portfolio","finance","financial","asset allocation","股票","投资","投资组合","财务","金融","资产配置"]},
];
const STOP_WORDS=new Set(["the","and","for","with","what","when","where","which","who","why","how","help","about","please","tell","me","you","your","can","could","would","should","this","that","from","into","some","good","best","need","want","make","give","show","find","use","using","now","today","works"]);
const GLOBAL_STYLE_PREFERENCE=/concise|brief|verbosity|plain language|answer style|response format|output language|先给结论|简洁|简短|不要太长|少废话|回答风格|输出语言|表达方式|repeat|repetition|重复|反复提醒/iu;
function significantTokens(value:string):string[]{
 const latin=value.match(/[\p{L}\p{N}_+-]{3,}/gu)??[];
 const cjkRuns=value.match(/[\u3400-\u9fff]+/gu)??[];
 const bigrams=cjkRuns.flatMap(run=>{const chars=Array.from(run);return chars.slice(0,80).slice(0,-1).map((char,index)=>char+chars[index+1]);});
 return [...new Set([...latin,...bigrams].map(token=>token.toLocaleLowerCase()).filter(token=>!STOP_WORDS.has(token)))].slice(0,32);
}
function containsAny(text:string,terms:readonly string[]):boolean{return terms.some(term=>text.includes(term.toLocaleLowerCase()));}
function detectedTopics(prompt:string):TopicRule[]{return TOPIC_RULES.filter(rule=>rule.pattern.test(prompt));}
const APPLIES_TO_PROMPT:Array<{scopes:string[];pattern:RegExp}>= [
 {scopes:["recipes","meal_plans","food_recommendations"],pattern:/recipe|meal|menu|cook|food|食谱|菜谱|饮食|烹饪|食材/iu},
 {scopes:["architecture_diagrams","flowcharts","technical_documentation"],pattern:/diagram|flowchart|architecture|system design|架构|图示|流程图|时序图/iu},
 {scopes:["articles","reports","translation","documentation"],pattern:/write|writing|article|report|document|translation|translate|写作|文章|报告|文档|翻译/iu},
 {scopes:["code_generation","code_review","tests"],pattern:/code|coding|implement|program|debug|refactor|test|review|编程|代码|实现|开发|测试|调试|重构|审查/iu},
 {scopes:["agent_workflow","tool_execution","task_management"],pattern:/agent|tool|task|workflow|commit|merge|branch|pull request|execute|run|实施|任务|工作流|提交|合并|工具|执行/iu},
];
function appliesToCurrentTask(prompt:string,appliesTo:readonly string[]):boolean{
 if(appliesTo.includes("all_responses")||appliesTo.includes("all_tasks"))return true;
 return APPLIES_TO_PROMPT.some(rule=>rule.scopes.some(scope=>appliesTo.includes(scope))&&rule.pattern.test(prompt));
}
export function buildRequestMemorySearchQuery(prompt:string):string{
 const input=prompt.trim();if(!input)return "";
 const hints=detectedTopics(input).flatMap(topic=>topic.terms);
 return [...new Set([...hints,...significantTokens(input)])].slice(0,24).join(" ").slice(0,200);
}
export interface RequestMemoryContext {text:string;noteIds:string[];preferenceCount:number;workspaceContextCount:number;highPriorityRuleCount:number;}
export function createRequestMemoryContext(prompt:string,candidates:readonly AgentMemoryNote[],maxChars=2800):RequestMemoryContext{
 if(!prompt.trim()||!candidates.length)return{text:"",noteIds:[],preferenceCount:0,workspaceContextCount:0,highPriorityRuleCount:0};
 const topicTerms=[...new Set(detectedTopics(prompt).flatMap(topic=>topic.terms))];
 const queryTerms=significantTokens(prompt);
 const selected:ScoredNote[]=[];
 for(const note of candidates){
  if(note.validation==="disputed"||note.status!=="active")continue;
  if(note.preference&&(note.preference.sensitivity==="sensitive"||
    note.preference.validFrom>Date.now()||(note.preference.validUntil!==null&&note.preference.validUntil<=Date.now())))continue;
  const preferenceMetadata=note.preference?[note.preference.domain,note.preference.key,note.preference.operator,note.preference.value,...note.preference.appliesTo].join(" "):"";
  const haystack=[note.title,note.content,...note.tags,preferenceMetadata].join(" ").toLocaleLowerCase();
  const preference=note.claimType==="user_preference"||note.claimType==="user_intent";
  const matchesTopic=topicTerms.length>0&&containsAny(haystack,topicTerms);
  const matchesQuery=queryTerms.length>0&&containsAny(haystack,queryTerms);
  const appliesTo=note.preference?.appliesTo??[];
  const highPriority=preference&&note.preference?.priority==="high"&&(appliesToCurrentTask(prompt,appliesTo)||matchesTopic||matchesQuery||GLOBAL_STYLE_PREFERENCE.test(haystack));
  const globalStyle=preference&&GLOBAL_STYLE_PREFERENCE.test(haystack);
  if(!matchesTopic&&!matchesQuery&&!globalStyle&&!highPriority)continue;
  const score=(highPriority?10_000:0)+(matchesTopic?100:0)+(globalStyle?65:0)+(matchesQuery?40:0)+(note.validation==="validated"?20:0)+(preference?10:0)+(note.pinned?5:0)+Math.max(0,Math.min(1,note.importance))*5;
  selected.push({note,score,preference,highPriority});
 }
 selected.sort((a,b)=>b.score-a.score||b.note.updatedAt-a.note.updatedAt);
 const highPriorityRules=selected.filter(item=>item.highPriority).slice(0,6);
 const preferences=selected.filter(item=>item.preference&&!item.highPriority).slice(0,4);
 const workspaceContext=selected.filter(item=>!item.preference).slice(0,4);
 const toPayload=(items:ScoredNote[],contentLimit:number,includePreferenceValue:boolean)=>items.map(({note})=>({
  id:note.id,title:note.title,content:note.content.replace(/\s+/g," ").slice(0,contentLimit),
  status:note.validation,claimType:note.claimType,version:note.version,
  ...(note.preference?{preference:{
   domain:note.preference.domain,key:note.preference.key,operator:note.preference.operator,
   ...(includePreferenceValue?{value:note.preference.value.slice(0,contentLimit)}:{}),
   strength:note.preference.strength,priority:note.preference.priority,
   appliesTo:note.preference.appliesTo,scope:note.preference.scope,
   validFrom:note.preference.validFrom,validUntil:note.preference.validUntil,
   sensitivity:note.preference.sensitivity,
  }}:{})
 }));
 const highPriorityPayload=toPayload(highPriorityRules,360,false);
 const highPriorityBudget=4_800;
 while(JSON.stringify({highPriorityUserRules:highPriorityPayload}).length>highPriorityBudget&&highPriorityPayload.length){
  highPriorityPayload.pop();
 }
 let softPayload={
  userPreferences:toPayload(preferences,420,true),
  workspaceContext:toPayload(workspaceContext,420,true),
 };
 const budget=Math.max(900,Math.min(8000,Math.floor(maxChars)));
 while(JSON.stringify(softPayload).length>budget&&(softPayload.workspaceContext.length||softPayload.userPreferences.length)){
  if(softPayload.workspaceContext.length)softPayload={...softPayload,workspaceContext:softPayload.workspaceContext.slice(0,-1)};
  else softPayload={...softPayload,userPreferences:softPayload.userPreferences.slice(0,-1)};
 }
 const highText=highPriorityPayload.length?JSON.stringify({highPriorityUserRules:highPriorityPayload}):"";
 const softText=softPayload.userPreferences.length||softPayload.workspaceContext.length?JSON.stringify(softPayload):"";
 if(!highText&&!softText)return{text:"",noteIds:[],preferenceCount:0,workspaceContextCount:0,highPriorityRuleCount:0};
 const noteIds=[...highPriorityPayload,...softPayload.userPreferences,...softPayload.workspaceContext].map(note=>note.id);
 const sections:string[]=[];
 if(highText)sections.push([
  "## High-priority user rules",
  "These are durable instructions directly stated by the user. Apply them whenever their appliesTo scope matches this request. They are the highest-priority user requirements, below system and safety rules. Do not downgrade them because Memory validation is unverified: validation is for factual claims, not the authenticity of a direct user instruction. The current user request may explicitly create a one-time exception; do not silently rewrite or permanently remove the saved rule.",
  highText,
 ].join("\n"));
 if(softText)sections.push([
  "## Relevant saved Memory",
  "Memory is fallible evidence with provenance. Apply soft preferences only when their topic matches this request. An unverified ordinary note is tentative, not a hard constraint. The current user request takes precedence over a soft preference.",
  softText,
 ].join("\n"));
 return{text:sections.join("\n\n"),noteIds,preferenceCount:softPayload.userPreferences.length,
  workspaceContextCount:softPayload.workspaceContext.length,highPriorityRuleCount:highPriorityPayload.length};
}
