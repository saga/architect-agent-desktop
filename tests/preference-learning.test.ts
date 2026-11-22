import {describe,expect,it} from "vitest";
import {detectPreferenceCandidate,preferenceCandidateInstruction} from "../src/main/memory/preference-learning";
describe("Preference learning",()=>{
 it("recognizes a direct dietary preference without auto-saving it",()=>{
  const candidate=detectPreferenceCandidate("我不吃糖，请给我一份晚餐建议。");
  expect(candidate).toMatchObject({category:"food",strength:"strong_signal",scopeSuggestion:"workspace",explicitSaveRequest:false});
  expect(preferenceCandidateInstruction(candidate!)).toContain("Do not save this candidate yet");
 });
 it("recognizes a future-facing diagram rule as a high-priority auto-save instruction",()=>{
  const candidate=detectPreferenceCandidate("From now on, never use ASCII diagrams.");
  expect(candidate).toMatchObject({category:"diagrams",key:"diagram_output_format",strength:"explicit",priority:"high",autoPersist:true,scopeSuggestion:"workspace"});
 });
 it("treats a general no-repeat interaction rule as cross-workspace Personal Memory",()=>{
  expect(detectPreferenceCandidate("不要让我反复提醒。")).toMatchObject({category:"interaction",priority:"high",autoPersist:true,scopeSuggestion:"personal"});
  expect(detectPreferenceCandidate("这个项目里不要让我反复提醒。")).toMatchObject({category:"interaction",scopeSuggestion:"workspace"});
 });
 it("recognizes angry repeat-correction language as a high-priority interaction rule",()=>{
  const candidate=detectPreferenceCandidate("不要让我反复提醒，不要再让我重复已经说过的要求。");
  expect(candidate).toMatchObject({category:"interaction",key:"avoid_repeating_user_requirements",strength:"repeated_correction",priority:"high",autoPersist:true});
 });
 it("recognizes direct angry correction wording in English and Chinese",()=>{
  expect(detectPreferenceCandidate("Don't make me remind you again: never regenerate the old diagram format.")).toMatchObject({category:"diagrams",priority:"high",autoPersist:true});
  expect(detectPreferenceCandidate("我已经说了很多次，不要再用 ASCII 图。")).toMatchObject({category:"diagrams",priority:"high",autoPersist:true});
 });
 it("recognizes a direct remember request as immediate persistence",()=>{
  expect(detectPreferenceCandidate("记住，以后架构图不要使用 ASCII，统一使用 Mermaid。")).toMatchObject({category:"diagrams",priority:"high",autoPersist:true,explicitSaveRequest:true});
 });
 it("requires explicit cross-project wording for Personal Memory",()=>{
  const candidate=detectPreferenceCandidate("Please remember across all projects: I prefer concise answers.");
  expect(candidate).toMatchObject({category:"communication",strength:"explicit",scopeSuggestion:"personal",explicitSaveRequest:true});
  expect(candidate).toMatchObject({priority:"high",autoPersist:true});
  expect(preferenceCandidateInstruction(candidate!)).toContain("save it immediately");
 });
 it("does not confuse a memory recall question with a save request",()=>{
  expect(detectPreferenceCandidate("Do you remember the Mermaid format?")).toBeNull();
  expect(detectPreferenceCandidate("Never mind, create a Mermaid diagram for this request.")).toBeNull();
 });
 it("does not treat a one-off recipe request as a durable preference",()=>{
  expect(detectPreferenceCandidate("Give me a recipe with no added sugar.")).toBeNull();
 });
 it("does not create candidates from credentials or health diagnoses",()=>{
  expect(detectPreferenceCandidate("Remember my API key is abc123")).toBeNull();
  expect(detectPreferenceCandidate("I have diabetes and take medication")).toBeNull();
 });
 it("excludes sensitive health and personal-attribute statements from automatic candidates",()=>{
  expect(detectPreferenceCandidate("请记住，我有糖尿病，需要控制饮食。")).toBeNull();
  expect(detectPreferenceCandidate("Remember my religious affiliation and political party.")).toBeNull();
  expect(detectPreferenceCandidate("Please remember my API token is secret.")).toBeNull();
 });
 it("excludes sensitive financial and account information from automatic candidates",()=>{
  expect(detectPreferenceCandidate("Remember my salary and personal debt.")).toBeNull();
  expect(detectPreferenceCandidate("请记住我的银行账户余额和信用卡信息。")).toBeNull();
 });
 it("does not confuse technical words with sensitive personal attributes",()=>{
  expect(detectPreferenceCandidate("Please remember that trace reviews should be concise.")).not.toBeNull();
  expect(detectPreferenceCandidate("Please remember that archive workflows should stay simple.")).not.toBeNull();
 });
 it("does not classify technical terms as sensitive personal attributes",()=>{
  expect(detectPreferenceCandidate("Please remember that race condition reviews should be concise.")).not.toBeNull();
  expect(detectPreferenceCandidate("Please remember that architecture trade-offs should be explicit.")).not.toBeNull();
  expect(detectPreferenceCandidate("Please remember that archive workflows should stay simple.")).not.toBeNull();
 });
 it("does not infer a Personal scope from an ordinary preference statement",()=>{
  expect(detectPreferenceCandidate("我偏好简洁的架构说明。")).toMatchObject({scopeSuggestion:"workspace",explicitSaveRequest:false});
 });
});
