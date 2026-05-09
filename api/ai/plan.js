const SYSTEM_PROMPT = [
  "You are a reliable travel planning assistant.",
  "Return JSON only.",
  "Use provided places for routes.",
  "Do not invent placeIds outside the input places list.",
  "Keep routes practical and concise.",
].join(" ");

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function parseModelContent(content) {
  const text = safeString(content).trim();
  if (!text) return null;

  const firstObj = text.indexOf("{");
  const lastObj = text.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    const objText = text.slice(firstObj, lastObj + 1);
    try {
      return JSON.parse(objText);
    } catch {
      return null;
    }
  }

  const firstArr = text.indexOf("[");
  const lastArr = text.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    const arrText = text.slice(firstArr, lastArr + 1);
    try {
      const parsedArray = JSON.parse(arrText);
      return { routes: [{ title: "Day 1", placeIds: parsedArray }] };
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeProposal(rawProposal) {
  if (!rawProposal || !Array.isArray(rawProposal.routes)) return null;
  const routes = rawProposal.routes
    .map((route, index) => ({
      title: safeString(route?.title) || `Day ${index + 1}`,
      placeIds: Array.isArray(route?.placeIds) ? route.placeIds.filter((id) => typeof id === "string") : [],
    }))
    .filter((route) => route.placeIds.length > 0);

  const goodieBag = Array.isArray(rawProposal.goodieBag)
    ? rawProposal.goodieBag
        .map((item) => {
          if (typeof item === "string") return { name: item, hint: "" };
          return {
            name: safeString(item?.name),
            hint: safeString(item?.hint),
          };
        })
        .filter((item) => item.name)
        .slice(0, 5)
    : [];

  if (!routes.length) return null;

  return {
    summary: safeString(rawProposal.summary) || "已生成可执行行程提案。",
    routes,
    goodieBag,
  };
}

function validateRouteIds(proposal, placeIds) {
  const idSet = new Set(placeIds);
  const routes = proposal.routes
    .map((route) => ({
      ...route,
      placeIds: route.placeIds.filter((id) => idSet.has(id)),
    }))
    .filter((route) => route.placeIds.length > 0);

  if (!routes.length) return null;
  return { ...proposal, routes };
}

function createFallbackProposal(places) {
  const ids = places.map((place) => place.id).filter((id) => typeof id === "string").slice(0, 6);
  if (!ids.length) return null;
  return {
    summary: "按收藏顺序生成了保底路线。",
    routes: [{ title: "Day 1", placeIds: ids }],
    goodieBag: [],
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ALIYUN_API_KEY || "";
  const baseUrl = process.env.ALIYUN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = process.env.ALIYUN_MODEL || "qwen-plus";

  if (!apiKey) {
    res.status(500).json({ error: "Missing ALIYUN_API_KEY" });
    return;
  }

  const body = req.body || {};
  const prompt = safeString(body.prompt);
  const city = safeString(body.city) || "全国";
  const places = Array.isArray(body.places) ? body.places : [];
  const currentTrip = body.currentTrip || null;
  const preferences = body.preferences || {};

  const userPrompt = [
    `Action: ${safeString(body.action) || "plan"}`,
    `City: ${city}`,
    `User request: ${prompt || "Generate a practical route."}`,
    `Preferences: ${JSON.stringify(preferences)}`,
    `Current trip: ${JSON.stringify(currentTrip)}`,
    `Places: ${JSON.stringify(places)}`,
    'Output JSON schema: {"summary":"...","routes":[{"title":"Day 1","placeIds":["..."]}],"goodieBag":[{"name":"...","hint":"..."}]}',
  ].join("\n");

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: "Upstream model error", details: text });
      return;
    }

    const modelData = await response.json();
    const content = safeString(modelData?.choices?.[0]?.message?.content);
    const parsed = parseModelContent(content);
    const normalized = normalizeProposal(parsed);
    const validated = normalized ? validateRouteIds(normalized, places.map((place) => place.id)) : null;
    const fallback = createFallbackProposal(places);

    if (!validated && !fallback) {
      res.status(422).json({ error: "No executable proposal generated", content });
      return;
    }

    res.status(200).json({
      proposal: validated || fallback,
      raw: content,
    });
  } catch (error) {
    res.status(500).json({ error: "Planner route failed", details: safeString(error?.message) });
  }
}
