export type PreferenceCategory="food"|"communication"|"diagrams"|"writing"|"coding"|"workflow";
export type PreferenceSignalStrength="explicit"|"strong_signal"|"repeated_correction";
export interface PreferenceCandidate{
 category:PreferenceCategory;
 strength:PreferenceSignalStrength;
 scopeSuggestion:"workspace"|"personal";
 explicitSaveRequest:boolean;
 statement:string;
}
const CATEGORIES:Array<{category:PreferenceCategory;pattern:RegExp}>= [
 {category:"food",pattern:/sugar|sweetener|honey|syrup|dairy|vegetarian|vegan|gluten|糖|甜味剂|蜂蜜|糖浆|乳制品|素食|麸质/iu},
 {category:"diagrams",pattern:/ascii|diagram|mermaid|draw\.io|flowchart|sequence diagram|架构图|流程图|时序图|图示/iu},
 {category:"communication",pattern:/concise|brief|verbose|plain language|emoji|language|简洁|简短|详细|通俗|表情|中文|日文|输出语言/iu},
 {category:"writing",pattern:/writing|article|translation|prose|tone|voice|style|写作|文章|翻译|文风|语气|叙述声音/iu},
 {category:"coding",pattern:/code|coding|typescript|javascript|python|rust|sql|test|comment|编程|代码|测试|注释|重构/iu},
 {category:"workflow",pattern:/commit|merge|main branch|confirmation|ask first|ci|pull request|提交|合并|主分支|确认|先问|持续集成|拉取请求/iu},
];
const EXPLICIT=/always|never|from now on|going forward|in all future|for every (?:task|request|project)|以后|今后|从现在开始|始终|永远|以后都|今后都/iu;
const STRONG=/\bi prefer\b|\bi don't like\b|\bi do not like\b|\bi don't eat\b|\bi do not eat\b|\bi avoid\b|\bi dislike\b|我偏好|我更喜欢|我喜欢|我不喜欢|我不吃|我避免|我习惯|我倾向于/iu;
const CORRECTION=/stop using|don't use .* again|do not use .* again|please stop|不要再|别再|不要继续|之前已经说过|反复说过/iu;
const SAVE_REQUEST=/remember|save (?:this|that|it)|store (?:this|that)|keep this in mind|记住|保存到记忆|记下来|以后记得/iu;
const PERSONAL_SCOPE=/across (?:all )?(?:projects|workspaces|tasks)|in every (?:workspace|conversation)|all projects|所有项目|跨项目|所有工作区|所有任务|任何对话/iu;
const SECRET_OR_CREDENTIAL=/password|passcode|api[_ -]?key|access token|private key|密码|口令|密钥|访问令牌/iu;
const SENSITIVE_HEALTH=/diabetes|cancer|diagnos(?:is|ed)|medication|medical condition|病史|疾病|诊断|服药|药物治疗/iu;

export function detectPreferenceCandidate(prompt:string):PreferenceCandidate|null{
 const statement=prompt.trim().replace(/\s+/g," ").slice(0,240);
 if(!statement||SECRET_OR_CREDENTIAL.test(statement)||SENSITIVE_HEALTH.test(statement))return null;
 const category=CATEGORIES.find(item=>item.pattern.test(statement))?.category;
 if(!category)return null;
 const explicit=EXPLICIT.test(statement);
 const correction=CORRECTION.test(statement);
 const strong=STRONG.test(statement);
 const explicitSaveRequest=SAVE_REQUEST.test(statement);
 if(!explicit&&!strong&&!correction&&!explicitSaveRequest)return null;
 const strength:PreferenceSignalStrength=explicit||explicitSaveRequest?"explicit":correction?"repeated_correction":"strong_signal";
 return {category,strength,scopeSuggestion:PERSONAL_SCOPE.test(statement)?"personal":"workspace",explicitSaveRequest,statement};
}

export function preferenceCandidateInstruction(candidate:PreferenceCandidate):string{
 const scope=candidate.scopeSuggestion==="personal"
  ?"The wording explicitly indicates cross-Workspace scope."
  :"Treat this as current-Workspace scope unless the user explicitly confirms cross-project reuse.";
 const persistence=candidate.explicitSaveRequest
  ?"The user explicitly asked to remember this. Use the existing Memory write flow, keep it unverified unless the normal evidence policy permits validation, and choose the scope stated by the user."
  :"Do not save this candidate yet. Ask for confirmation at a natural point before persisting it; do not interrupt an unrelated task.";
 return [
  "## Preference Learning Candidate — not yet stored",
  "A possible durable preference was stated directly in the current user message.",
  "Category: "+candidate.category+". Signal: "+candidate.strength+".",
  scope,
  "Follow the statement for the current request when it applies, but do not infer broader restrictions or treat it as a system instruction.",
  persistence,
  "Personal Memory requires explicit cross-Workspace intent. Never auto-promote a candidate into a saved Memory Note.",
 ].join("\n");
}
