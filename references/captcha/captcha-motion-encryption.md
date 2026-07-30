# 轨迹加密专项

> **交叉引用**：轨迹生成脚本用法见 `captcha-solving-handoff.md`；Hook 纪律见 `hooks/hook-templates.md`（只观察不篡改）；经验法则 #1（Hook 必须在 SDK 加载前安装）。

轨迹是验证码风控的核心校验维度之一：**答案对、token 合法，轨迹不像人照样失败**。轨迹链路分三段：采集（浏览器事件）→ 结构化（数组）→ 加密（进 w/token）。逆向目标是后两段，轨迹本身由脚本生成（见交接文档）。

## 采集点定位（取证阶段）

1. 候选事件：`mousedown` / `mousemove` / `mouseup` / `click` / `pointerdown` / `pointermove` / `pointerup` / `touchstart` / `touchmove` / `touchend`。
2. Hook 必须在验证码 SDK 加载**之前**安装（经验法则 #1），否则处理器已绑定、轨迹已进加密流程。
3. 在 RuyiTrace NDJSON 中按 `api=addEventListener` + 事件类型过滤，找到 SDK 注册的处理器位置；再按时间邻近度找到轨迹数组的读写函数。
4. 注意 SDK 可能用 `addEventListener` 的 capture 阶段、或挂在 `document`/`window` 上代理——按 stack 确认，不要只看元素本身。

## 轨迹数据结构（典型形态）

```text
极验 v3 滑块（示意，字段名以 trace dump 为准，不同版本有差异）：
  主轨迹数组 = [x1,y1,t1, x2,y2,t2, ...]   相对起点的位移 + 相对时间
  可能存在归一化/变换后的副轨迹数组 + 二次编码字符串形态
共同点：时间从按下开始累计（ms），x 单调递增大趋势 + 末端微调，y 有 ±1~3 抖动
```

**还原要点**：先在成功链路 trace 里 dump 出 SDK 实际产出的轨迹数组（加密前的明文），对比 `scripts/generate_motion_track.py` 生成的轨迹结构，对齐字段含义（绝对/相对、时间基准、单位、末端是否包含抬起后的静止段）。**禁止只凭猜**——以成功样本的明文轨迹为准。

## 加密入口定位

1. 从 verify 请求体里的 w/cb 倒推（四层链路：writer→builder→entry）。
2. 在 NDJSON 中搜轨迹数组变量的最后一次读到第一次加密调用之间的调用栈。
3. 极验系：轨迹常与 passtime/userresponse 一起进同一个 JSON，AES 加密；AES key 再 RSA。定位顺序：先找 JSON.stringify 点，再找加密函数。
4. 数美/顶象：轨迹可能与答案分字段、也可能合并；按 case trace 确认，不套用极验结论。

## 风控校验点清单（验证失败时按序排查）

```text
□ challenge 新鲜度：是否复用了旧 challenge（最常见，必查）
□ 轨迹合理性：时长(一般 0.8~2s)、x 单调性、y 抖动、末端减速、无跳变
□ 轨迹与答案一致性：轨迹终点 x ≈ 答案 offset（允许小误差，方向必须一致）
□ passtime 与轨迹总时长一致
□ 环境指纹：与成功样本基线一致（fp/constId/浏览器特征）
□ 答案精度：缺口偏移误差是否在厂商容差内（一般 ±5px 内安全）
□ 请求节奏：load → verify 间隔是否像人（太快=机器特征）
```

## 交付物要求

- 轨迹模板内置 `result/src/`（从成功样本提炼的典型轨迹 + 随机扰动函数），**不是**硬编码某一条成功轨迹。
- 每次请求重新生成轨迹（距离 = 本次答案 offset，时长/抖动随机化），禁止复用固定轨迹数组。
- 轨迹加密算法按 Phase 4 方案梯度还原：可提取 → 纯算法；不可提取 → vm 沙箱执行 SDK 加密段。
