import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {AgentMemoryStore} from "../src/main/memory/agent-memory-store";
import {buildRequestMemorySearchQuery,createRequestMemoryContext} from "../src/main/memory/request-context-resolver";
const directories:string[]=[];
function temporaryDirectory():string{const directory=mkdtempSync(path.join(tmpdir(),"architect-agent-request-context-"));directories.push(directory);return directory;}
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
describe("Request memory context resolver",()=>{
 it("expands a recipe request with food-preference search terms",()=>{
  const query=buildRequestMemorySearchQuery("Give me a simple dinner recipe.");
  expect(query).toContain("sugar");expect(query).toContain("添加糖");expect(query).toContain("recipe");
 });
 it("injects only topic-relevant preferences and excludes disputed notes",()=>{
  const store=new AgentMemoryStore(path.join(temporaryDirectory(),"memory.sqlite"));
  store.saveNote({scope:null,title:"Added sugar restriction",content:"Avoid added sugar and sweeteners in recipes and meal plans.",claimType:"user_preference",tags:["food","recipe","sugar"]});
  store.saveNote({scope:null,title:"Diagram output preference",content:"Use a visual diagram instead of ASCII diagrams.",claimType:"user_preference",tags:["diagram","architecture"],validation:"disputed"});
  const candidates=store.search("/workspace/recipes",buildRequestMemorySearchQuery("Suggest a dinner recipe."),12);
  const result=createRequestMemoryContext("Suggest a dinner recipe.",candidates);
  expect(result.preferenceCount).toBe(1);expect(result.text).toContain("Added sugar restriction");expect(result.text).not.toContain("Diagram output preference");
  expect(createRequestMemoryContext("Explain a database transaction.",candidates).text).toBe("");store.close();
 });
 it("reuses Memory scope isolation so another Workspace note cannot enter the request",()=>{
  const store=new AgentMemoryStore(path.join(temporaryDirectory(),"memory.sqlite"));
  store.saveNote({scope:null,title:"Food preference",content:"Avoid added sugar in recipes.",claimType:"user_preference",tags:["food","recipe","sugar"]});
  store.saveNote({scope:"/workspace/private",title:"Private project food policy",content:"Private project recipe policy requires added sugar for this experiment.",claimType:"project_fact",tags:["food","recipe","sugar"]});
  const candidates=store.search("/workspace/other",buildRequestMemorySearchQuery("Suggest a dinner recipe."),12);
  const result=createRequestMemoryContext("Suggest a dinner recipe.",candidates);
  expect(result.text).toContain("Food preference");expect(result.text).not.toContain("Private project food policy");store.close();
 });
 it("keeps general answer-style preferences available across domains",()=>{
  const store=new AgentMemoryStore(path.join(temporaryDirectory(),"memory.sqlite"));
  store.saveNote({scope:null,title:"Answer style",content:"Prefer concise answers and plain language.",claimType:"user_preference"});
  const candidates=[...new Map([...store.search("/workspace/architecture","sqlite wal transaction",12),...store.list(null,100)].map(note=>[note.id,note])).values()];
  const result=createRequestMemoryContext("Explain how SQLite WAL works.",candidates);
  expect(result.preferenceCount).toBe(1);expect(result.text).toContain("Answer style");store.close();
 });
 it("injects a high-priority interaction rule without topic keyword matching",()=>{
  const store=new AgentMemoryStore(path.join(temporaryDirectory(),"memory.sqlite"));
  store.saveConfirmedPreference({
   id:"global-no-repeat-rule",scope:"/workspace/interaction",title:"High-priority interaction rule",
   content:"不要让我反复提醒；先检查本轮会话和已提供的要求。",
   category:"interaction",key:"avoid_repeating_user_requirements",
   sourceSessionId:"session-rule",sourceTraceId:"trace-rule",createdAt:Date.now(),
   crossWorkspaceConfirmed:false,strength:"repeated_correction",priority:"high",
  });
  const rules=store.listHighPriorityPreferences("/workspace/interaction",20);
  const result=createRequestMemoryContext("Summarize the API design.",rules);
  expect(result.highPriorityRuleCount).toBe(1);
  expect(result.text).toContain("High-priority user rules");
  expect(result.text).toContain("avoid_repeating_user_requirements");
  store.close();
 });
 it("keeps multiple high-priority rules ahead of the ordinary-memory context budget",()=>{
   const store=new AgentMemoryStore(path.join(temporaryDirectory(),"memory.sqlite"));
   for(let i=0;i<6;i++){
    store.saveConfirmedPreference({
     id:"global-rule-"+i,scope:"/workspace/many-rules",title:"High-priority interaction rule "+i,
     content:"不要让我反复提醒。规则编号 "+i+"；执行前先检查当前会话与已有要求。",
     category:"interaction",key:"avoid_repeating_user_requirements",
     sourceSessionId:"session-many-rules-"+i,sourceTraceId:"trace-many-rules-"+i,createdAt:Date.now()+i,
     crossWorkspaceConfirmed:false,strength:"repeated_correction",priority:"high",
    });
   }
   const rules=store.listHighPriorityPreferences("/workspace/many-rules",20);
   const result=createRequestMemoryContext("Summarize the API design.",rules,900);
   expect(result.highPriorityRuleCount).toBe(6);
   expect(result.text).toContain("global-rule-0");
   expect(result.text).toContain("global-rule-5");
   store.close();
  });
  it("applies high-priority execution workflow rules to implementation and test tasks",()=>{
  const store=new AgentMemoryStore(path.join(temporaryDirectory(),"memory.sqlite"));
  store.saveConfirmedPreference({
   id:"workflow-rule",scope:"/workspace/workflow-rules",title:"High-priority workflow rule",
   content:"Do not wait for CI; run the relevant local checks and commit directly to main when asked.",
   category:"workflow",key:"delivery_workflow",
   sourceSessionId:"session-workflow-rule",sourceTraceId:"trace-workflow-rule",createdAt:Date.now(),
   crossWorkspaceConfirmed:false,strength:"repeated_correction",priority:"high",
  });
  const candidates=store.listHighPriorityPreferences("/workspace/workflow-rules",20);
  const result=createRequestMemoryContext("Implement this feature and run the relevant tests.",candidates);
  expect(result.highPriorityRuleCount).toBe(1);
  store.close();
 });
 it("injects domain-specific high-priority rules only for relevant requests",()=>{
  const store=new AgentMemoryStore(path.join(temporaryDirectory(),"memory.sqlite"));
  store.saveConfirmedPreference({
   id:"diagram-output-rule",scope:"/workspace/diagrams",title:"High-priority diagram rule",
   content:"Never use ASCII diagrams; use Mermaid for architecture diagrams.",
   category:"diagrams",key:"diagram_output_format",
   sourceSessionId:"session-diagram-rule",sourceTraceId:"trace-diagram-rule",createdAt:Date.now(),
   crossWorkspaceConfirmed:false,strength:"repeated_correction",priority:"high",
  });
  const candidates=store.listHighPriorityPreferences("/workspace/diagrams",20);
  expect(createRequestMemoryContext("Explain the API retry policy.",candidates).highPriorityRuleCount).toBe(0);
  expect(createRequestMemoryContext("Create an architecture diagram.",candidates).highPriorityRuleCount).toBe(1);
  store.close();
 });
 it("keeps Workspace context scoped to the active Workspace",()=>{
  const store=new AgentMemoryStore(path.join(temporaryDirectory(),"memory.sqlite"));
  store.saveNote({scope:"/workspace/a",title:"Architecture boundary",content:"The service owns persistence and the renderer only presents state.",claimType:"project_fact",tags:["architecture","renderer","service"]});
  const selected=createRequestMemoryContext("Review the architecture and renderer service boundary.",store.search("/workspace/a","architecture renderer service",12));
  expect(selected.workspaceContextCount).toBe(1);
  const other=store.search("/workspace/b","architecture renderer service",12);
  expect(createRequestMemoryContext("Review the architecture and renderer service boundary.",other).text).toBe("");store.close();
 });
});
