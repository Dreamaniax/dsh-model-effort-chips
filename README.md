# dsh-model-effort-chips

把 DSH 输入区那颗合并的「模型 · 思考强度」按钮拆成两枚独立控件：

- **模型 chip** — 一步切换（flash / pro，按当前会话目录列出）
- **强度 chip** — 收起态只显示档位名（`high`）；点开是一个**按档位动态变化的滑条浮层**

> 状态：v0.7.0 — 滑条可拖（松手吸附、只写一次）+ 键盘；旋钮改成 SVG 圆、波形粗细随档位增长、去掉模糊光晕层；补齐锁定/紧凑/加载空错误态与焦点回传。

## 为什么是插件而不是改 DSH

思考强度控件属于核心包 `@deepseek-ai/dsh-client-ui-model-selection`，打包在签名的
`app.asar` 里，只能读不能改。它对外的唯一扩展点是 `conversation.input.model.label`，
而那个槽官方注明「纯展示、不可交互」。

但输入区的座位是一个可接管的 single 槽：`conversation.input.model`，官方注册时没写
`priority`（= 0），同优先级撞车会抛错，**换优先级就是遮蔽**。本插件用 `priority: -1`
接管它，走的是公开面，不改 DSH 源码。

## 设计决定（已与用户确认）

| 项 | 决定 |
| --- | --- |
| 收起态 | 只有档位名（`high`），不带迷你条 |
| 档位集合 | 按模型动态读取 `reasoning.efforts`，flash 四档、别的模型五档都照实画 |
| 换模型 | 按**序号**映射（第 3 档 → 第 3 档）；目标模型档位不足时夹到最近的一档 |
| 视觉 | 全量还原参考图（渐变轨道 + 发光旋钮 + 能量随档位），但先跑通交互再上动效 |
| 滚轮 | M6 选做，不阻塞主线 |

## 数据路径（只用官方公开面）

| 用途 | 接口 |
| --- | --- |
| 读档位 / 目录 | `ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot()` |
| 写档位 | `directory.select({ provider, model, reasoningEffort })` |
| 订阅 | `store.subscribe()` + `React.useSyncExternalStore` |

插件级 `inject` 必须声明 `remote` / `remote.session`：`directoryFor()` 给新 binding
建实例时要访问它们，少了会抛 `cannot get property "remote.session" without inject`。

## 安装

`desktop` profile 被 Electron 独占，`dsh plugin` 命令行会直接拒绝，所以用脚本：

```bash
node scripts/install.mjs              # 写 link 依赖 + bundles 条目 + 建软链 + 校验
node scripts/install.mjs --dry-run    # 只看会写什么
```

装完**完全退出并重开** DSH Desktop（客户端 bundle 在启动时注入）。

## 卸载

```bash
node scripts/uninstall.mjs            # 只删链接与两条 profile 记录，留着你这份代码
```

卸载后重启，官方模型席原样回来。

## 结构

```
lib/index.js      host 半边：空实现，只为让 client 半边被 /plugins 提供
lib/client.js     浏览器半边：接管座位、渲染两枚 chip（M0 静态）
cordis.patch.yml  bundle patch：把本包插入 profile 的 plugin 名单
scripts/          install / uninstall
```

## 里程碑

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 加载链路 + 接管座位，两枚静态 chip | 已验证 |
| M1 | 读目录快照；模型 chip 可切换；档位随模型动态 | 待验收 |
| M2 | 强度浮层（素颜）：点击设档、松手写一次、失败回滚 | 待验收 |
| M2.1 | 强度 chip 补上 `⌄` 下标，读作「可调」 | 已提交 |
| M3 | 视觉还原：渐变轨道 / 发光旋钮 / 档位配色 / 能量随档位 | 待验收 |
| M3.5 | 全量动效：波形带 + 频谱 + 粒子 | 待验收 |
| M4 | 拖动吸附 + 键盘 + Esc + 外部点击关闭 | 待验收 |
| M5 | 锁定态 / 紧凑态 / 加载空错误态 / a11y | 待验收 |
| v0.7 | 轨道刻度 / 磁吸拖拽 / 粒子与频谱随档位增强 / 亮色底适配 | 待验收 |
| M6 | 回归矩阵 + 卸载验证 + README；可选滚轮 | 待开始 |

## 风险

接管依赖「single 槽 + priority 遮蔽」这一官方语义，DSH 升级可能改变它。
`lib/client.js` 因此做了 fail-open：接管抛错就退到 `conversation.input.right`，
最差是两颗按钮，绝不会两边都没有。
