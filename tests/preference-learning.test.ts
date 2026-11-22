import {describe,expect,it} from "vitest";
import {detectPreferenceCandidate,preferenceCandidateInstruction} from "../src/main/memory/preference-learning";
describe("Preference learning",()=>{
 it("recognizes a direct dietary preference without auto-saving it",()=>{
  const candidate=detectPreferenceCandidate("我不吃糖，请给我一份晚餐建议。");
  expect(candidate).toMatchObject({category:"food",strength:"strong_signal",scopeSuggestion:"workspace",explicitSaveRequest:false});
  expect(preferenceCandidateInstruction(candidate!)).toContain("Do not save this candidate yet");
 });
 it("recognizes a future-facing diagram rule as explicit",()=>{
  const candidate=detectPreferenceCandidate("From now on, never use ASCII diagrams.");
  expect(candidate).toMatchObject({category:"diagrams",strength:"explicit",scopeSuggestion:"workspace"});
 });
 it("requires explicit cross-project wording for Personal Memory",()=>{
  const candidate=detectPreferenceCandidate("Please remember across all projects: I prefer concise answers.");
  expect(candidate).toMatchObject({category:"communication",strength:"explicit",scopeSuggestion:"personal",explicitSaveRequest:true});
  expect(preferenceCandidateInstruction(candidate!)).toContain("existing Memory write flow");
 });
 it("does not treat a one-off recipe request as a durable preference",()=>{
  expect(detectPreferenceCandidate("Give me a recipe with no added sugar.")).toBeNull();
 });
 it("does not create candidates from credentials or health diagnoses",()=>{
  expect(detectPreferenceCandidate("Remember my API key is abc123")).toBeNull();
  expect(detectPreferenceCandidate("I have diabetes and take medication")).toBeNull();
 });
 it("does not infer a Personal scope from an ordinary preference statement",()=>{
  expect(detectPreferenceCandidate("我偏好简洁的架构说明。")).toMatchObject({scopeSuggestion:"workspace",explicitSaveRequest:false});
 });
});
