export type PreferenceCategory="food"|"communication"|"diagrams"|"writing"|"coding"|"workflow"|"interaction";
export type PreferenceSignalStrength="explicit"|"strong_signal"|"repeated_correction";
export type PreferencePriority="normal"|"high";
export interface PreferenceCandidate{
 category:PreferenceCategory;
 key:string;
 strength:PreferenceSignalStrength;
 priority:PreferencePriority;
 autoPersist:boolean;
 scopeSuggestion:"workspace"|"personal";
 explicitSaveRequest:boolean;
 statement:string;
}
const CATEGORIES:Array<{category:PreferenceCategory;pattern:RegExp}>= [
 {category:"interaction",pattern:/don't make me repeat|don't make me remind you again|stop making me repeat|don't ask me again|stop asking me to repeat|i(?:'ve| have) already (?:told|said)|already told you|不要让我反复提醒|别让我反复提醒|不要让我重复|别让我重复|不要让我再说一遍|不要再问我已经说过|我已经说过|我已经说了|早就说过|已经告诉过你|之前说过很多次|反复提醒|反复说过|不需要我再重复|不必让我再说明/iu},
 {category:"food",pattern:/sugar|sweetener|honey|syrup|dairy|vegetarian|vegan|gluten|糖|甜味剂|蜂蜜|糖浆|乳制品|素食|麸质/iu},
 {category:"diagrams",pattern:/ascii|diagram|mermaid|draw\.io|flowchart|sequence diagram|架构图|流程图|时序图|图示/iu},
 {category:"communication",pattern:/concise|brief|verbose|plain language|emoji|language|简洁|简短|详细|通俗|表情|中文|日文|输出语言/iu},
 {category:"writing",pattern:/writing|article|translation|prose|tone|voice|style|写作|文章|翻译|文风|语气|叙述声音/iu},
 {category:"coding",pattern:/code|coding|typescript|javascript|python|rust|sql|test|comment|编程|代码|测试|注释|重构/iu},
 {category:"workflow",pattern:/commit|merge|main branch|confirmation|ask first|ci|pull request|提交|合并|主分支|确认|先问|持续集成|拉取请求/iu},
];
const EXPLICIT=/always|never|from now on|going forward|in all future|for every (?:task|request|project)|以后|今后|从现在开始|始终|永远|以后都|今后都/iu;
const STRONG=/\bi prefer\b|\bi don't like\b|\bi do not like\b|\bi don't eat\b|\bi do not eat\b|\bi avoid\b|\bi dislike\b|我偏好|我更喜欢|我喜欢|我不喜欢|我不吃|我避免|我习惯|我倾向于/iu;
const CORRECTION=/stop using|don't use .* again|do not use .* again|please stop|don't make me repeat|don't make me remind you again|stop making me repeat|don't ask me again|stop asking me to repeat|i(?:'ve| have) already (?:told|said)|already told you|不要再|别再|不要继续|之前已经说过|反复说过|不要让我反复提醒|别让我反复提醒|不要让我重复|别让我重复|我已经说过|我已经说了|早就说过|已经告诉过你/iu;
const SAVE_REQUEST=/remember|save (?:this|that|it)|store (?:this|that)|keep this in mind|记住|保存到记忆|记下来|以后记得/iu;
const PERSONAL_SCOPE=/across (?:all )?(?:projects|workspaces|tasks)|in every (?:workspace|conversation)|all projects|all future (?:tasks|conversations|projects)|every conversation|所有项目|跨项目|所有工作区|所有任务|任何对话|所有对话|以后每个任务|今后每次对话/iu;
const SECRET_OR_CREDENTIAL=/password|passcode|api[_ -]?key|access token|private key|bearer token|credential|secret|凭据|令牌|密码|口令|密钥|访问令牌/iu;
const SENSITIVE_PERSONAL=/\b(?:diabetes|cancer|diagnos(?:is|ed)|medication|pregnan(?:t|cy)|hiv|psychiatric|mental illness|blood pressure)\b|\b(?:my|our)\s+(?:religion|religious affiliation|political affiliation|political party|sexual orientation|sex life|ethnicity|race|citizenship|immigration status|bank account|account balance|credit card|credit score|salary|income|personal debt|financial hardship|bankruptcy|net worth)\b|\b(?:religious affiliation|political affiliation|political party|sexual orientation|sex life|trade union membership|immigration status|bank account|account balance|credit card|credit score|personal debt|financial hardship)\b|糖尿病|高血压|癌症|诊断|服药|药物治疗|病史|疾病|怀孕|生育|艾滋|精神疾病|抑郁症|焦虑症|宗教信仰|政治立场|政党|性取向|性生活|民族|种族|工会会员|移民身份|国籍|银行账户|账户余额|信用卡|信用评分|薪资|工资|收入|个人债务|财务困难|破产|净资产/iu;

function preferenceKey(category:PreferenceCategory,statement:string):string{
 if(category==="interaction")return "avoid_repeating_user_requirements";
 if(category==="diagrams")return "diagram_output_format";
 if(category==="communication")return /language|中文|日文|输出语言/iu.test(statement)?"output_language":"response_style";
 if(category==="writing")return /translation|翻译/iu.test(statement)?"translation_style":"writing_style";
 if(category==="coding")return "coding_workflow";
 if(category==="workflow")return /confirm|confirmation|ask first|先问|确认/iu.test(statement)?"confirmation_boundary":"delivery_workflow";
 if(category==="food")return "dietary_restriction";
 return category+"_preference";
}

export function detectPreferenceCandidate(prompt:string):PreferenceCandidate|null{
 const statement=prompt.trim().replace(/\s+/g," ").slice(0,240);
 if(!statement||SECRET_OR_CREDENTIAL.test(statement)||SENSITIVE_PERSONAL.test(statement))return null;
 const category=CATEGORIES.find(item=>item.pattern.test(statement))?.category;
 if(!category)return null;
 const explicit=EXPLICIT.test(statement);
 const correction=CORRECTION.test(statement);
 const strong=STRONG.test(statement);
 const explicitSaveRequest=SAVE_REQUEST.test(statement);
 if(!explicit&&!strong&&!correction&&!explicitSaveRequest)return null;
 const strength:PreferenceSignalStrength=explicit||explicitSaveRequest?"explicit":correction?"repeated_correction":"strong_signal";
 const autoPersist=explicit||correction||explicitSaveRequest;
 return {
  category,key:preferenceKey(category,statement),strength,
  priority:autoPersist?"high":"normal",autoPersist,
  scopeSuggestion:PERSONAL_SCOPE.test(statement)?"personal":"workspace",
  explicitSaveRequest,statement,
 };
}

export function preferenceCandidateInstruction(candidate:PreferenceCandidate):string{
 const scope=candidate.scopeSuggestion==="personal"
  ?"The wording explicitly indicates cross-Workspace scope."
  :"Treat this as current-Workspace scope unless the user explicitly confirms cross-project reuse.";
 const persistence=candidate.autoPersist
  ?"This is an explicit durable user rule. Save it immediately as a high-priority user rule; do not ask for a second confirmation."
  :"This is a possible soft preference. Do not save it yet; ask for confirmation at a natural point before persisting it.";
 return [
  "## Preference Learning Candidate",
  "A possible durable preference was stated directly in the current user message.",
  "Category: "+candidate.category+". Key: "+candidate.key+". Signal: "+candidate.strength+". Priority: "+candidate.priority+".",
  scope,
  "Follow the statement for the current request when it applies. It remains a user-level rule and never overrides system or safety requirements.",
  persistence,
  "Personal Memory requires explicit cross-Workspace intent. Never infer cross-Workspace scope from an ordinary project preference.",
 ].join("\n");
}
