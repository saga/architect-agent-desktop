# Personal Intelligence 与主动协助设计

**状态：** Proposed  
**适用范围：** `architect-agent-desktop`  
**设计目标：** 在现有本地 Agent、Workspace、Memory、Trace 和 Provider 架构上，增加持续个性化、请求相关记忆召回以及事件驱动的主动协助能力。  
**设计原则：** 不新增 Agent Runtime，不把主动协助做成另一套 Schedule，不以无限扩大 Prompt 或向量数据库代替上下文判断。

---

## 1. 设计摘要

目标不是让 Agent 不停地发消息，也不是简单增加一个长期记忆开关，而是让应用在三个方面表现出连续性：

1. **记住用户明确表达的偏好、限制和工作习惯。** 用户纠正过一次或反复说明的要求，不应该在新会话中消失。
2. **在恰当的任务中自动使用记忆。** 用户询问食谱时应用饮食限制，询问架构图时应用图示偏好；无关任务不应被这些记忆干扰。
3. **理解正在发生的事情，并在合适时机提出下一步。** 识别未完成的承诺、持续阻塞、重复出现的问题和有价值的跟进事项，而不是要求用户先定义一条 Schedule。

建议增加三个协作能力：

- **Preference Learning：** 从明确表达和纠正中形成可追溯、可修正的偏好记忆。
- **Request Context Resolver：** 在每次请求时，根据当前意图召回真正相关的个人和 Workspace 记忆。
- **Proactive Opportunity Engine：** 监听 Agent 和 Workspace 事件，识别值得提示的机会，管理提醒时机、优先级和用户反馈。

这三个能力复用现有的 Memory Notes、Dreaming、SQLite、Agent Trace 和 Provider。当前 Memory 保留为长期知识来源，不再要求每次请求都把整个 Memory 列表放进上下文。

**关键产品判断：主动协助应当是事件驱动、证据驱动、可关闭、可解释的建议系统；默认建议而不擅自执行。**

## 2. 业界实现方式与设计取舍

### 2.1 Claude Code：用户规则与自动学习的双轨机制

Claude Code 将用户维护的 `CLAUDE.md` 与自动生成的 Auto Memory 分开。前者保存稳定指令、项目规范和用户明确要求；后者记录模型从纠正、偏好及工作过程中获得的经验。两者都作为上下文供模型使用，不是强制执行配置；必须保证的行为由 Hook 或权限规则承担。

Claude Code 还将规则、Skill、Hook、Subagent 和 Output Style 分开处理。适合每个请求的上下文应按需加载；固定生命周期事件则交给 Hook。其 Proactive Output Style 负责减少无谓的确认、推动常规任务继续执行，但仍不改变工具权限模式。<https://code.claude.com/docs/en/memory> <https://code.claude.com/docs/en/hooks> <https://code.claude.com/docs/en/output-styles>

对本项目的启示：

- 明确表达的长期偏好与 Agent 从交互中归纳的经验应当区分。
- 不能把所有长期知识都塞进一个 System Prompt。
- 模型提示只负责引导；真正的工具权限仍由 Main Process 和 Tool Broker 执行。
- 主动性需要有明确的工作模式和权限边界，不等于放开工具权限。

### 2.2 Claude Desktop / Cowork：项目上下文与记忆连续性

Claude Cowork 的 Project 将 Instructions、Context、Files、Memory 和 Tasks 组织在同一个持续工作区中。项目记忆可以跨项目任务复用，并能与账户层记忆结合；用户也可以选择让项目记忆保持隔离。Cowork 的多步骤任务允许用户中途介入和调整方向。<https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork> <https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork>

对本项目的启示：

- Personal Memory 与 Workspace Memory 必须保持不同作用域。
- Task 是一次工作过程，Workspace 是项目上下文；Task 结束不应丢失项目约定。
- 用户应能在运行中纠正 Agent，而不是只能等待任务完成后重新开始。
- 本项目当前已有 Workspace、Task、Expert 和 Memory Scope，不需要重新创建一套 Project/Memory 产品模型。

### 2.3 ChatGPT Memory / Dreaming：从“记住一句话”转向持续整理

OpenAI 在 2026 年发布的 Memory Dreaming 设计中，将记忆目标明确为跨会话延续上下文、遵守偏好与限制、随时间保持有效。Dreaming 从对话历史中持续整理信息，不再依赖用户每次明确说“记住这个”；同时需要处理记忆过期、冲突和相关性。官方给出的偏好示例包括饮食偏好，以及根据历史兴趣调整旅行建议。<https://openai.com/index/chatgpt-memory-dreaming/>

ChatGPT Pulse 则展示了另一类能力：基于记忆、历史交互和用户反馈，主动生成个性化的后续信息，而不是仅等待用户提出问题。<https://openai.com/index/introducing-chatgpt-pulse/>

对本项目的启示：

- 学习可以自然发生，但记忆需要保留来源、时效和用户控制。
- “记住用户偏好”与“主动提醒用户下一步”是两种能力，不能混为一个 Memory Prompt。
- 主动建议应结合目标、最近活动和实际证据，而不是简单按固定时间触发。

### 2.4 LangGraph / LangMem 与 Zep Graphiti：记忆类型与时间维度

LangChain 将长期记忆区分为 Semantic、Episodic、Procedural：用户事实与偏好、过去发生的经历、以及指导行为的程序性规则。它也区分请求执行期间的同步写入与后台整理，并指出上下文过长、过时或无关会降低模型表现。<https://docs.langchain.com/oss/python/concepts/memory>

Zep Graphiti 则强调事实的时间有效性、来源 Episode 和混合检索。新的事实可以使旧事实失效，但旧记录仍被保留，因此系统可以区分“当前是什么”与“过去曾经是什么”。<https://help.getzep.com/graphiti/getting-started/overview>

对本项目的启示：

- 不要让一个 Memory Note 同时承担用户偏好、当前任务状态、历史经历和行为程序的所有职责。
- 至少要有时间有效性、冲突关系和来源证据。
- 当前系统已有 Memory Note、Knowledge Representation、Relationship、Evidence 和 Version，不需要引入完整图数据库；先把现有模型用于可靠的个人偏好和项目上下文检索。

## 3. 当前项目审查结论

以下结论基于当前仓库中的 `README.md`、`AGENTS.md`、`docs/architecture/AGENT-ANALYTICS-DOCUMENTS-A2UI-MEMORY.md`、`docs/architecture/AGENT-TRAJECTORY-AND-CONTEXT-EXPLORER.md`、`src/main/memory/agent-memory-store.ts`、`src/main/copilot.ts`、`src/main/agent-workspace-store.ts` 和 `src/renderer/AgentPanel.tsx`。

### 3.1 已有能力，不应重复建设

当前 Memory 已经有相当完整的基础：

- Transcript、Memory Notes、Workspace Knowledge Representations 和 Injected Context 四层结构。
- Personal 与 Workspace Scope；Personal 只允许通用 `user_preference` 和 `user_intent`，项目事实不会自动跨 Workspace。
- Note 的来源证据、验证状态、版本、置顶、重要度、过期时间、替代关系及冲突关系。
- Memory Dreaming 的 prepare / commit / audit / abandon / rollback 流程，包含证据快照、版本检查和 SQLite 原子事务。
- FTS5 检索，以及可选的本地 Ollama Embedding 混合召回。
- Memory Manager 对 Note、Knowledge、证据和 Dreaming Runs 的管理。
- Agent Trace 与 Context Explorer 可检查应用可观测到的 Prompt、工具、请求和响应。
- Task、Workspace、Expert 和 Schedule 已有独立数据模型及本地持久化。

这些能力构成新设计的底座。新功能不应再建立第二套长期记忆数据库、RAG 服务或 Agent Runtime。

### 3.2 目前最影响用户体验的缺口

**缺口 A：请求时没有真正的相关性召回。**

`AgentMemoryStore.getInjectedContext()` 当前主要按置顶、重要度、验证状态、访问时间和更新时间排序，然后在固定预算内截取 Note 摘要。它不是根据当前用户问题进行匹配。

虽然 `memory.search()` 已有 FTS5 和可选语义检索，但当前主要通过模型可调用的 `memory_search` 工具触发。也就是说，模型需要先意识到自己应该搜索；对于一个明确的历史约束，这种方式不够可靠。

结果可能是：系统记得用户不希望添加糖，但生成食谱时没有主动搜索该记忆；反过来，架构问题也可能受到大量不相关偏好的干扰。

**缺口 B：用户偏好学习过于依赖显式保存请求。**

当前 System Prompt 明确要求只有用户显式要求跨项目记住时才写入 Personal Memory。这保护了隐私和作用域，但无法充分吸收自然表达的偏好与纠正，例如“以后不要再用这种图”“我不吃含糖食品”“这种报告太长，下次直接给结论”。

应该增加自动识别与用户可控的记忆候选流程，而不是取消证据策略。

**缺口 C：Copilot Session 级上下文可能陈旧。**

Copilot 的 `systemPromptContent()` 在创建 Copilot Session 时组装，其中包括 `getInjectedContext()`。Session 之后可能跨多轮请求复用；因此 Session 创建后新增或修订的 Memory 不会自然出现在下一轮的 System Prompt 中。

CodeBuddy 在每次 `sendCodeBuddy()` 时重新组装 System Prompt，行为不同。两个 Provider 的记忆可见性和更新时机因此不一致。

**缺口 D：当前主动能力主要是 Schedule，而不是机会识别。**

已有 Schedule 需要用户定义运行时间和 Prompt；Memory Dreaming 的自动周期也属于固定间隔整理。它们不负责发现“这项工作已经停滞”“用户之前提到要跟进，但一直没有完成”“刚刚发生的变化使旧计划需要更新”等机会。

**缺口 E：没有独立的主动建议生命周期。**

当前没有完整的 Proactive Opportunity / Suggestion Store，无法统一记录建议来源、优先级、有效期、展示、接受、忽略、延后和用户反馈，也无法据此控制提醒频率。

## 4. 目标架构

### 4.1 逻辑组件

| 组件 | 职责 | 复用的现有能力 |
|---|---|---|
| Preference Learning Service | 从用户表达、纠正和重复反馈中形成偏好候选 | Transcript、Evidence、Memory Dreaming |
| Memory Context Resolver | 根据当前请求检索、排序并生成相关上下文 | Memory Notes、FTS5、Ollama Embedding、Scope |
| Proactive Opportunity Engine | 从任务和运行事件中发现值得提示的下一步 | Agent Trace、Task、Workspace、现有事件生命周期 |
| Proactive Store | 保存建议、状态、来源、冷却信息及用户反馈 | 本地 SQLite |
| Personalization UI | 让用户查看、确认、纠正和关闭记忆或主动建议 | Memory Manager、AgentPanel、Pure Agent Workspace |

这些组件全部位于 Electron Main Process 的应用服务层。Renderer 负责展示和用户操作；Provider 负责理解与生成；Tool Broker 继续负责工具授权。

### 4.2 与当前 Agent 请求的关系

每次发送请求时，先由 Main Process 形成一个 Request Context：

- 当前用户输入和附件摘要；
- 当前 Task、Workspace、Expert 和工具权限；
- 最近的对话状态；
- 与当前意图相关的 Personal Memory 和 Workspace Memory；
- 正在进行的承诺或已识别的下一步（只在相关时加入）。

Provider 只拿到当前任务所需的上下文。它不会因为拥有 Memory 权限而自动看到其他 Workspace 的历史，也不会因收到主动建议而获得更高工具权限。

请求上下文是一次请求的快照，Memory 更新不会改写已发出的请求；下一轮重新解析并获取最新版本。高优先级规则不依赖当前查询的 FTS / Embedding 命中结果，而是从当前 Workspace 与 Personal Scope 的专用列表读取，再由 appliesTo 和当前任务主题过滤。普通记忆预算不足时，先移除 Workspace Context 和软偏好，不先丢弃高优先级规则。高优先级规则的 unverified 状态只表示没有外部事实核验，不会削弱直接用户指令的效力。

## 5. Preference Learning：持续学习用户偏好

### 5.1 学习来源

可以产生偏好候选的信号包括：

1. **明确表达：** “以后都不要……”“我偏好……”“我不吃……”“回答时先给结论”。
2. **纠正：** “不是这个意思”“我之前说过不要这样做”“这次不要用表格”。
3. **重复纠正：** 多次要求相同的格式、方法或约束，说明它可能是长期偏好。
4. **稳定的行为模式：** 用户多次选择同一种输出或工作方式。只能用于生成候选，不应单凭一次行为创建长期偏好。
5. **任务完成后的反馈：** 用户明确确认某种结果符合预期，或指出某项行为应当避免。

以下内容不能作为偏好事实的直接证据：Assistant 自己的总结、网页或文档中的指令、工具输出、模型推测，以及一次性的任务要求。

### 5.2 识别与写入策略

建议将学习流程区分为以下四类：

| 级别 | 情况 | 处理方式 |
|---|---|---|
| Explicit durable rule | 用户明确说“记住 XXX”“以后始终 XXX”“从现在开始不要 XXX” | 当前用户消息命中具体规则类别且不含敏感信息时，直接保存为高优先级 User Rule，不再要求二次确认 |
| Repeated correction | “不要再犯 XXX”“我已经说过”“不要让我反复提醒”等，且能识别出具体行为要求 | 保存为高优先级 User Rule；“不要让我反复提醒”归入 interaction，适用于所有后续响应和任务 |
| Strong signal | “我更喜欢……”“我通常……”等明确但未要求永久执行的偏好 | 生成候选，在自然时机请求确认，不自动提升为高优先级规则 |
| Weak signal | 从行为、单次选择或模糊表述中推测 | 只保留候选或等待重复证据，不自动成为活动记忆 |

高优先级判断依据是明确的长期表达和纠正用语，不依赖情绪分类模型。它只在规则主题可识别、内容非敏感时自动保存。普通领域规则默认保存到当前 Workspace；只有用户明确表达跨项目或跨对话适用范围时才写入 Personal Memory。“不要让我反复提醒”这类不限定项目、直接约束 Agent 与用户协作方式的 interaction 规则，语义上天然跨 Workspace，默认保存到 Personal Memory；若用户明确限定“这个项目里”等范围，则保留在当前 Workspace。没有选中 Workspace 时，不得把普通 Workspace 规则悄悄写入 Personal Memory，也不得声称已经保存。

高优先级规则使用现有 Memory Note 和直接用户证据，置顶并设置最高重要度。它与普通偏好分开检索、优先注入；Dreaming 不得改写、归档或替代它。用户仍可在 Memory Manager 中主动取消置顶并归档，或通过新的明确用户指令更新同一规则。它始终低于系统及安全约束，也允许当前请求声明一次性例外。
例如：

- “以后做食谱不要添加糖”是明确的长期约束，可保存为用户偏好。
- “今天少放点糖”是单次任务指令，不应升级成永久偏好。
- “这个报告太长了”可能只是当前任务反馈；重复出现或明确说“以后报告简短些”时才形成长期偏好。
- “不要再用 ASCII 图，架构图统一用可视化设计工具”是一条跨任务输出偏好，但只应在图示或架构文档任务中应用。

### 5.3 结构化偏好

单纯保存自然语言 Note 不足以稳定判断适用范围。建议在现有 Memory Note 上增加可选的结构化属性，不替换 Note 正文和来源证据：

```ts
type PreferenceStrength = "hard" | "soft" | "contextual";
type PreferenceOperator = "prefer" | "avoid" | "require" | "limit";

interface StructuredPreference {
  domain: string;           // food, writing, diagrams, coding, travel...
  key: string;              // added_sugar, diagram_format, verbosity...
  operator: PreferenceOperator;
  value: unknown;
  strength: PreferenceStrength;
  appliesTo: string[];      // recipe, meal_plan, architecture_doc...
  scope: "personal" | "workspace";
  validFrom?: number;
  validUntil?: number;
  sensitivity: "normal" | "sensitive";
}
```

这是对现有 `memory_notes` 的可选结构化扩展，不应为所有 Note 强制填写。结构化属性必须与原始证据、Note 版本和 Scope 一起保存。

**强约束只能来自明确表达或用户确认。** 模型不能把“我比较喜欢清淡一点”升级为绝对禁止；也不能把一次性要求扩展为所有场景都适用的偏好。

对于医疗、健康、财务等敏感领域，不从行为中自动推断长期属性。只有用户明确要求保留、且应用已告知其用途时才保存；默认只在当前会话使用。Personal Memory 应保持本地可管理，并能按 Note 单独查看、禁用和删除。

### 5.4 偏好更新与冲突

新证据不应简单覆盖旧 Note。需要判断：

- 新表达是永久改变、临时例外，还是特定任务的覆盖？
- 是否有明确的有效期？
- 是否与旧偏好冲突？
- 用户是否明确表示旧偏好不再适用？

建议沿用当前 `supersedes`、`contradicts`、版本快照和 Evidence 机制。对无法自动判断的冲突，保留两个证据并提示用户确认，而不是任意选择一个。

## 6. Request Context Resolver：按当前任务召回记忆

这是本设计中优先级最高、最直接影响回复质量的能力。

### 6.1 检索流程

每次用户发送消息时执行以下步骤：

1. **构建请求特征：** 提取任务类型、领域、实体、意图、附件类型、当前 Workspace 和当前 Task。
2. **确定作用域：** Personal Task 读取 Personal Memory；Workspace Task 只读取当前 Workspace 和允许共享的 Personal Preference；其他 Workspace 不参与检索。
3. **生成候选：** 对当前输入运行 FTS5 / 关键词检索；本地 Ollama Embedding 已启用时增加语义召回。
4. **适用性过滤：** 根据 Note 的 domain、appliesTo、Scope、validUntil 和状态过滤。
5. **冲突解析：** 处理当前输入覆盖、明确硬约束、Workspace 规则和软偏好之间的关系。
6. **预算排序：** 按相关性、约束强度、验证状态、时效性和重要度排序，只注入少量结果。
7. **生成 Request Context：** 将记忆作为带来源的上下文数据交给 Provider，并在 UI 显示本轮应用了哪些偏好。

检索不应依赖模型主动调用 `memory_search`。它是应用层请求预处理的一部分；模型仍可在需要深层历史时调用已有的 Memory 工具。

### 6.2 相关性判断

召回不能只看向量相似度。建议按以下因素综合评分：

- Scope 命中：当前 Workspace 优先于共享 Personal Memory。
- Domain / Intent 命中：当前任务类型是否在偏好的适用范围内。
- 强度：明确的 hard constraint 高于普通 soft preference。
- 证据：直接用户表达、用户确认和多次重复证据优先。
- 时效：有效期内、最近更新、未被替代的 Note 优先。
- 相关性：FTS5 和可选 Embedding 的召回分数。
- 冲突：disputed 或与当前输入冲突的 Note 不得作为无条件规则注入。

排序中不能让“高频访问”凌驾于硬约束之上。也不能因为 Note 是 validated 就无视其领域不匹配。

### 6.3 注入内容格式

建议把当前请求的上下文分为三部分：

- **High-priority User Rules：** 明确要求记住或因重复纠正而形成的长期规则。独立于普通语义检索读取，匹配适用范围后优先注入。
- **Always-on Profile：** 极少量跨任务通用软偏好，例如输出语言、默认简洁程度。
- **Relevant Preferences：** 当前任务真正适用的普通偏好和限制。
- **Relevant Workspace Context：** 当前项目的事实、约定、决策和未完成事项。

例如用户询问食谱时：

```text
[Relevant user context — evidence-backed preferences]
- Food / recipe: avoid added sugar.
  Strength: hard preference. Applies to recipes and meal plans.
  Source: confirmed user preference, Memory Note <id>.

[Instruction]
Use this context only when applicable to the current task.
If the user's current request clearly asks for an exception, acknowledge the conflict
and follow the explicit current intent when safe.
```

用户询问系统架构时，不应注入饮食偏好；但架构图输出偏好、代码风格和项目约定应进入上下文。

如果当前请求与强约束冲突，Agent 应先明确指出已有要求，并区分“本次例外”与“永久修改偏好”。不能默默忽略，也不能在用户明确要求临时例外时死板拒绝。

### 6.4 双 Provider 一致性

请求时注入是应用职责，不应依赖 SDK 是否支持动态修改 System Prompt。

- **Copilot：** 在每次 `sendCopilot()` 前运行 Resolver，将当前请求的相关记忆作为本轮请求上下文传入。不要只依赖 `ensureCopilotSession()` 创建 Session 时注入的 Memory。
- **CodeBuddy：** 在每次 `sendCodeBuddy()` 组装 Prompt 时使用相同的 Resolver 输出。避免两种 Provider 一种使用旧 Session Memory，另一种使用最新 Memory。
- **无工具权限模式：** 仍可使用已授权的 Memory Context；读取记忆不应要求模型拥有 Memory Tools 权限。Resolver 在 Main Process 执行，不需要把 `memory_search` 暴露给模型。
- **Trace：** 每次 Provider Request 记录所选 Memory ID、版本、Scope、相关性分数和过滤原因。不要把未命中的全部个人记忆写进 Provider Context。

这能解决当前 Copilot Session Memory 可能陈旧的问题，同时避免每轮把整个 Profile 重复发送给模型。

## 7. Proactive Opportunity Engine：不依赖用户定义 Schedule 的主动协助

### 7.1 产品定位

Proactive Opportunity Engine 不是一个后台聊天机器人，也不是另一套 Schedule。它监听桌面 Agent 已经发生的事件，识别值得提醒的事项，经过过滤后放入建议队列。

**Schedule 负责“用户要求什么时候执行一个确定任务”；Opportunity Engine 负责“系统发现当前有一件值得用户注意的事”。**

两者保留独立的数据和生命周期。现有 Schedule 不需要重构。

### 7.2 事件来源

首批事件来自应用自身，不需要增加云端服务或常驻网络连接：

| 事件 | 可能产生的机会 |
|---|---|
| `turn.completed` | 发现用户提到的下一步尚未处理，或当前工作有明显后续 |
| `tool.failed` / 重复失败 | 识别反复出现的问题，建议记录为经验或采用已验证方案 |
| Task 创建、切换、完成、长时间停滞 | 提示未完成事项、缺少的输入或可继续的任务 |
| Memory Preference Candidate | 提醒用户确认一条可能长期有用的偏好 |
| Workspace 文件变化 | 当文件变化与当前项目的活动目标相关时，建议重新检查结果 |
| Session 恢复 / App 激活 | 汇总尚未处理且仍有效的机会 |
| 用户明确提到的时间承诺 | 建立带有效期的 Follow-up，接近约定时间时提示 |

事件只携带必要的 ID、Scope、时间、事件类型和脱敏摘要。完整 Transcript 仍留在本地原有存储中。

### 7.3 处理流程

Opportunity Engine 的工作顺序：

1. **Event Intake：** 接收 Trace、Task、Workspace 和 Memory 的领域事件。
2. **Deterministic Detection：** 用确定性条件筛选出可能有价值的事件。例如 Task 状态为 blocked、用户明确说“明天跟进”、同一工具连续失败。
3. **Candidate Generation：** 将事件关联到已存在的 Task、Memory、Evidence 和用户目标。只有通过第一轮筛选的事件才交由模型总结或判断。
4. **Ranking：** 根据影响、紧迫度、证据质量、相关性、有效期和用户习惯排序。
5. **Deduplication / Cooldown：** 对同一事项合并重复信号，并避免短时间重复提示。
6. **Delivery：** 在当前 Agent 工作区显示建议卡片；强时效事件可使用系统通知，但默认不打断用户。
7. **Feedback：** 用户接受、忽略、延后或标记“不相关”后，更新该建议及同类建议的抑制策略。

不应让 LLM 对每一个 Trace Event 都运行一次。绝大多数事件由确定性规则过滤；模型只参与少量候选的语义归纳和建议生成。

### 7.4 主动建议的类别

第一阶段只实现有充分证据的类别：

- **Follow-up：** 用户明确承诺或提到的事情尚未完成。
- **Blocker：** 工作持续停滞或重复失败，存在明确可行的下一步。
- **Context change：** 当前项目事实或输入发生变化，可能使之前的结论需要复查。
- **Learning opportunity：** 用户反复纠正相同问题，可建议把规则整理为长期偏好或 Workspace 约定。
- **Relevant next step：** 当前任务完成后有直接关联且有明确依据的后续工作。

不要把普通聊天话题、模型随机联想或没有证据的“你可能还需要”作为主动提醒。主动建议必须说明为什么现在出现、依据是什么，以及建议用户采取什么行动。

### 7.5 不是 Schedule 的时间处理

事件驱动不代表完全不使用时钟。用户明确说“周五前完成”，系统需要保留时间条件；任务持续停滞也需要识别经过的时间。

区别在于：

- 用户不需要先创建一个每天运行的 Prompt。
- 触发条件来自真实任务状态、用户表达或事件变化。
- 定时器只负责轻量检查已存在的时间条件、过期状态和冷却窗口，不按固定周期启动 LLM 生成建议。
- 应用启动、恢复、Task 切换、Session 结束等事件都可以触发一次机会评估。
- 没有新事件、没有到期条件、没有待处理建议时，不运行模型调用。

因此，内部可以有一个轻量的本地 housekeeping timer，但产品概念不是 Schedule，也不应在 Schedule 页面要求用户设置频率。

### 7.6 建议状态模型

建议状态：

```ts
type OpportunityStatus =
  | "new"
  | "presented"
  | "accepted"
  | "snoozed"
  | "dismissed"
  | "acted"
  | "expired";

interface ProactiveOpportunity {
  id: string;
  scope: string | null;
  taskId?: string;
  category: string;
  title: string;
  explanation: string;
  suggestedAction: string;
  sourceRefs: string[];
  confidence: number;
  impact: number;
  urgency: number;
  status: OpportunityStatus;
  dedupeKey: string;
  createdAt: number;
  expiresAt?: number;
  snoozedUntil?: number;
  actedAt?: number;
}
```

这是建议生命周期，不是 Agent Tool 权限模型。Opportunity Engine 只能创建建议；工具调用仍由当前 Task 的 Permission、Expert Ceiling 和 Tool Broker 决定。

### 7.7 用户交互与提醒频率

建议在 Pure Agent Workspace 增加一个轻量的 **For You / 主动建议** 入口，不要在聊天区持续插入新消息。

一张建议卡片应包含：

- 建议事项；
- 为什么现在提示；
- 依据的 Task、Memory 或 Trace；
- 一个主要动作，例如“继续处理”“打开相关 Task”“生成草稿”；
- 次要反馈，例如“稍后提醒”“不相关”“不要再提示这一类”。

默认规则：

- 普通建议只显示在入口和任务完成后的轻提示中。
- 同一事项只保留一个活动建议。
- 用户已忽略或明确拒绝的事项不反复出现。
- 只有高影响、证据充分且确实有时间窗口的事项才允许系统通知。
- 用户可以关闭所有主动建议，也可以逐类关闭。
- 不默认代替用户发送邮件、修改文件、提交代码、发布内容或执行外部副作用。

## 8. Memory Dreaming 与主动引擎的协作

现有 Memory Dreaming 继续负责把 Transcript 整理成长期记忆，不负责决定用户现在应该做什么。

建议保留现有 prepare / commit / audit / rollback 设计，增加事件触发的整理入口：

- 用户明确表达偏好或纠正后，创建一个轻量 Memory Candidate。
- Task 完成后，将本次对话的新增 Revision 纳入待整理队列。
- 一次工作中出现多个相关事件时合并为一个 Dreaming Run。
- 应用空闲或重新激活时，可以处理积累的待整理证据。
- 只有有新证据或到期复查时才调用模型；没有新增内容则跳过。

不要求每轮对话都跑一次完整 Dreaming。可以继续保留用户已经配置的自动 Dreaming Schedule，作为可选的兜底维护机制；但偏好学习和主动建议不依赖它。

Memory Learning 和 Opportunity Engine 的责任应保持清楚：

- Learning 回答“应该长期记住什么”。
- Resolver 回答“本次请求应该使用哪些记忆”。
- Opportunity Engine 回答“现在是否有值得用户注意的下一步”。

## 9. 存储设计与接口边界

### 9.1 存储

第一阶段继续使用当前本地 SQLite，不引入 Postgres、云端 Memory Service 或新向量数据库。

建议在现有 Memory DB 增加少量数据结构：

| 表 | 用途 |
|---|---|
| `memory_candidates` | 待确认或待整理的偏好候选，保存来源、识别理由、敏感度和状态 |
| `memory_notes` 扩展字段 | 可选结构化偏好 JSON、有效期和适用范围 |
| `proactive_opportunities` | 主动建议及状态、来源、优先级、有效期 |
| `proactive_feedback` | 记录忽略、不相关、延后、接受等用户反馈及抑制策略 |

不要另建一套 User Profile 数据库。Personal Memory Note 是跨 Workspace 用户偏好事实的唯一来源；Workspace Note 是项目知识的唯一来源。候选和建议只是工作状态，不是新的事实存储。

### 9.2 服务接口

建议新增应用服务：

```ts
interface PreferenceLearningService {
  observeUserMessage(input: {
    scope: string | null;
    sessionId: string;
    messageId: string;
    content: string;
  }): Promise<void>;

  listCandidates(scope: string | null): Promise<MemoryCandidate[]>;
  confirmCandidate(id: string): Promise<void>;
  rejectCandidate(id: string): Promise<void>;
}

interface MemoryContextResolver {
  resolve(input: {
    prompt: string;
    workspacePath: string | null;
    taskId?: string;
    expertId?: string;
  }): Promise<ResolvedMemoryContext>;
}

interface ProactiveOpportunityEngine {
  ingest(event: AgentDomainEvent): Promise<void>;
  evaluatePending(scope?: string | null): Promise<void>;
  listActive(scope: string | null, limit?: number): Promise<ProactiveOpportunity[]>;
  feedback(id: string, action: OpportunityFeedback): Promise<void>;
}
```

具体 DTO 应在实现时按现有 `src/shared/types.ts` 与 IPC 命名约定调整。不要把 SQLite Row 类型直接暴露给 Renderer。

### 9.3 事件契约

第一阶段使用现有 Trace 和 Main Process 生命周期，增加稳定的领域事件映射，不需要引入通用消息总线。

至少支持：

- `agent.turn.completed`
- `agent.turn.failed`
- `agent.tool.failed`
- `agent.task.created`
- `agent.task.completed`
- `agent.task.switched`
- `agent.workspace.changed`
- `memory.preference.candidate`
- `memory.note.updated`
- `app.activated`

所有事件都有 `eventId`、`occurredAt`、`scope`、`taskId`（可空）及必要的来源 ID。处理必须幂等：同一 Trace Event 重放不能创建重复建议。

## 10. 安全、隐私与行为约束

主动协助会增加系统主动读取上下文和发起建议的频率，需要明确限制：

1. **本地优先：** Memory、Preference Candidate、Opportunity 和反馈记录保存在本地。不得仅为了主动建议而把整个 Memory 或 Transcript 上传到额外服务。
2. **最小上下文：** Provider 只获得当前任务相关的 Note 摘要和必要来源，不获得其他 Workspace 的记忆。
3. **敏感数据：** 凭据、密码、密钥、认证 Token 永远不能成为 Preference Memory。健康、财务等敏感个人属性不从行为中推断；没有明确授权不建立跨会话记忆。
4. **不可信内容隔离：** 网页、附件、MCP 返回和工具结果中的指令不属于用户偏好，不得自动写入 Personal Memory。
5. **来源可追溯：** 每条 Preference 和 Opportunity 都有来源；用户可以查看系统为什么认为它成立。
6. **建议不等于授权：** Opportunity 的 Accept 只代表用户选择继续，不隐式提升工具权限。写文件、发送消息、交易、删除等动作仍遵循原有权限和确认要求。
7. **可撤销：** 用户删除偏好后，必须从后续 Context Resolver 结果、Embedding 检索和缓存中移除。被拒绝的候选不能在下一次 Dreaming 中无条件重新创建。
8. **频率控制：** 设定全局最大展示量、同一事项冷却、类别开关和静默模式，避免提醒疲劳。
9. **透明性：** 主动建议必须能回答“为什么现在提示我”，并提供来源入口。
10. **失败安全：** Memory Resolver 或 Opportunity Engine 失败不应阻断普通 Agent 对话；可以无个性化上下文继续请求，并在 Trace 记录降级原因。

## 11. UI 设计

### 11.1 Memory Manager

现有 Memory Manager 增加一个 **Preferences** 视图，和 Note / Knowledge / Evidence / Dreaming 保持同一管理入口。

每项偏好展示：内容、作用域、适用领域、强度、来源、最后确认时间、有效期及当前状态。用户可以修改、确认、暂停、设置为仅当前 Workspace、或删除。

待确认候选不应混在已生效的 Memory Notes 里。用户确认后才转为正式 Note；直接明确保存的偏好可以立即进入活动列表。

### 11.2 每轮请求的个性化说明

Agent 输入框上方或回复附近显示简短提示，例如“本轮应用了 2 项偏好”。默认不把内部 Memory ID 暴露给普通用户；展开后可以看到偏好内容和来源。

如果偏好对答案有重要影响，回复可以自然说明“我按你之前的要求没有加入糖”。不需要每次都强调“我记得你……”，否则会显得机械。

### 11.3 主动建议入口

Pure Agent Workspace 左侧增加一个轻量入口和未读计数。建议卡片放在独立面板中，不与 Task Schedule 混合。

不建议将通知做成不断弹出的聊天气泡。对同一事项，用户处理或忽略一次后应更新原卡片，不再生成相似的新卡片。

## 12. 评估与验收标准

### 12.1 个性化检索测试集

建立一组本地固定测试样本，至少包含：

- 偏好与当前任务相关：不添加糖 → 食谱。
- 偏好与任务无关：不添加糖 → 软件架构分析。
- 格式偏好相关：避免 ASCII 图 → 架构设计。
- 同一用户多条偏好：简洁回答、必须引用来源、不要使用某种图示。
- Workspace 隔离：A Workspace 的业务定义不能出现在 B Workspace。
- Personal / Workspace 冲突：验证优先级和确认逻辑。
- 时间失效：过去的出差计划不能作为当前所在地。
- 当前请求例外：用户明确说“这次可以例外”。
- 模糊表达：单次要求不能被自动变成永久偏好。
- 负向纠正：模型不能把“不要做 X”错误保存为“偏好 X”。

验收要求：

- 明确适用的硬约束召回率达到 95% 以上。
- 无关偏好注入率低于 5%。
- 不同 Workspace 之间的项目记忆泄漏测试必须为 0。
- 记忆删除后，不允许在后续请求中继续命中已删除 Note。
- Copilot 与 CodeBuddy 对同一请求的 Resolver 结果必须一致。

以上指标是项目目标值，不是当前已达到的产品性能数据。

### 12.2 主动建议测试集

用固定 Trace / Task 事件构造场景：

- 任务明确被阻塞，存在用户已确认的下一步。
- 用户提出时间承诺，任务尚未完成。
- 同一工具连续失败，但没有明确替代方案。
- Task 已完成，没有有证据的后续事项。
- 用户已拒绝同一类建议。
- 事件重复投递或 App 重启后重新处理。
- 旧建议已经过期。
- 建议跨 Workspace 时必须被过滤。

验收要求：

- 每条建议都能追溯到至少一项来源证据。
- 无事件、无有效候选时，不产生模型调用。
- 同一事项不会因事件重放重复展示。
- 用户关闭某类别或拒绝某类建议后，抑制规则生效。
- 未经用户授权，不发生外部副作用。
- Proactive Engine 故障不影响 Agent 正常对话。

### 12.3 可观测性

Trace 应记录：

- Resolver 的输入摘要、检索候选、筛选原因和最终注入的 Note 版本；
- Preference Candidate 的来源、识别类别、接受或拒绝状态；
- Opportunity Engine 的事件、规则命中、评分、抑制和展示结果；
- Provider 是否实际收到本轮 Context；
- 降级、超时、取消和重复事件。

不要把所有候选记忆正文或所有用户历史都复制进 Trace；继续遵循现有脱敏和大小限制。

## 13. Action Plan

按依赖关系实施，先修复“有记忆却用不上”的问题，再做自动学习，最后做主动建议。不要一开始同时改 Memory、UI、Schedule 和 Provider 生命周期。

### Phase 0 — 设计合同与基线测试

**目标：** 在现有结构上定义稳定接口，避免实现过程中同时重构存储和 Agent Runtime。

工作项：

- 确认当前 Memory DB 的打开位置、IPC 注册入口及现有 Schedule 检查循环位置。
- 为 `ResolvedMemoryContext`、`StructuredPreference`、`MemoryCandidate`、`AgentDomainEvent` 和 `ProactiveOpportunity` 定义共享类型。
- 建立测试样本，先固定现有 Memory Scope、Personal 过滤及 Dreaming 行为。
- 为当前 `getInjectedContext()` 和双 Provider System Prompt 生成逻辑增加回归测试。
- 不改变当前 Provider、SDK、数据库和 UI 组件依赖。

**交付：** 类型合同、测试样本、当前行为基线。  
**退出条件：** 已能复现 Copilot Session 级上下文陈旧及请求相关性不足的问题。

### Phase 1 — Request Context Resolver（P0）

**目标：** 让已存在的偏好在正确的请求中自动生效。

工作项：

- 新增 `src/main/memory/memory-context-resolver.ts`。
- 使用当前请求文本、Workspace 和 Task 进行 FTS5 检索；有本地 Ollama Embedding 时增加语义召回。
- 增加领域及适用范围过滤、Scope 隔离、时效过滤和冲突处理。
- 把原来的大段静态 Note 摘要改为极小 Always-on Profile + 每轮 Relevant Memory。
- 在 Copilot 和 CodeBuddy 的每次发送路径中调用同一 Resolver；不要只在 Copilot Session 创建时读取 Memory。
- 将 Resolver 的结果和 Note 版本写入 Agent Trace。
- UI 显示本轮应用的偏好及其来源。

**建议修改位置：**

- `src/main/memory/agent-memory-store.ts`
- `src/main/copilot.ts`
- `src/main/agent-trace-store.ts`
- `src/renderer/AgentPanel.tsx`
- 相关共享类型与测试

**交付：** 双 Provider 一致的请求级记忆注入。  
**退出条件：** “不添加糖 → 食谱”稳定命中；“不添加糖 → 架构分析”不注入；Copilot 在同一 Session 中发生 Memory 更新后，下一轮可以使用新版本。

### Phase 2 — Preference Learning（P0）

**目标：** 用户不用每次显式说“请保存记忆”，系统也能从明确偏好和纠正中积累经验。

工作项：

- 新增 `src/main/memory/preference-learning-service.ts`。
- 从 User Transcript Revision 中识别明确偏好、永久约束和纠正。
- 使用规则快速筛选候选；只对必要候选调用模型结构化提取。
- 增加 `memory_candidates`，支持 pending / accepted / rejected / expired。
- 对活动 Note 增加可选结构化 Preference 元数据。
- 只允许直接用户证据创建 Preference Candidate；Assistant、网页、附件及工具结果不能单独形成 Personal Preference。
- 明确表达且低敏感的偏好可以按设置自动保存；模糊、冲突或敏感内容必须等待用户确认。
- 在 Memory Manager 增加候选审核、偏好编辑和暂停能力。

**交付：** 自动偏好学习与可审查的用户记忆。  
**退出条件：** 单次要求不被升级成永久偏好；重复纠正能形成候选；用户拒绝后候选不会被 Dreaming 再次无条件创建。

### Phase 3 — Proactive Opportunity Engine 基础（P1）

**目标：** 在不设置 Schedule 的情况下发现明确的后续机会。

工作项：

- 新增 `src/main/proactive/proactive-store.ts` 和 `src/main/proactive/proactive-engine.ts`。
- 从现有 Trace、Task、Workspace 和 Memory 事件生成领域事件。
- 首批实现确定性规则：未完成承诺、明确阻塞、重复工具失败、偏好候选待确认。
- 实现机会去重、Scope 过滤、有效期和冷却机制。
- 在 App 激活、Session 完成、Task 切换时评估待处理机会。
- 不对每条事件启动 LLM；只对通过确定性规则的少量候选进行可选摘要。
- 增加独立建议入口和卡片状态操作。

**交付：** 本地事件驱动的建议 Inbox。  
**退出条件：** 能从真实 Task / Trace 生成可解释建议；重复事件不产生重复卡片；用户忽略或拒绝后按规则抑制。

### Phase 4 — Ranking、反馈与主动性控制（P1）

**目标：** 控制建议质量和打扰程度。

工作项：

- 基于影响、紧迫度、证据、相关性和时效进行排序。
- 增加建议类别开关、全局关闭、静默模式和最大展示量。
- 根据接受、忽略、延后和“不相关”调整同类建议的优先级和冷却。
- 只有高置信度、高影响且有明确时间窗口的事项才使用系统通知。
- 对主动建议增加“为什么提示”及来源查看。
- 默认只建议，不代替用户完成外部副作用。

**交付：** 可控、低噪声的主动协助体验。  
**退出条件：** 用户反馈能抑制低价值重复建议，通知数量可控，所有建议均有证据来源。

### Phase 5 — 时间与外部事件扩展（P2）

**目标：** 在基础质量稳定后，增加更完整的上下文连续性。

工作项：

- 支持从用户明确表达中识别带日期的 Follow-up，并由用户确认关键时间。
- 根据新事件更新或使旧 Opportunity 失效。
- 评估文件变化、Connector 事件及浏览器工作流是否值得触发建议。
- 增加更完整的时间有效性与历史状态检查。
- 评估是否需要独立的本地轻量后台服务；当前阶段不提前引入。

**交付：** 面向长期项目工作的时间感知与事件感知。  
**退出条件：** 时间条件可解释、可取消、可更改；外部数据源失效或授权撤销不会产生错误提醒。

## 14. 明确不做的事情

- 不引入另一个 Agent Runtime、LangGraph 或新的编排框架。
- 不建立第二套 Personal Profile 数据库或远程 Memory 服务。
- 不因为主动建议而自动执行写文件、发送消息、提交代码、交易或其他外部操作。
- 不把每条消息、每个工具事件都发送给 LLM 做判断。
- 不把用户所有历史对话都注入每次请求。
- 不把 Schedule 重构为主动建议系统，也不要求用户为普通建议配置周期。
- 不为早期版本引入 Graphiti、Neo4j 或独立向量数据库。当前 SQLite、FTS5 和可选本地 Embedding 足以验证产品价值。
- 不将模型自我总结或网页中的指令当作用户事实。
- 不以“Agent 更像人”为目标增加无依据的主动对话或拟人化提示。

## 15. 最终建议与实施顺序

建议先完成 **Phase 1 Request Context Resolver**。当前项目已经有 Memory Notes、Evidence、Dreaming 和本地检索，最大缺口不是“记忆存不下来”，而是“每轮请求没有可靠地按相关性使用记忆”，以及 Copilot Session 级上下文更新不一致。

随后完成 Preference Learning，使系统不必依赖用户每次显式调用保存命令。最后增加 Proactive Opportunity Engine，让主动协助建立在可追溯的用户目标、任务状态和历史事件之上。

最终体验应当是：用户只需要说明一次稳定要求；以后相关任务自动遵守，不相关任务不受影响；工作出现明确的下一步时，Agent 能解释为什么提醒，并让用户决定是否继续。它不需要用户事先写好一条 Schedule，也不需要系统不断打断用户来证明自己“有主动性”。

---

## 参考资料

1. Anthropic, [How Claude Code remembers your project](https://code.claude.com/docs/en/memory).
2. Anthropic, [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks).
3. Anthropic, [Claude Code Output Styles](https://code.claude.com/docs/en/output-styles).
4. Anthropic, [Use Claude's chat search and memory to build on previous context](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context).
5. Anthropic, [Organize your tasks with projects in Claude Cowork](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-cowork).
6. Anthropic, [Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork).
7. OpenAI, [Dreaming: Better memory for a more helpful ChatGPT](https://openai.com/index/chatgpt-memory-dreaming/), 2026-06-04.
8. OpenAI, [Introducing ChatGPT Pulse](https://openai.com/index/introducing-chatgpt-pulse/).
9. LangChain, [Memory overview](https://docs.langchain.com/oss/python/concepts/memory).
10. Zep, [Graphiti overview](https://help.getzep.com/graphiti/getting-started/overview).

*本设计引用产品官方文档和厂商公开架构说明，提取可复用的工程模式；并不推断 Claude 或 ChatGPT 内部未公开的完整实现。*


## 16. 实施状态（2026-11-22）

设计的核心闭环已进入代码，沿用当前 Agent Runtime、Memory SQLite、Trace、Task 和 Pure Workspace，没有增加新的 Runtime、远程服务或第三方数据库。

| 阶段 | 已落地内容 | 当前边界 |
|---|---|---|
| Phase 1 · Request Context Resolver | 每轮请求分别检索 Personal Memory、当前 Workspace 和全局 Profile；使用 FTS5，可选本机 Ollama Embedding；Copilot 和 CodeBuddy 共用解析入口；只注入命中当前主题的少量记录。 | 当前采用确定性主题词与关键词评分，尚未单独展示每轮使用的 Note 清单；命中 Note ID 已写入 Trace。 |
| Phase 2 · Preference Learning | 从当前用户消息检测明确偏好、强信号和重复纠正；不把附件文本当成用户陈述；排除凭据和明显敏感个人属性；候选有确认、拒绝和过期状态。接受后创建带 direct-user evidence 的 Preference Note，初始状态为 `unverified`。 | 当前必须人工确认，不提供自动升级长期偏好的策略。结构化字段包括 domain、key、operator、value、strength、appliesTo、scope、validFrom、validUntil 和 sensitivity。 |
| Phase 3 · Proactive Opportunity Engine | 接入 Turn、Tool Failure、Task、Workspace 切换、应用激活和 Memory Candidate；增加本机 Workspace 文件变更监听；确定性检测明确日期跟进、重复工具失败和显式阻塞；事件按 ID 幂等处理。 | 当前没有外部 Connector 的推送订阅接口；只对应用自身能观察到的操作和本地文件变化作出判断。普通事件不会启动模型。 |
| Phase 4 · Ranking 与反馈 | 根据置信度、影响和紧迫度排序；支持全局启停、类别开关、每日展示上限、冷却、延后、接受、拒绝、不相关和已处理反馈；主动建议有独立 Inbox。 | 排序为确定性初始评分，未使用长期反馈训练模型；暂不发送操作系统通知。安静模式隐藏侧边栏的待处理数量提示。 |
| Phase 5 · 时间感知 | 支持 ISO 日期、英文月份日期、中文月份日期、今天/明天/后天、星期和 next-week weekday；到期前必须用户确认；确认后由 15 秒轻量本地检查转换为到期建议。 | 不解析没有确定日期的承诺；不连接外部日历。时钟检查不启动模型，也不是用户可配置的 Schedule。 |

### 16.1 数据与运行边界

Proactive Store 与 Memory Note 使用同一个 `agent-memory.sqlite` 文件，但各自使用独立表。候选、事件、Opportunity、反馈和设置不会混入 Memory Dreaming 的 Transcript 游标。已确认偏好通过现有 Memory Note 机制持久化，原始用户陈述作为直接证据保存；这不表示系统已经验证该偏好长期有效。

主动事件历史只保留最近 30 天，且总量限制为 20,000 条；清理在应用启动和每累计 100 次新事件后执行。失败检测只读取最近 30 分钟的工具事件。已结束的 Opportunity 保留一年，已拒绝或过期的 Preference Candidate 保留 180 天；抑制记录在超过一年且抑制期结束后清理。清理只删除辅助事件和已结束的工作状态，不删除 Memory Note、证据来源或 Dreaming 审计。

主动建议默认只显示在 Inbox，不会调用浏览器、Shell、MCP 或外部工具，不会发送邮件、修改文件或执行第三方操作。普通事件的处理是本地规则和 SQLite 状态更新；定时检查不会按周期启动 LLM。

Workspace 文件监听使用 Node 内置 `fs.watch`，仅监听当前 Task 的 Workspace，忽略 `.git`、`node_modules`、构建输出和覆盖率目录；事件聚合后只记录变更次数，不把文件名或文件内容送入主动建议存储。平台不支持递归监听或目录不可访问时，会记录诊断并停用该 Workspace 的文件监听，不影响正常 Agent 工作。

### 16.2 验收范围

新增回归测试覆盖请求相关性与 Scope 隔离、结构化偏好证据、敏感候选过滤、事件幂等、同工具失败阈值、用户确认前不创建提醒、到期后状态转换、反馈抑制和每日展示设置。最终通过情况以该提交对应的 GitHub Actions 为准。

仍未接入的外部事件只在未来存在明确且可信的 Connector 事件契约后添加；不能把普通 MCP 工具返回值推断为外部系统状态变化。系统通知也保持关闭，避免在用户尚未配置通知策略时主动打断。
