import { describe, expect, it } from "vitest";
import { assessUserTurn } from "../src/main/memory/user-understanding";
import type { AgentChatMessage } from "../src/shared/types";

describe("User understanding", () => {
  it("detects explicit frustration and asks the agent to recover the work rather than just apologize", () => {
    const result = assessUserTurn("你跑偏了，我不是要重新设计整个系统，我希望修正当前实现。");
    expect(result).toMatchObject({
      emotion: "frustrated",
      emotionIntensity: "moderate",
      strategy: "recover_and_execute",
      goalRelationHint: "correct",
    });
    expect(result.emotionEvidence.length).toBeGreaterThan(0);
  });

  it("detects explicit anger without treating it as a durable user preference", () => {
    const result = assessUserTurn("This is ridiculous. I am furious that the same mistake happened again.");
    expect(result).toMatchObject({ emotion: "angry", emotionIntensity: "high", strategy: "recover_and_execute" });
  });

  it("uses recent corrective turns to raise the intensity only while the current turn is corrective", () => {
    const history: AgentChatMessage[] = [
      { role: "user", content: "不要让我反复提醒，已经说过不要重做整个架构。" },
      { role: "assistant", content: "我会重新设计整个架构。" },
      { role: "user", content: "我已经说过很多次，不要扩大范围。" },
    ];
    const corrective = assessUserTurn("还是跑偏了，先修正当前范围。", history);
    expect(corrective).toMatchObject({ emotion: "frustrated", emotionIntensity: "high", escalating: true, patience: "low" });

    const recovered = assessUserTurn("好的，继续之前确定的方案。", history);
    expect(recovered).toMatchObject({ emotion: "neutral", escalating: false, patience: "normal", goalRelationHint: "continue" });
  });

  it("separates urgency from emotion and recommends prioritization", () => {
    const result = assessUserTurn("这个问题今天必须解决，现在就处理。");
    expect(result).toMatchObject({ emotion: "neutral", urgency: "high", strategy: "prioritize" });
  });

  it("recognizes scope extension, refinement and explicit cancellation as distinct goal relations", () => {
    expect(assessUserTurn("另外，还需要增加审计和可观测性要求。").goalRelationHint).toBe("extend");
    expect(assessUserTurn("进一步细化验收标准。").goalRelationHint).toBe("refine");
    expect(assessUserTurn("取消当前任务，不再继续这条路线。").goalRelationHint).toBe("cancel");
  });

  it("does not infer negative emotion from neutral technical corrections", () => {
    const result = assessUserTurn("请把缓存策略改成 write-through，并保留现有 API。");
    expect(result.emotion).toBe("neutral");
    expect(result.strategy).toBe("normal");
  });

  it("does not treat a straightforward scope boundary as frustration", () => {
    const result = assessUserTurn("不要再添加新功能，保持当前实现范围。");
    expect(result.emotion).toBe("neutral");
    expect(result.strategy).toBe("normal");
  });
});
