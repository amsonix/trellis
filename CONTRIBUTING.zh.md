# 为 Trellis 贡献

感谢你愿意提 issue 或 PR。

## 动手之前

- 读 [`SPEC.md`](SPEC.md)。它是协议的规范；改行为就是改规范，不只是改代码。
- 读 [`AGENTS.md`](AGENTS.md)。它规定了本仓库的工作方式。

## 一条铁律

**不能失败的规则不算规则。** `src/core/` 里每个阻断检查都必须在 `test/` 里有
负向对照：一个能让它变红的夹具。加了检查却没有测试证明它会红，PR 会被要求补上。

## 本地开发

```bash
git clone https://github.com/amsonix/trellis.git
cd trellis
npm test            # node --test，无需安装依赖
node bin/trellis.mjs --help
```

没有构建步骤，也没有运行时依赖。不要在没有书面理由的情况下新增依赖；零依赖是
这个项目的卖点之一。

## PR 检查表

- [ ] `npm test` 通过。
- [ ] 新行为有测试；新的阻断行为有负向对照。
- [ ] 公共接口变化时同步更新 `README.md` 与 `SPEC.md`。
- [ ] 用户可见的变化更新 `CHANGELOG.md`。
- [ ] 不手改 `.trellis/` 下的账本；用命令。

## 提交信息

短、祈使句、带前缀：`feat:`、`fix:`、`test:`、`docs:`、`refactor:`、`chore:`。

## 许可证

提交即表示你同意以 [`LICENSE`](LICENSE) 中的 MIT 许可证授权你的贡献。
