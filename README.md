# TravelMap

TravelMap 是一个基于 React + Vite 的旅行地图 PWA，用于收藏地点、规划行程、管理旅行备忘，并支持 Supabase 云同步。

## 功能

- 高德地图地点搜索、地图展示、城市切换与路线规划
- 收藏地点并按城市分组管理
- 创建自定义行程，调整地点顺序和分段交通方式
- 旅行备忘清单与常用模板
- Supabase 邮箱验证码登录、游客模式和云端同步
- 通过后端代理接入 AI 行程规划，避免在前端暴露 AI 密钥

## 本地开发

```bash
npm install
npm run dev
```

## 环境变量

在 `.env` 中配置：

```env
VITE_AMAP_KEY=
VITE_AMAP_JSCODE=
VITE_SUPABASE_URL=
VITE_SUPABASE_KEY=
VITE_AI_PLAN_API_URL=
```

`VITE_AI_PLAN_API_URL` 应指向你自己的后端代理接口。前端会发送 `{ "prompt": "..." }`，接口可返回 `{ "content": "..." }`、`{ "text": "..." }` 或兼容 OpenAI/DeepSeek 的 `choices[0].message.content`。

## 常用脚本

```bash
npm run lint
npm run build
npm run preview
```
