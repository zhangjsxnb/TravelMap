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

`VITE_AI_PLAN_API_URL` 应指向你自己的后端代理接口（推荐由后端再去调用阿里云模型，避免前端泄露 key）。

## AI 接口契约（建议）

前端会以 `POST` JSON 请求 AI 规划接口，典型请求体：

```json
{
  "action": "plan",
  "prompt": "我想周末轻松逛1天，咖啡店+公园",
  "city": "上海",
  "places": [
    { "id": "p1", "name": "武康大楼", "category": "景点", "address": "..." }
  ],
  "currentTrip": null,
  "preferences": {
    "dayStartAt": "10:00",
    "targetStopsPerDay": 6
  }
}
```

后端返回建议优先用下面结构（最稳）：

```json
{
  "proposal": {
    "summary": "轻松路线，减少跨区移动",
    "routes": [
      { "title": "Day 1", "placeIds": ["p1", "p2", "p3"] }
    ],
    "goodieBag": [
      { "name": "某咖啡馆", "hint": "适合下午休息" }
    ]
  }
}
```

兼容返回（旧格式）也可继续工作：

- `{ "content": "..." }`
- `{ "text": "..." }`
- OpenAI 兼容：`{ "choices": [{ "message": { "content": "..." } }] }`

## 常用脚本

```bash
npm run lint
npm run build
npm run preview
```
