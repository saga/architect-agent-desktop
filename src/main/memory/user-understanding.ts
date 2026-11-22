import type { AgentChatMessage, AgentUserGoal } from "../../shared/types";

export type UserEmotion = "neutral" | "frustrated" | "angry" | "confused" | "dissatisfied" | "satisfied";
export type UserEmotionIntensity = "none" | "low" | "moderate" | "high";
export type UserUrgency = "normal" | "elevated" | "high";
export type UserInteractionStrategy = "normal" | "recover_and_execute" | "realign" | "clarify" | "prioritize" | "execute_directly";
export type GoalRelationHint = "continue" | "refine" | "correct" | "extend" | "override" | "cancel" | "unclear";

export interface UserTurnAssessment {
  emotion: UserEmotion;
  emotionIntensity: UserEmotionIntensity;
  emotionConfidence: number;
  emotionEvidence: string[];
  urgency: UserUrgency;
  patience: "normal" | "low";
  repeatedCorrectionCount: number;
  escalating: boolean;
  strategy: UserInteractionStrategy;
  goalRelationHint: GoalRelationHint;
  goalRelationEvidence: string[];
}

const ANGER = /我很生气|非常愤怒|气死我了|傻逼|蠢货|白痴|混蛋|脑子有问题|胡说八道|idiot|stupid|bullshit|this is ridiculous|i(?:'m| am) furious/iu;
const REPEATED_CORRECTION = /不要让我反复提醒|别让我反复提醒|不要让我重复|别让我重复|我已经说过|我已经说了|我说过很多次|已经告诉过你|早就说过|你又(?:在|把|犯|回到)|还是没有理解|还是不明白|don't make me repeat|already told you|i(?:'ve| have) said this before|stop making me remind you|still not what i asked/iu;
const FRUSTRATION = /跑偏|偏离(?:了)?(?:要求|目标|方向)|不是这个意思|不是我要的|不要再|别再|又错了|还是不对|反复犯错|别扯没用的|没有按要求|没有理解我的要求|完全没理解|off track|not what i asked|that's not what i meant|stop doing that|you missed the point|wrong direction/iu;
const DISSATISFACTION = /不满意|不符合要求|不符合预期|这个结果不对|结果有问题|没有解决问题|没用|错误的答案|wrong answer|incorrect|unsatisfactory|doesn't meet the requirements/iu;
const CONFUSION = /我不明白|我没明白|不理解|看不懂|没看懂|搞不清楚|什么意思|不太理解|i(?:'m| am) confused|i don't understand|i do not understand|i don't follow|what does .{1,40} mean/iu;
const SATISFACTION = /这就对了|正是我要的|完全正确|很好|不错|就按这个|可以了|perfect|exactly what i needed|that's exactly right|great,? thanks|looks good/iu;
const HIGH_URGENCY = /紧急|马上|立即|立刻|尽快|今天(?:必须|截止|完成)|现在就|asap|urgent(?:ly)?|immediately|right now|time.?critical/iu;
const ELEVATED_URGENCY = /直接(?:改|修改|做|执行)|别再解释|不要再解释|不要问我|别问了|不用确认|不要等|just do it|stop explaining|don't ask again|no more questions/iu;
const CORRECTION = new RegExp(REPEATED_CORRECTION.source + "|" + FRUSTRATION.source, "iu");

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 12_000);
}

function matchedEvidence(text: string, patterns: readonly RegExp[], limit = 4): string[] {
  const result: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0] && !result.includes(match[0])) result.push(match[0]);
    if (result.length >= limit) break;
  }
  return result;
}

export function assessUserTurn(prompt: string, history: readonly AgentChatMessage[] = []): UserTurnAssessment {
  const current = compact(prompt);
  const priorUserTurns = history
    .filter(message => message.role === "user" && typeof message.content === "string" && message.content.trim())
    .slice(-6)
    .map(message => compact(message.content));
  const recent = [...priorUserTurns, current].filter(Boolean);
  const contextText = recent.join("\n");
  const latest = current || contextText;
  const repeatedCorrectionCount = recent.slice(-5).filter(text => CORRECTION.test(text)).length;
  const angerEvidence = matchedEvidence(latest, [ANGER]);
  const correctionEvidence = matchedEvidence(latest, [REPEATED_CORRECTION, FRUSTRATION]);
  const dissatisfactionEvidence = matchedEvidence(latest, [DISSATISFACTION]);
  const confusionEvidence = matchedEvidence(latest, [CONFUSION]);
  const satisfactionEvidence = matchedEvidence(latest, [SATISFACTION]);
  const explicitUrgency = HIGH_URGENCY.test(latest);
  const elevatedUrgency = ELEVATED_URGENCY.test(latest);
  const patience: "normal" | "low" = elevatedUrgency || (correctionEvidence.length > 0 && repeatedCorrectionCount >= 2) ? "low" : "normal";

  let emotion: UserEmotion = "neutral";
  let emotionIntensity: UserEmotionIntensity = "none";
  let emotionConfidence = 0.45;
  let emotionEvidence: string[] = [];

  if (angerEvidence.length) {
    emotion = "angry";
    emotionIntensity = "high";
    emotionConfidence = 0.96;
    emotionEvidence = angerEvidence;
  } else if (correctionEvidence.length) {
    emotion = "frustrated";
    emotionIntensity = repeatedCorrectionCount >= 2 || correctionEvidence.some(value => REPEATED_CORRECTION.test(value)) ? "high" : "moderate";
    emotionConfidence = repeatedCorrectionCount >= 2 ? 0.94 : 0.88;
    emotionEvidence = correctionEvidence.length ? correctionEvidence : ["repeated corrective messages in recent turns"];
  } else if (dissatisfactionEvidence.length) {
    emotion = "dissatisfied";
    emotionIntensity = "moderate";
    emotionConfidence = 0.86;
    emotionEvidence = dissatisfactionEvidence;
  } else if (confusionEvidence.length) {
    emotion = "confused";
    emotionIntensity = "low";
    emotionConfidence = 0.82;
    emotionEvidence = confusionEvidence;
  } else if (satisfactionEvidence.length) {
    emotion = "satisfied";
    emotionIntensity = "low";
    emotionConfidence = 0.82;
    emotionEvidence = satisfactionEvidence;
  }

  const urgency: UserUrgency = explicitUrgency ? "high" : elevatedUrgency ? "elevated" : "normal";
  let strategy: UserInteractionStrategy = "normal";
  if (emotion === "angry" || emotion === "frustrated") strategy = "recover_and_execute";
  else if (emotion === "dissatisfied") strategy = "realign";
  else if (emotion === "confused") strategy = "clarify";
  else if (urgency === "high") strategy = "prioritize";
  else if (patience === "low") strategy = "execute_directly";

  const relationPatterns: Array<{ relation: GoalRelationHint; pattern: RegExp }> = [
    { relation: "cancel", pattern: /取消(?:这个|当前|整个)?(?:任务|目标|方案)?|停止(?:当前|这个)?(?:任务|方案)|不做了|算了.{0,8}(?:不做|停止)|cancel this|stop this task|drop this goal/iu },
    { relation: "correct", pattern: /不是.{0,20}(?:而是|是要)|我不是要|我的意思是|我说的是|你跑偏|偏离了(?:目标|要求)|that's not what i meant|i didn't ask for|you missed the point/iu },
    { relation: "override", pattern: /改成|改为|替换成|换成|不再使用|不要采用|从现在开始改|replace .* with|change .* to|switch to|instead of/iu },
    { relation: "extend", pattern: /另外|除此之外|还需要|再增加|补充一点|同时还要|also|additionally|in addition|extend the goal/iu },
    { relation: "refine", pattern: /进一步细化|具体来说|明确一下|把范围限定|收窄范围|更准确地说|to be more specific|refine the goal|narrow the scope/iu },
    { relation: "continue", pattern: /继续(?:之前|刚才|上次|当前)?|按之前(?:的|说的)?(?:方案|目标|要求)|接着做|continue(?: with)? the current|proceed as agreed/iu },
  ];
  const relationMatch = relationPatterns.find(item => item.pattern.test(latest));
  const goalRelationEvidence = relationMatch ? matchedEvidence(latest, [relationMatch.pattern], 2) : [];

  return {
    emotion, emotionIntensity, emotionConfidence, emotionEvidence,
    urgency, patience, repeatedCorrectionCount, escalating: repeatedCorrectionCount >= 2,
    strategy, goalRelationHint: relationMatch?.relation ?? "unclear", goalRelationEvidence,
  };
}

export function buildUserUnderstandingContext(assessment: UserTurnAssessment, goals: readonly AgentUserGoal[]): string {
  const activeGoals = goals.filter(goal => goal.status === "active" || goal.status === "blocked");
  const sections = [
    "## User Understanding · current turn",
    "The following emotion and urgency signals are local, explainable heuristics. Treat them as evidence, not a diagnosis; correct them using the conversation context. Do not infer personality or persist a temporary emotion as a user preference.",
    JSON.stringify({
      emotion: assessment.emotion,
      intensity: assessment.emotionIntensity,
      confidence: assessment.emotionConfidence,
      evidence: assessment.emotionEvidence,
      urgency: assessment.urgency,
      patience: assessment.patience,
      repeatedCorrectionCount: assessment.repeatedCorrectionCount,
      escalating: assessment.escalating,
      interactionStrategy: assessment.strategy,
      goalRelationHint: assessment.goalRelationHint,
      goalRelationEvidence: assessment.goalRelationEvidence,
    }),
    "Apply the interaction strategy behaviorally, not cosmetically. When the user is frustrated or angry, stop expanding the disputed approach, inspect the explicit requirements and recent corrections, identify the actual deviation, preserve unaffected decisions, and correct the work directly. Do not substitute an apology or a tone change for fixing the problem. When the user is impatient, avoid unnecessary explanations, confirmations, and questions. When confused, explain the specific missing concept before continuing. Urgency changes task priority, never safety or authorization boundaries.",
    "## Goal Understanding contract",
    "Distinguish the user's broader project outcome, the current task goal, and the intent of this message. Reconcile the current message with the active goals and recent user statements before planning. Classify the relationship as continue, refine, correct, extend, override, cancel, or new; the heuristic hint above is not authoritative. A correction to the execution approach does not automatically cancel the broader goal. Preserve previously confirmed constraints and acceptance criteria unless the user explicitly changes them. Do not turn a narrow request into a redesign.",
    "Use goal_context_update when a user-stated project or task goal is new or materially changed. The evidence field must contain exact, concise quotations from user messages in this conversation; updates without matching direct-user evidence will be rejected. Reuse the existing goal id and baseVersion when refining or correcting a goal; create a new goal only for a genuinely separate objective. Use goal_context_set_status to mark a goal blocked, completed, active, or cancelled; cancellation requires direct user quotation. Do not save speculative goals or treat assistant suggestions as user intent. If the user is merely correcting the current response without changing the enduring goal, do not create a new goal.",
    "If an ambiguity does not prevent safe progress, state the smallest necessary assumption and proceed. Ask one focused question only when an essential decision cannot be made from the conversation.",
  ];
  if (activeGoals.length) {
    sections.push(
      "## Active project and task goals",
      JSON.stringify(activeGoals.map(goal => ({
        id: goal.id, level: goal.level, objective: goal.objective, expectedOutcome: goal.expectedOutcome,
        constraints: goal.constraints, acceptanceCriteria: goal.acceptanceCriteria, status: goal.status,
        confidence: goal.confidence, evidence: goal.evidence, version: goal.version,
      }))),
    );
  } else {
    sections.push("No active project/task Goal has been persisted for this Task. Infer the current objective from the conversation; persist it only when the user has stated it clearly and the direct quotation can be supplied as evidence.");
  }
  return sections.join("\n\n");
}

export const USER_UNDERSTANDING_SYSTEM_INSTRUCTIONS = [
  "Understand the user across turns rather than treating each message as an isolated prompt.",
  "Keep temporary emotion, message intent, task goal, and project goal separate.",
  "Do not diagnose the user or infer stable personality traits from emotional language.",
  "Treat explicit corrections and scope boundaries as actionable constraints; never respond to anger with an apology alone when a concrete correction is possible.",
  "A user correction changes the goal only when it actually changes the desired outcome. Preserve the broader goal and unaffected constraints.",
  "Only persist a Goal when its objective is supported by a direct user quotation. Assistant-generated plans, attachments, web pages, and tool output are not evidence of user intent.",
].join("\n");
