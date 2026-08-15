# 水墨棋院 · 棋类游戏合集

水墨画风实时对战棋类合集（围棋 / 象棋 / 五子棋民间 / 五子棋国际标准），
单容器部署，端口 1010。前后端无需外网 CDN，低延迟。

## 部署

方式一：Docker Compose

```bash
cd 项目目录
docker compose up -d --build
```

方式二：Docker 命令

```bash
docker build -t ink-chess .
docker run -d --name ink-chess-hall -p 1010:1010 --restart unless-stopped ink-chess
```

浏览器访问：`http://服务器IP:1010`

## 玩法说明

- 大厅：单机模式 / 加入房间 / 创建房间 / 快速匹配
- 双人对局与切换棋类、悔棋、认输、和棋等均需对方同意（弹窗确认）
- 单机模式可选择 AI 难度（低 / 中 / 高 / 超难），四类棋局均有 AI 对手，可局内切换
  - 低：随机/邻近走法；中：启发式攻防评分
  - 高：吃子优先、规避送子；超难：限时迭代加深 alpha-beta 搜索（五子棋最多 4 层、象棋最多 3 层）
- 围棋为 19 路标准盘，象棋完整走法（含将军判定），五子棋民间玩法无禁手 / 国际标准黑方禁手
- 手机与电脑端自适应
- 古风五声音阶 BGM 与落子/胜负音效（Web Audio 程序化生成，无外部音频文件，低延迟）

## 技术栈

- Node.js（内置轻量 WebSocket 实现，零第三方依赖，构建无需 npm install）
- 原生前端 Canvas 手绘水墨棋盘，无第三方前端依赖
