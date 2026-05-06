import React, { useState, useEffect, useRef } from 'react';
import { 
  Map as MapIcon, List, User, Search, MapPin, Plus, Heart, 
  Navigation, Calendar, CheckCircle2, Circle, 
  ChevronRight, ArrowRight, X, Sparkles, Trash2, ClipboardList,
  Mail, KeyRound, Loader2, LogOut, AlertCircle, ChevronDown, ChevronLeft, LocateFixed,
  Star, ChevronUp, Car, Bus, Footprints, Bike, Settings, Edit2, CornerDownLeft
} from 'lucide-react';

// ==========================================
// 🌟 数据库建表 SQL (强烈建议在 Supabase SQL Editor 执行一次，确保字段完全一致不报错)
// ==========================================
/*
drop table if exists public.places;
drop table if exists public.trips;
drop table if exists public.memos;

create table public.places (
  id text primary key,
  user_id uuid references auth.users not null,
  name text,
  location jsonb,
  category text,
  address text,
  district text,
  city text,
  "savedAt" numeric
);

create table public.trips (
  id text primary key,
  user_id uuid references auth.users not null,
  name text,
  places jsonb
);

create table public.memos (
  id text primary key,
  user_id uuid references auth.users not null,
  text text,
  done boolean
);
*/

// ==========================================
// 1. API 密钥配置区 
// ==========================================
const AMAP_CONFIG = {
  key: '6a06a2de3f4cc4a4a7a21a12e85aa48f', 
  jscode: 'ec662b0cbf8e9b00dfd0642742c51808',  
};

const SUPABASE_CONFIG = {
  url: 'https://ncbzklntlyiqvpmezpnk.supabase.co', // 👉 必填：请填入您的 Supabase URL
  key: 'sb_publishable_OsNM8K_bgwUQhGosWMrCfA_Lt4k93DL', // 👉 必填：请填入您的 Supabase anon key
};

const DEEPSEEK_API_KEY = 'sk-184f5a31a8e841a5abb427a82481a763'; // 👉 必填：请填入您的 DeepSeek API 密钥 (sk-...)

const COLORS = {
  white: '#FFFFFF',
  bg: '#FCF8E7',
  light: '#DFF2FC',
  medium: '#A6D0F1',
  primary: '#95C2E2',
  textDark: '#334155',
  textLight: '#64748B'
};

const HOT_CITIES = ['北京', '上海', '广州', '深圳', '成都', '重庆', '杭州', '西安', '武汉', '长春', '长沙', '南京'];

const safeStr = (val) => {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return '';
};

// 安全解析经纬度，防止未定义的数据格式导致 Script Error
const getLngLat = (loc) => {
  if (!loc) return null;
  let lng, lat;
  if (loc.lng !== undefined && loc.lat !== undefined) {
    lng = loc.lng; lat = loc.lat;
  } else if (loc.R !== undefined && loc.Q !== undefined) {
    lng = loc.R; lat = loc.Q;
  } else if (Array.isArray(loc) && loc.length >= 2) {
    lng = loc[0]; lat = loc[1];
  }
  const numLng = Number(lng);
  const numLat = Number(lat);
  if (!isNaN(numLng) && !isNaN(numLat)) return [numLng, numLat];
  return null;
};

// ==========================================
// 地图核心组件
// ==========================================
const RealMap = ({ places = [], isRoute = false, mapStatus, mapErrorMsg, currentCity, onMarkerClick, routeModes = [] }) => {
  const containerRef = useRef(null);
  const mapInstance = useRef(null);
  const prevCityRef = useRef(currentCity);

  useEffect(() => {
    if (mapStatus === 'success' && containerRef.current && window.AMap?.Map) {
      try {
        if (!mapInstance.current) {
          mapInstance.current = new window.AMap.Map(containerRef.current, {
            zoom: 11,
            mapStyle: 'amap://styles/normal',
            isHotspot: true 
          });
          
          mapInstance.current.on('hotspotclick', (e) => {
            if (onMarkerClick) {
              onMarkerClick({
                id: e.id,
                name: e.name,
                location: e.lnglat,
                district: '',
                address: '地图标记地点',
              });
            }
          });
        }
        
        const map = mapInstance.current;
        
        if (prevCityRef.current !== currentCity) {
          if (currentCity !== '全国') {
            map.setCity(currentCity);
          }
          prevCityRef.current = currentCity;
        }

        map.clearMap();

        if (places.length === 0 && currentCity !== '全国') {
          map.setCity(currentCity);
        }

        places.forEach((p, idx) => {
          const coords = getLngLat(p.location);
          if (coords) {
             const marker = new window.AMap.Marker({
               position: coords,
               cursor: onMarkerClick ? 'pointer' : 'default',
               label: { content: String(isRoute ? idx + 1 : safeStr(p.name)), direction: 'top' },
               extData: p
             });
             if (onMarkerClick) marker.on('click', () => onMarkerClick(p));
             map.add(marker);
          }
        });

        if (isRoute && places.length >= 2) {
          const path = places.map(p => getLngLat(p.location)).filter(Boolean);

          if (path.length >= 2) {
            path.forEach((start, i) => {
              if (i === path.length - 1) return;
              const end = path[i+1];
              let searcher;
              const currentMode = routeModes[i] || 'driving';

              if (currentMode === 'walking' && window.AMap.Walking) searcher = new window.AMap.Walking({ map, hideMarkers: true });
              else if (currentMode === 'riding' && window.AMap.Riding) searcher = new window.AMap.Riding({ map, hideMarkers: true });
              else if (currentMode === 'transit' && window.AMap.Transfer) {
                const safeCity = currentCity === '全国' ? '北京' : currentCity;
                searcher = new window.AMap.Transfer({ map, hideMarkers: true, city: safeCity });
              }
              else if (currentMode === 'driving' && window.AMap.Driving) {
                searcher = new window.AMap.Driving({ map, hideMarkers: true });
              }
              
              if (searcher) {
                try { searcher.search(start, end); } catch(err) { console.error('Route error:', err); }
              }
            });
          }
        } else if (places.length > 0 && !isRoute) {
          map.setFitView();
        }
      } catch (err) {
        console.error("Map rendering error:", err);
      }
    }
  }, [places, isRoute, mapStatus, currentCity, onMarkerClick, routeModes]);

  if (mapStatus === 'loading') return <div className="w-full aspect-square bg-blue-50 rounded-3xl flex items-center justify-center text-blue-300 shadow-inner mb-6"><Loader2 className="animate-spin" /></div>;
  if (mapStatus === 'no-key') return <div className="w-full aspect-square bg-gray-50 border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center p-6 text-center shadow-inner mb-6"><MapIcon size={32} className="text-gray-300 mb-3" /><p className="text-sm font-bold text-gray-500 mb-1">尚未配置完整的地图 API</p></div>;
  if (mapStatus === 'error') return <div className="w-full aspect-square bg-red-50 border-2 border-dashed border-red-200 rounded-3xl flex flex-col items-center justify-center p-6 text-center shadow-inner mb-6"><AlertCircle size={32} className="text-red-300 mb-3" /><p className="text-sm font-bold text-red-500 mb-1">地图加载失败</p><p className="text-[10px] text-red-400">{mapErrorMsg}</p></div>;

  return (
    <div className="w-full aspect-square min-h-[300px] rounded-3xl shadow-inner mb-6 overflow-hidden relative" style={{ backgroundColor: COLORS.light }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};

// ==========================================
// 主应用逻辑
// ==========================================
export default function App() {
  const [supabase, setSupabase] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  
  const [mapStatus, setMapStatus] = useState('loading');
  const [mapErrorMsg, setMapErrorMsg] = useState('');

  const [activeTab, setActiveTab] = useState('map');
  
  const [savedPlaces, setSavedPlaces] = useState(() => {
    try {
      const local = localStorage.getItem('travel_saved_places');
      return local ? JSON.parse(local) : [];
    } catch(e) { return []; }
  });
  
  const [trips, setTrips] = useState(() => {
    try {
      const local = localStorage.getItem('travel_trips');
      return local ? JSON.parse(local) : [];
    } catch(e) { return []; }
  });
  
  const [globalMemos, setGlobalMemos] = useState(() => {
    try {
      const local = localStorage.getItem('travel_memos');
      return local ? JSON.parse(local) : [{ id: '1', text: '身份证及重要证件', done: false }];
    } catch(e) { return [{ id: '1', text: '身份证及重要证件', done: false }]; }
  });
  const [newMemoText, setNewMemoText] = useState('');
  
  const [memoTemplate, setMemoTemplate] = useState(() => {
    try {
      const local = localStorage.getItem('travel_memo_template');
      return local ? JSON.parse(local) : ['身份证', '充电宝', '纸巾', '钥匙', '耳机'];
    } catch(e) { return ['身份证', '充电宝', '纸巾', '钥匙', '耳机']; }
  });
  const [showMemoTemplateModal, setShowMemoTemplateModal] = useState(false);
  const [newTemplateItem, setNewTemplateItem] = useState('');

  const [currentCity, setCurrentCity] = useState(localStorage.getItem('lastCity') || '全国');
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [customCityInput, setCustomCityInput] = useState('');
  
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);

  // 行程重命名状态
  const [editingTripId, setEditingTripId] = useState(null);
  const [editingTripName, setEditingTripName] = useState('');

  const [editingMemoId, setEditingMemoId] = useState(null);
  const [editingMemoText, setEditingMemoText] = useState('');

  // AI 智能排期增强状态
  const [showSmartPlanModal, setShowSmartPlanModal] = useState(false);
  const [smartPlanPrompt, setSmartPlanPrompt] = useState('');
  const [isSmartPlanning, setIsSmartPlanning] = useState(false);

  const [favSearchQuery, setFavSearchQuery] = useState('');
  const [routeBuilderStart, setRouteBuilderStart] = useState(null);
  const [routeBuilderTargets, setRouteBuilderTargets] = useState([]);
  
  const [activeTripId, setActiveTripId] = useState(null);
  const [showRoutePanel, setShowRoutePanel] = useState(false);
  const [newTripModalVisible, setNewTripModalVisible] = useState(false);
  const [newTripName, setNewTripName] = useState('');
  
  // 分段交通方式配置
  const [segmentModes, setSegmentModes] = useState([]); 
  const [segmentRoutes, setSegmentRoutes] = useState([]); 
  const [isCalculatingSegments, setIsCalculatingSegments] = useState(false);

  const autoComplete = useRef(null);

  // --- 本地缓存备份 ---
  useEffect(() => { localStorage.setItem('travel_saved_places', JSON.stringify(savedPlaces)); }, [savedPlaces]);
  useEffect(() => { localStorage.setItem('travel_trips', JSON.stringify(trips)); }, [trips]);
  useEffect(() => { localStorage.setItem('travel_memos', JSON.stringify(globalMemos)); }, [globalMemos]);
  useEffect(() => { localStorage.setItem('travel_memo_template', JSON.stringify(memoTemplate)); }, [memoTemplate]);

  // --- 云端数据同步 ---
  useEffect(() => {
    if (user && !user.is_anonymous && supabase) {
      const fetchCloudData = async () => {
        try {
          const [pRes, tRes, mRes] = await Promise.all([
            supabase.from('places').select('*').eq('user_id', user.id),
            supabase.from('trips').select('*').eq('user_id', user.id),
            supabase.from('memos').select('*').eq('user_id', user.id)
          ]);
          if (pRes.data && pRes.data.length > 0) setSavedPlaces(pRes.data);
          if (tRes.data && tRes.data.length > 0) setTrips(tRes.data);
          if (mRes.data && mRes.data.length > 0) setGlobalMemos(mRes.data);
        } catch(e) { console.error('Cloud fetch error', e); }
      };
      fetchCloudData();
    }
  }, [user, supabase]);

  // 初始化加载：高德地图 & Supabase
  useEffect(() => {
    if (!AMAP_CONFIG.key || !AMAP_CONFIG.jscode) {
      setMapStatus('no-key');
    } else {
      window._AMapSecurityConfig = { securityJsCode: AMAP_CONFIG.jscode };
      if (window.AMap) {
        setMapStatus('success');
      } else if (!document.getElementById('amap-script')) {
        const mapScript = document.createElement('script');
        mapScript.id = 'amap-script';
        window._amapInitCallback = () => {
          if (window.AMap) {
             setMapStatus('success');
             if (!localStorage.getItem('lastCity')) {
               window.AMap.plugin('AMap.Geolocation', function() {
                 var geolocation = new window.AMap.Geolocation({
                     enableHighAccuracy: true, timeout: 10000, buttonPosition: 'RB'
                 });
                 geolocation.getCityInfo((status, result) => {
                     if(status === 'complete' && result.city) {
                         const c = result.city.replace('市', '');
                         setCurrentCity(c);
                         localStorage.setItem('lastCity', c);
                     }
                 });
               });
             }
          } else {
             setMapStatus('error');
             setMapErrorMsg('脚本加载成功但 AMap 对象不存在');
          }
        };
        mapScript.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_CONFIG.key}&plugin=AMap.AutoComplete,AMap.PlaceSearch,AMap.GeometryUtil,AMap.Driving,AMap.Walking,AMap.Riding,AMap.Transfer,AMap.Geolocation&callback=_amapInitCallback`;
        mapScript.async = true;
        mapScript.onerror = () => {
          setMapStatus('error');
          setMapErrorMsg('网络请求被拦截，请检查浏览器插件');
        };
        document.head.appendChild(mapScript);
      }
    }

    if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.key) {
      const initSupa = (lib) => {
        const client = lib.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
        setSupabase(client);
        client.auth.getSession().then(({ data: { session } }) => {
          setUser(session?.user ?? null);
          setAuthLoading(false);
        });
        client.auth.onAuthStateChange((_event, session) => {
          setUser(session?.user ?? null);
        });
      };

      if (window.supabase) {
        initSupa(window.supabase);
      } else if (!document.getElementById('supabase-script')) {
        const supaScript = document.createElement('script');
        supaScript.id = 'supabase-script';
        supaScript.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        supaScript.async = true;
        supaScript.onload = () => {
          if (window.supabase) initSupa(window.supabase);
          else setAuthLoading(false);
        };
        supaScript.onerror = () => setAuthLoading(false);
        document.head.appendChild(supaScript);
      }
    } else {
      setAuthLoading(false); 
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (mapStatus === 'success' && searchQuery && window.AMap?.AutoComplete) {
        const autoOptions = currentCity !== '全国' ? { city: currentCity, citylimit: true } : { city: '全国' };
        
        if (!autoComplete.current) {
           autoComplete.current = new window.AMap.AutoComplete(autoOptions);
        } else {
           autoComplete.current.setCity(currentCity !== '全国' ? currentCity : '全国');
           autoComplete.current.setCityLimit(currentCity !== '全国');
        }

        try {
          autoComplete.current.search(searchQuery, (status, result) => {
            if (status === 'complete' && result?.tips) {
              setSearchResults(result.tips.filter(item => item && item.location));
            } else {
              setSearchResults([]);
            }
          });
        } catch(e) {
          console.error('Search error', e);
          setSearchResults([]);
        }
      } else {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, mapStatus, currentCity]);

  // ==========================================
  // AI 核心调用逻辑 (DeepSeek)
  // ==========================================
  const callDeepSeek = async (prompt) => {
    if (!DEEPSEEK_API_KEY) {
      alert("请先在代码顶部配置 DEEPSEEK_API_KEY");
      return null;
    }
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3
        })
      });
      const data = await res.json();
      return data.choices[0].message.content.trim();
    } catch (e) {
      console.error("DeepSeek API Error:", e);
      alert("AI 调用失败，请检查网络或密钥");
      return null;
    }
  };

  const parseDeepSeekJSON = (text) => {
    if (!text) return null;
    let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1) {
        cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("JSON parse error:", e);
      return null;
    }
  };

  const executeSmartPlan = async () => {
    setIsSmartPlanning(true);
    const cityPlaces = savedPlaces.filter(p => p.city === currentCity);

    const routePrompt = `你是一个专业的旅行规划师。用户去：${currentCity}。特殊要求：${smartPlanPrompt || '选出最经典顺路的路线'}。
    用户收藏了以下地点(JSON)：${JSON.stringify(cityPlaces.map(p=>({id: p.id, name: p.name})))}。
    请根据用户要求，挑选合适的地点并排好顺路的游玩顺序。
    【强制要求】：绝不能输出任何文字说明，直接返回一个包含选中地点id的 JSON 数组（一维数组即可，如 ["id1", "id2"]）。`;

    const routeResult = await callDeepSeek(routePrompt);
    let parsedResult = parseDeepSeekJSON(routeResult || '');

    // 无论大模型返回什么格式，都压平为一维纯 ID 数组
    let flatIds = [];
    if (Array.isArray(parsedResult)) {
       flatIds = parsedResult.flat(Infinity);
    }
    flatIds = flatIds.filter(id => cityPlaces.some(p => p.id === id));

    if (flatIds.length === 0) {
       flatIds = cityPlaces.map(p => p.id);
    }

    // 🚀 前端强力解析：探测用户的意图，只要有数字强制物理切分！不再信任大模型的二维数组输出！
    let requestedDays = 1;
    const promptStr = smartPlanPrompt || '';
    const match = promptStr.match(/(\d+|两|二|三|四|五|六|七|八|九|十)\s*天/);
    if (match) {
        const dayMap = { '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
        requestedDays = parseInt(match[1]) || dayMap[match[1]] || 1;
    }

    const newTrips = [];
    if (requestedDays > 1) {
       // 按天数平均分段
       const chunkSize = Math.ceil(flatIds.length / requestedDays);
       for (let i = 0; i < requestedDays; i++) {
           const dayChunk = flatIds.slice(i * chunkSize, (i + 1) * chunkSize);
           if (dayChunk.length > 0) {
               newTrips.push({
                   id: 'trip_' + Date.now().toString() + '_' + i,
                   name: `${currentCity} AI定制 - Day ${i+1}`,
                   places: dayChunk
               });
           }
       }
    } else {
       newTrips.push({
           id: 'trip_' + Date.now().toString(),
           name: `${currentCity} AI定制路线`,
           places: flatIds
       });
    }

    if (newTrips.length > 0) {
       const tripsToAdd = [...newTrips].reverse(); // 保证 Day 1 在最上面
       setTrips(prev => [...tripsToAdd, ...prev]);
       
       if (user && !user.is_anonymous && supabase) {
          try {
             const cloudTrips = newTrips.map(t => ({ ...t, user_id: user.id }));
             await supabase.from('trips').upsert(cloudTrips);
          } catch(e) {}
       }
       
       setActiveTripId(newTrips[newTrips.length - 1].id); // 选中 Day 1
       setShowRoutePanel(true);
       setActiveTab('lists');
    } else {
       alert('未能成功规划路线，请确保地点充足或稍后再试。');
    }

    setShowSmartPlanModal(false);
    setSmartPlanPrompt('');
    setIsSmartPlanning(false);
  };

  const tripPlaces = showRoutePanel && activeTripId 
    ? (trips.find(t => t.id === activeTripId)?.places?.map(pid => savedPlaces.find(p => p.id === pid)).filter(Boolean) || [])
    : [];

  // 获取分段路线详情（独立计算每一段的出行方式）
  useEffect(() => {
    if (!window.AMap || tripPlaces.length < 2 || !showRoutePanel) {
      setSegmentRoutes([]);
      return;
    }
    
    let canceled = false;
    setIsCalculatingSegments(true);

    const fetchSegments = async () => {
      const results = [];
      for (let i = 0; i < tripPlaces.length - 1; i++) {
         const p1 = tripPlaces[i];
         const p2 = tripPlaces[i+1];
         const start = getLngLat(p1.location);
         const end = getLngLat(p2.location);
         
         const currentMode = segmentModes[i] || 'driving';

         if (!start || !end) {
           results.push({ distance: 0, time: 0 });
           continue;
         }

         const res = await new Promise((resolve) => {
           let searcher;
           try {
             if (currentMode === 'walking' && window.AMap.Walking) searcher = new window.AMap.Walking();
             else if (currentMode === 'riding' && window.AMap.Riding) searcher = new window.AMap.Riding();
             else if (currentMode === 'transit' && window.AMap.Transfer) {
               const safeCity = currentCity === '全国' ? '北京' : currentCity;
               searcher = new window.AMap.Transfer({ city: safeCity });
             }
             else if (window.AMap.Driving) searcher = new window.AMap.Driving();
  
             if (searcher) {
               searcher.search(start, end, (status, result) => {
                  try {
                    if (status === 'complete') {
                       let distance = 0, time = 0;
                       if (currentMode === 'transit' && result.plans && result.plans.length > 0) {
                          distance = result.plans[0].distance;
                          time = result.plans[0].time;
                       } else if (result.routes && result.routes.length > 0) {
                          distance = result.routes[0].distance;
                          time = result.routes[0].time;
                       }
                       resolve({ distance, time });
                    } else {
                       const dist = window.AMap.GeometryUtil.distance(start, end);
                       const speed = currentMode === 'walking' ? 1.2 : currentMode === 'riding' ? 4 : 10;
                       resolve({ distance: dist, time: dist / speed });
                    }
                  } catch(e) {
                    resolve({ distance: 0, time: 0 });
                  }
               });
             } else {
               resolve({ distance: 0, time: 0 });
             }
           } catch (e) {
             resolve({ distance: 0, time: 0 });
           }
         });
         results.push(res);
      }
      if (!canceled) {
        setSegmentRoutes(results);
        setIsCalculatingSegments(false);
      }
    };
    fetchSegments();
    return () => { canceled = true; };
  }, [tripPlaces.map(p=>p.id).join(','), segmentModes, currentCity, mapStatus, showRoutePanel]);

  const handleSegmentModeChange = (index, newMode) => {
    setSegmentModes(prev => {
      const next = [...prev];
      next[index] = newMode;
      return next;
    });
  };

  const setAllSegmentModes = (mode) => {
    const newModes = new Array(Math.max(0, tripPlaces.length - 1)).fill(mode);
    setSegmentModes(newModes);
  };

  // ==========================================
  // 云端同步写操作逻辑
  // ==========================================
  const handleSavePlace = async (placeData, stayOpen = false) => {
    const newPlace = {
      id: placeData.id || Date.now().toString(),
      name: safeStr(placeData.name) || '未知地点',
      location: placeData.location,
      category: safeStr(placeData.category) || '景点',
      address: safeStr(placeData.address) || '',
      district: safeStr(placeData.district) || '',
      city: currentCity === '全国' ? '默认城市' : currentCity, 
      savedAt: Date.now()
    };
    setSavedPlaces(prev => {
      const exists = prev.find(p => p.id === newPlace.id);
      return exists ? prev.map(p => p.id === newPlace.id ? newPlace : p) : [newPlace, ...prev];
    });

    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('places').upsert({ ...newPlace, user_id: user.id }); } catch(e){}
    }
    
    if (!stayOpen) {
      setSelectedPlace(null);
      exitSearch();
    }
  };

  const removePlace = async (id) => {
    setSavedPlaces(prev => prev.filter(p => p.id !== id));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('places').delete().eq('id', id); } catch(e){}
    }
  };

  const createTrip = async (newTrip) => {
    setTrips(prev => [newTrip, ...prev]);
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('trips').upsert({ ...newTrip, user_id: user.id }); } catch(e){}
    }
  };

  const removeTrip = async (id) => {
    setTrips(prev => prev.filter(t => t.id !== id));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('trips').delete().eq('id', id); } catch(e){}
    }
  };

  const startEditingTrip = (trip, e) => {
    e.stopPropagation();
    setEditingTripId(trip.id);
    setEditingTripName(trip.name);
  };

  const saveTripName = async () => {
    if (!editingTripName.trim() || !editingTripId) {
       setEditingTripId(null);
       return;
    }
    setTrips(prev => prev.map(t => t.id === editingTripId ? { ...t, name: editingTripName.trim() } : t));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('trips').update({ name: editingTripName.trim() }).eq('id', editingTripId); } catch(e){}
    }
    setEditingTripId(null);
    setEditingTripName('');
  };

  const movePlace = async (index, direction) => {
    let updatedPlaces = [];
    setTrips(prevTrips => prevTrips.map(trip => {
      if (trip.id === activeTripId) {
        const newPlaces = [...trip.places];
        if (direction === 'up' && index > 0) {
          [newPlaces[index - 1], newPlaces[index]] = [newPlaces[index], newPlaces[index - 1]];
        } else if (direction === 'down' && index < newPlaces.length - 1) {
          [newPlaces[index], newPlaces[index + 1]] = [newPlaces[index + 1], newPlaces[index]];
        }
        updatedPlaces = newPlaces;
        return { ...trip, places: newPlaces };
      }
      return trip;
    }));

    if (user && !user.is_anonymous && supabase && updatedPlaces.length > 0) {
      try { await supabase.from('trips').update({ places: updatedPlaces }).eq('id', activeTripId); } catch(e){}
    }
  };

  const handleAddMemo = async () => {
    if (newMemoText.trim()) {
      const newMemo = { id: Date.now().toString(), text: newMemoText.trim(), done: false };
      setGlobalMemos(prev => [newMemo, ...prev]);
      setNewMemoText('');
      
      if (user && !user.is_anonymous && supabase) {
        try { await supabase.from('memos').upsert({ ...newMemo, user_id: user.id }); } catch(e){}
      }
    }
  };

  const toggleMemo = async (id, currentDone) => {
    setGlobalMemos(prev => prev.map(m => m.id === id ? { ...m, done: !currentDone } : m));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('memos').update({ done: !currentDone }).eq('id', id); } catch(e){}
    }
  };

  const handleDeleteMemo = async (id) => {
    setGlobalMemos(prev => prev.filter(m => m.id !== id));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('memos').delete().eq('id', id); } catch(e){}
    }
  };

  const handleAddFromTemplate = async () => {
    const itemsToAdd = memoTemplate.filter(t => !globalMemos.some(m => m.text === t && !m.done));
    if (itemsToAdd.length === 0) return;

    const newMemos = itemsToAdd.map(text => ({
      id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9),
      text,
      done: false
    }));

    setGlobalMemos(prev => [...newMemos, ...prev]);

    if (user && !user.is_anonymous && supabase) {
      const cloudMemos = newMemos.map(m => ({ ...m, user_id: user.id }));
      try { await supabase.from('memos').insert(cloudMemos); } catch(e){}
    }
  };

  const handleClearDone = async () => {
    const idsToDelete = globalMemos.filter(m => m.done).map(m => m.id);
    if (idsToDelete.length === 0) return;

    setGlobalMemos(prev => prev.filter(m => !m.done));

    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('memos').delete().in('id', idsToDelete); } catch(e){}
    }
  };

  const startEditingMemo = (m) => {
    setEditingMemoId(m.id);
    setEditingMemoText(m.text);
  };

  const saveEditingMemo = async () => {
    if (!editingMemoText.trim() || !editingMemoId) {
       setEditingMemoId(null);
       return;
    }
    setGlobalMemos(prev => prev.map(m => m.id === editingMemoId ? { ...m, text: editingMemoText.trim() } : m));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('memos').update({ text: editingMemoText.trim() }).eq('id', editingMemoId); } catch(e){}
    }
    setEditingMemoId(null);
    setEditingMemoText('');
  };

  // ==========================================
  // Auth 及其他操作
  // ==========================================
  const handleSendOtp = async () => {
    if (!supabase) return setAuthMessage('请先在顶部配置正确的 Supabase 密钥');
    if (!email) return setAuthMessage('请输入邮箱地址');
    setAuthLoading(true); setAuthMessage('');
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) setAuthMessage(error.message);
    else { setOtpSent(true); setAuthMessage('验证码已发送至您的邮箱'); }
    setAuthLoading(false);
  };

  const handleVerifyOtp = async () => {
    setAuthLoading(true); setAuthMessage('');
    const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
    if (error) setAuthMessage('验证码错误或已过期');
    setAuthLoading(false);
  };

  const handleGuestLogin = async () => {
    if (!supabase) {
      setUser({ id: 'local-guest', is_anonymous: true, email: '本地游客' });
      return;
    }
    setAuthLoading(true); setAuthMessage('');
    const { error } = await supabase.auth.signInAnonymously();
    if (error) setAuthMessage('游客登录失败，请确保 Supabase 后台开启了 Anonymous 登录');
    setAuthLoading(false);
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null); setOtpSent(false); setEmail(''); setOtp(''); setAuthMessage('');
  };

  const exitSearch = () => {
    setIsSearching(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const selectCity = (city) => {
    setCurrentCity(city);
    localStorage.setItem('lastCity', city); 
    setShowCityPicker(false);
    setCustomCityInput('');
  };

  const getRecommendations = (place) => {
    if (!place || !window.AMap?.GeometryUtil) return [];
    const p1 = getLngLat(place.location);
    if (!p1) return [];
    
    return savedPlaces
      .filter(p => p.id !== place.id)
      .map(p => {
        const p2 = getLngLat(p.location);
        if (!p2) return { ...p, distance: Infinity };
        return { ...p, distance: window.AMap.GeometryUtil.distance(p1, p2) };
      })
      .filter(p => p.distance < 10000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
  };

  const handleSmartRoute = () => {
    const cityPlaces = savedPlaces.filter(p => p.city === currentCity);
    if (cityPlaces.length < 2) {
      alert(`${currentCity} 收藏的地点不足2个，无法规划路线，请先去发现页面多收藏几个吧！`);
      return;
    }
    setShowSmartPlanModal(true);
  };

  const filteredFavs = savedPlaces.filter(p => 
    safeStr(p.name).toLowerCase().includes(favSearchQuery.toLowerCase()) ||
    safeStr(p.address).toLowerCase().includes(favSearchQuery.toLowerCase())
  );

  const groupedFavorites = filteredFavs.reduce((acc, spot) => {
    const city = spot.city || '其他城市';
    if (!acc[city]) acc[city] = [];
    acc[city].push(spot);
    return acc;
  }, {});

  if (authLoading && !user && !email) {
    return <div className="min-h-[100dvh] flex items-center justify-center bg-[#FCF8E7]"><Loader2 className="animate-spin text-[#95C2E2]" size={32}/></div>;
  }

  if (!user) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#f0f4f8]">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-10/12 max-w-sm text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-24" style={{ background: `linear-gradient(to bottom, ${COLORS.light}, white)` }}></div>
          <MapIcon size={48} className="mx-auto mb-4 relative z-10" style={{ color: COLORS.primary }} />
          <h1 className="text-2xl font-bold mb-1 relative z-10" style={{ color: COLORS.textDark }}>TravelMap</h1>
          <p className="text-xs font-medium mb-8 relative z-10" style={{ color: COLORS.textLight }}>云端同步，开启治愈旅行</p>
          
          {authMessage && (
            <div className="mb-4 text-[11px] bg-blue-50 text-blue-600 py-2 px-3 rounded-lg border border-blue-100">
              {authMessage}
            </div>
          )}

          {!otpSent ? (
            <div className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="email" placeholder="输入真实邮箱获取验证码"
                  className="w-full pl-11 pr-4 py-3 rounded-2xl bg-gray-50 border-none outline-none text-sm focus:ring-2"
                  style={{ '--tw-ring-color': COLORS.primary }}
                  value={email} onChange={e => setEmail(e.target.value)}
                />
              </div>
              <button 
                onClick={handleSendOtp} disabled={authLoading}
                className="w-full py-3.5 rounded-2xl text-white font-bold text-sm shadow-md transition-transform active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2" 
                style={{ backgroundColor: COLORS.primary }}
              >
                {authLoading ? <Loader2 size={16} className="animate-spin" /> : '发送验证码'}
              </button>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="text" placeholder="输入邮箱收到的 6 位验证码"
                  className="w-full pl-11 pr-4 py-3 rounded-2xl bg-gray-50 border-none outline-none text-sm focus:ring-2 tracking-widest"
                  style={{ '--tw-ring-color': COLORS.primary }}
                  value={otp} onChange={e => setOtp(e.target.value)}
                />
              </div>
              <button 
                onClick={handleVerifyOtp} disabled={authLoading || otp.length < 6}
                className="w-full py-3.5 rounded-2xl text-white font-bold text-sm shadow-md transition-transform active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2" 
                style={{ backgroundColor: COLORS.primary }}
              >
                {authLoading ? <Loader2 size={16} className="animate-spin" /> : '验证并登录'}
              </button>
              <button onClick={() => setOtpSent(false)} className="text-xs text-slate-400 mt-2 hover:underline">返回修改邮箱</button>
            </div>
          )}

          <div className="mt-8 flex items-center gap-4">
            <div className="flex-1 h-px bg-slate-100"></div>
            <span className="text-[10px] text-slate-300 font-bold tracking-wider">OR</span>
            <div className="flex-1 h-px bg-slate-100"></div>
          </div>

          <button 
            onClick={handleGuestLogin} disabled={authLoading}
            className="w-full mt-6 py-3.5 rounded-2xl bg-white border border-gray-100 text-sm font-bold shadow-sm transition-transform active:scale-95 text-slate-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {authLoading ? <Loader2 size={16} className="animate-spin" /> : '游客模式免登录'}
          </button>
        </div>
      </div>
    );
  }

  const totalDist = segmentRoutes.reduce((acc, curr) => acc + (curr?.distance || 0), 0);
  const totalTime = segmentRoutes.reduce((acc, curr) => acc + (curr?.time || 0), 0);

  return (
    <div className="min-h-[100dvh] w-full flex justify-center bg-gray-100 sm:bg-[#f0f4f8]">
      <div className="w-full sm:max-w-md h-[100dvh] flex flex-col relative bg-white overflow-hidden shadow-2xl min-h-0">
        
        <div className="absolute top-0 w-full h-40" style={{ background: `linear-gradient(to bottom, ${COLORS.bg}, white)` }}></div>
        <div className="h-12 shrink-0 pt-safe z-10"></div>

        <div className="flex-1 relative z-10 flex flex-col overflow-hidden min-h-0">
          
          {/* ==================== 发现页面 ==================== */}
          {activeTab === 'map' && (
            <div className="flex-1 flex flex-col animate-in fade-in min-h-0">
              <div className="px-6 shrink-0">
                {!isSearching && <h2 className="text-2xl font-bold mb-4" style={{ color: COLORS.textDark }}>发现地点</h2>}
                
                <div className="flex items-center gap-3 mb-6">
                  {isSearching ? (
                    <button onClick={exitSearch} className="p-2 -ml-2 rounded-full hover:bg-gray-100 active:scale-95 transition-all text-slate-600 shrink-0">
                      <ChevronLeft size={24} />
                    </button>
                  ) : (
                    <div 
                      onClick={() => setShowCityPicker(true)}
                      className="flex items-center gap-1 font-bold text-slate-700 cursor-pointer shrink-0 max-w-[80px]"
                    >
                      <span className="truncate text-base">{currentCity}</span>
                      <ChevronDown size={16} />
                    </div>
                  )}

                  <div className="flex-1 relative transition-all">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      className="w-full pl-10 pr-4 py-3 rounded-full bg-white shadow-sm border border-gray-100 outline-none text-sm focus:ring-2 transition-all"
                      placeholder={mapStatus === 'success' ? "搜索地点 / 酒店 / 景点..." : "请先配置高德 API 密钥"}
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onFocus={() => setIsSearching(true)}
                      disabled={mapStatus !== 'success'}
                      style={{ '--tw-ring-color': COLORS.light }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-24 min-h-0 hide-scrollbar">
                {isSearching ? (
                  <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4">
                    {searchQuery.length === 0 ? (
                      <div className="text-center py-20 text-slate-400 text-sm flex flex-col items-center">
                        <MapIcon size={32} className="mb-2 text-slate-200" />
                        输入地点名称开始搜索
                      </div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map(p => {
                        const isSaved = savedPlaces.some(saved => saved.id === p.id);
                        return (
                          <div key={p.id} onClick={() => setSelectedPlace(p)} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex justify-between items-center active:scale-95 transition-transform cursor-pointer">
                            <div className="pr-4 overflow-hidden flex-1">
                              <h4 className="font-bold text-base text-slate-700 truncate">{safeStr(p.name)}</h4>
                              <p className="text-[11px] text-slate-400 mt-1.5 truncate flex items-center gap-1">
                                <MapPin size={10}/> {safeStr(p.district)} {safeStr(p.address)}
                              </p>
                            </div>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                if (isSaved) {
                                  removePlace(p.id);
                                } else {
                                  handleSavePlace(p, true);
                                }
                              }} 
                              className={`shrink-0 p-2 rounded-full transition-colors ${isSaved ? 'bg-yellow-50' : 'bg-gray-50 hover:bg-gray-100'}`}
                            >
                               <Star size={20} className={isSaved ? "fill-yellow-400 text-yellow-400" : "text-gray-400"} />
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-10 text-slate-400 text-sm">未找到相关地点，请尝试其他关键词</div>
                    )}
                  </div>
                ) : (
                  <div className="animate-in fade-in">
                    <RealMap 
                      places={savedPlaces.filter(p => currentCity === '全国' || p.city === currentCity)} 
                      mapStatus={mapStatus} 
                      mapErrorMsg={mapErrorMsg} 
                      currentCity={currentCity} 
                      onMarkerClick={(p) => setSelectedPlace(p)}
                    />
                    {savedPlaces.length === 0 && mapStatus === 'success' && (
                      <div className="bg-white p-4 rounded-2xl text-center text-xs text-slate-500 shadow-sm flex items-center justify-center gap-2">
                        <LocateFixed size={14}/> 尝试在上方搜索框寻找想去的地方吧
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== 收藏夹页面 ==================== */}
          {activeTab === 'favorites' && (
            <div className="h-full flex flex-col animate-in fade-in bg-[#f0f4f8] min-h-0">
               <div className="px-6 pt-5 pb-3 bg-white shadow-sm z-10 shrink-0">
                 <h2 className="text-2xl font-bold">我的收藏夹</h2>
                 <div className="relative mt-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input 
                      value={favSearchQuery}
                      onChange={e => setFavSearchQuery(e.target.value)}
                      placeholder="在收藏夹内搜索..."
                      className="w-full pl-9 pr-4 py-2.5 bg-gray-50 rounded-xl border border-transparent outline-none text-sm focus:bg-white focus:border-blue-100 focus:ring-2 transition-all"
                      style={{ '--tw-ring-color': COLORS.light }}
                    />
                 </div>
               </div>
               
               <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 pb-24 min-h-0">
                  {Object.keys(groupedFavorites).map(city => (
                    <div key={city} className="space-y-3">
                      <h3 className="font-bold text-lg text-slate-800 border-b border-gray-200 pb-1">{city}</h3>
                      <div className="grid gap-3">
                        {groupedFavorites[city].map(spot => (
                          <div 
                            key={spot.id} 
                            onClick={() => { setRouteBuilderStart(spot); setRouteBuilderTargets([]); }}
                            className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex justify-between items-center cursor-pointer active:scale-95 transition-transform"
                          >
                            <div className="flex-1 min-w-0 pr-4">
                              <p className="font-bold text-slate-700 truncate">{safeStr(spot.name)}</p>
                              <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-1">
                                <MapPin size={10} /> {safeStr(spot.address)}
                              </p>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); removePlace(spot.id); }} className="text-slate-300 hover:text-red-400 p-2 rounded-full hover:bg-red-50 transition-colors">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {savedPlaces.length === 0 && (
                    <div className="text-center py-20 text-sm text-slate-400">还没收藏过地点哦</div>
                  )}
                  {savedPlaces.length > 0 && Object.keys(groupedFavorites).length === 0 && (
                    <div className="text-center py-10 text-sm text-slate-400">未找到符合搜索条件的收藏</div>
                  )}
               </div>
            </div>
          )}

          {/* ==================== 行程页面 ==================== */}
          {activeTab === 'lists' && (
            <div className="h-full flex flex-col px-6 animate-in fade-in min-h-0">
               <div className="flex justify-between items-center py-4 shrink-0">
                  <h2 className="text-2xl font-bold">我的行程</h2>
                  <button onClick={() => setNewTripModalVisible(true)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm active:scale-95"><Plus size={20} color={COLORS.primary}/></button>
               </div>
               <div className="flex-1 overflow-y-auto pb-24 space-y-4 pt-2 min-h-0">
                  <div 
                    onClick={handleSmartRoute} 
                    className="bg-gradient-to-r from-blue-400 to-blue-600 p-5 rounded-3xl shadow-md text-white cursor-pointer active:scale-95 transition-transform"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Navigation size={20} />
                      <h3 className="font-bold text-lg">智能路线规划</h3>
                    </div>
                    <p className="text-xs text-blue-100 opacity-90">一键串联你在 {currentCity} 收藏的所有地点并生成行程</p>
                  </div>

                  <div className="h-px bg-gray-200 my-4"></div>

                  <h3 className="font-bold text-slate-600">自定义行程</h3>
                  {trips.length === 0 ? (
                    <div className="text-center py-6 text-sm text-slate-400">还没创建自定义行程，点击上方卡片或右上角加号创建吧</div>
                  ) : (
                    trips.map(trip => (
                      <div key={trip.id} onClick={() => {setActiveTripId(trip.id); setShowRoutePanel(true)}} className="bg-white p-5 rounded-3xl shadow-sm border border-gray-50 cursor-pointer active:scale-95">
                        <div className="flex justify-between items-start mb-2">
                          {editingTripId === trip.id ? (
                             <div className="flex-1 flex items-center gap-2 mr-2">
                               <input
                                 autoFocus
                                 value={editingTripName}
                                 onChange={e => setEditingTripName(e.target.value)}
                                 onBlur={saveTripName}
                                 onKeyDown={e => e.key === 'Enter' && saveTripName()}
                                 onClick={e => e.stopPropagation()}
                                 className="flex-1 font-bold text-lg border-b border-blue-200 outline-none bg-transparent pb-0.5 text-slate-800"
                               />
                               <button onClick={(e) => { e.stopPropagation(); saveTripName(); }} className="p-1.5 bg-blue-100 text-blue-600 rounded-lg active:scale-95 shrink-0"><CheckCircle2 size={16}/></button>
                             </div>
                          ) : (
                             <div className="flex-1 flex items-center gap-2 min-w-0">
                               <h3 className="font-bold text-lg truncate text-slate-800">{safeStr(trip.name)}</h3>
                               <button onClick={(e) => startEditingTrip(trip, e)} className="shrink-0 p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors" title="修改名称">
                                 <Edit2 size={14}/>
                               </button>
                             </div>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); removeTrip(trip.id); }} className="text-slate-300 hover:text-red-400 p-1 shrink-0 ml-2">
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <p className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={12}/> {trip.places?.length || 0} 个站点</p>
                      </div>
                    ))
                  )}
               </div>
            </div>
          )}

          {/* ==================== 备忘页面 ==================== */}
          {activeTab === 'memo' && (
            <div className="h-full flex flex-col animate-in fade-in bg-[#f0f4f8] min-h-0">
               <div className="px-6 py-5 bg-white shadow-sm z-10 shrink-0">
                 <h2 className="text-2xl font-bold">出行备忘录</h2>
                 <p className="text-xs mt-1 font-medium text-slate-400">记录你的通用出行装备与事项</p>
               </div>
               
               <div className="px-6 py-4 shrink-0 mt-2">
                 <div className="flex gap-2 bg-white p-2 rounded-2xl shadow-sm border border-gray-50 mb-3">
                    <input 
                      type="text" 
                      value={newMemoText}
                      onChange={e => setNewMemoText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddMemo()}
                      placeholder="添加新备忘 (如: 遮阳帽)..."
                      className="flex-1 px-3 py-2 text-sm outline-none bg-transparent"
                    />
                    <button 
                      onClick={handleAddMemo} 
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white active:scale-95 transition-transform shrink-0" 
                      style={{ backgroundColor: COLORS.primary }}
                    >
                      <Plus size={20} />
                    </button>
                 </div>

                 {/* ✨ UI重塑：融入主色调的低饱和度标签按钮 */}
                 <div className="flex items-center gap-2 pb-2 mb-1 overflow-x-auto hide-scrollbar">
                    <button onClick={handleAddFromTemplate} className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-500 rounded-full text-xs font-bold active:scale-95 transition-all shadow-sm">
                       <Sparkles size={14}/> 常用模板
                    </button>
                    <button onClick={() => setShowMemoTemplateModal(true)} className="shrink-0 flex items-center gap-1 px-3 py-2 bg-gray-50 text-slate-500 rounded-full text-xs font-medium active:scale-95 transition-all hover:bg-gray-100">
                       <Settings size={14}/> 设置
                    </button>
                    <div className="flex-1"></div>
                    <button onClick={handleClearDone} className="shrink-0 flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-red-500 rounded-full text-xs font-medium active:scale-95 transition-all hover:bg-red-50">
                       <Trash2 size={14}/> 清理完成
                    </button>
                 </div>
               </div>

               <div className="flex-1 overflow-y-auto px-6 pb-24 space-y-3 min-h-0">
                  {globalMemos.length === 0 ? (
                    <div className="text-center py-10 text-sm text-slate-400">备忘录空空如也，添加一些物品吧</div>
                  ) : (
                    globalMemos.map(m => (
                      <div key={m.id} className="bg-white p-4 rounded-2xl shadow-sm flex items-center justify-between border border-gray-50 transition-transform">
                         {editingMemoId === m.id ? (
                            <div className="flex-1 flex items-center gap-2 mr-2">
                               <input
                                 autoFocus
                                 value={editingMemoText}
                                 onChange={e => setEditingMemoText(e.target.value)}
                                 onBlur={saveEditingMemo}
                                 onKeyDown={e => e.key === 'Enter' && saveEditingMemo()}
                                 className="flex-1 px-3 py-1.5 text-sm bg-gray-50 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 border border-blue-100"
                               />
                               <button onMouseDown={(e) => { e.preventDefault(); saveEditingMemo(); }} className="p-1.5 bg-blue-100 text-blue-600 rounded-lg active:scale-95"><CornerDownLeft size={16}/></button>
                            </div>
                         ) : (
                            <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => { toggleMemo(m.id, m.done); }}>
                               {m.done ? <CheckCircle2 size={20} color={COLORS.primary}/> : <Circle size={20} color={COLORS.textLight}/>}
                               <span className={`text-sm font-medium ${m.done ? 'line-through text-slate-300' : 'text-slate-700'}`}>{safeStr(m.text)}</span>
                            </div>
                         )}
                         {editingMemoId !== m.id && (
                           <div className="flex items-center gap-1 shrink-0 ml-2">
                             <button
                               onClick={() => startEditingMemo(m)}
                               className="p-2 text-gray-300 hover:text-blue-500 active:scale-95 transition-all rounded-full hover:bg-blue-50"
                             >
                               <Edit2 size={16} />
                             </button>
                             <button 
                               onClick={() => handleDeleteMemo(m.id)} 
                               className="p-2 text-gray-300 hover:text-red-400 active:scale-95 transition-all rounded-full hover:bg-red-50"
                             >
                               <Trash2 size={16} />
                             </button>
                           </div>
                         )}
                      </div>
                    ))
                  )}
               </div>
            </div>
          )}

          {/* ==================== 我的页面 ==================== */}
          {activeTab === 'profile' && (
            <div className="h-full flex flex-col items-center justify-center animate-in fade-in px-6">
              <div className="w-20 h-20 rounded-full mb-4 shadow-md flex items-center justify-center bg-white border-4 border-white">
                 <User size={32} color={COLORS.primary} />
              </div>
              <h2 className="text-xl font-bold text-slate-800">
                {user?.is_anonymous ? '游客' : (user?.email || '旅行者')}
              </h2>
              
              <div className="mt-8 w-full bg-gray-50 rounded-3xl p-4 space-y-2 border border-gray-100">
                <div className="flex justify-between items-center p-3 bg-white rounded-2xl shadow-sm">
                   <span className="text-sm font-bold text-gray-700">地图状态</span>
                   <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${mapStatus === 'success' ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                     {mapStatus === 'success' ? '已连接' : '未连接/异常'}
                   </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-white rounded-2xl shadow-sm">
                   <span className="text-sm font-bold text-gray-700">云端账号</span>
                   <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${supabase && user && !user.is_anonymous ? 'text-blue-600 bg-blue-50' : 'text-slate-400 bg-slate-100'}`}>
                     {supabase && user && !user.is_anonymous ? '已连接 Supabase' : '未验证'}
                   </span>
                </div>
              </div>

              <button 
                onClick={handleLogout}
                className="mt-12 py-3 px-6 rounded-2xl bg-red-50 text-red-500 font-bold text-sm shadow-sm transition-transform active:scale-95 flex items-center gap-2"
              >
                <LogOut size={16} /> 退出账号 / 返回登录页
              </button>
            </div>
          )}
        </div>

        {/* ==================== 底部导航 ==================== */}
        <div className="shrink-0 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.03)] rounded-t-3xl z-30 pb-safe px-4 relative">
          <div className="flex justify-around items-center h-16">
            <button onClick={() => {setActiveTab('map'); setIsSearching(false);}} className={`flex flex-col items-center gap-1 ${activeTab==='map'?'text-[#95C2E2]':'text-slate-300'}`}>
              <MapIcon size={20} /><span className="text-[10px] font-bold">发现</span>
            </button>
            <button onClick={() => setActiveTab('favorites')} className={`flex flex-col items-center gap-1 ${activeTab==='favorites'?'text-[#95C2E2]':'text-slate-300'}`}>
              <Heart size={20} /><span className="text-[10px] font-bold">收藏</span>
            </button>
            <button onClick={() => setActiveTab('lists')} className={`flex flex-col items-center gap-1 ${activeTab==='lists'?'text-[#95C2E2]':'text-slate-300'}`}>
              <List size={20} /><span className="text-[10px] font-bold">行程</span>
            </button>
            <button onClick={() => setActiveTab('memo')} className={`flex flex-col items-center gap-1 ${activeTab==='memo'?'text-[#95C2E2]':'text-slate-300'}`}>
              <ClipboardList size={20} /><span className="text-[10px] font-bold">备忘</span>
            </button>
            <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center gap-1 ${activeTab==='profile'?'text-[#95C2E2]':'text-slate-300'}`}>
              <User size={20} /><span className="text-[10px] font-bold">我的</span>
            </button>
          </div>
        </div>

        {/* ===================== 弹窗组件群 ===================== */}
        
        {/* 城市选择 */}
        {showCityPicker && (
          <div className="fixed inset-0 z-[130] flex items-end bg-black/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full h-[80vh] rounded-t-3xl flex flex-col pb-safe animate-in slide-in-from-bottom-full min-h-0">
               <div className="px-6 py-5 flex items-center justify-between border-b border-gray-50 shrink-0">
                  <h3 className="text-xl font-bold">选择城市</h3>
                  <button onClick={() => setShowCityPicker(false)} className="p-2 bg-gray-50 rounded-full"><X size={18}/></button>
               </div>
               <div className="flex-1 overflow-y-auto p-6 min-h-0">
                 <div className="flex gap-2 mb-8">
                    <input 
                      type="text" value={customCityInput} onChange={e=>setCustomCityInput(e.target.value)}
                      placeholder="输入城市名，如：沈阳"
                      className="flex-1 px-4 py-3 rounded-xl bg-gray-50 border-none outline-none text-sm"
                    />
                    <button onClick={() => {if(customCityInput) selectCity(customCityInput)}} className="px-5 rounded-xl text-white font-bold text-sm" style={{ backgroundColor: COLORS.primary }}>确定</button>
                 </div>
                 
                 <h4 className="text-sm font-bold text-slate-400 mb-4">热门城市</h4>
                 <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => selectCity('全国')} className={`py-3 rounded-xl font-bold text-sm ${currentCity === '全国' ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-slate-600'}`}>全国</button>
                    {HOT_CITIES.map(city => (
                      <button key={city} onClick={() => selectCity(city)} className={`py-3 rounded-xl font-bold text-sm active:scale-95 transition-all ${currentCity === city ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-slate-600'}`}>
                        {city}
                      </button>
                    ))}
                 </div>
               </div>
            </div>
          </div>
        )}

        {/* 新建行程 */}
        {newTripModalVisible && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in zoom-in-95">
              <h3 className="text-lg font-bold mb-4 text-slate-800">创建新行程</h3>
              <input 
                type="text" autoFocus placeholder="例如：周末散心之旅"
                className="w-full px-4 py-3 rounded-xl bg-gray-50 border-none outline-none text-sm mb-6 focus:ring-2"
                style={{ '--tw-ring-color': COLORS.light }}
                value={newTripName} onChange={e => setNewTripName(e.target.value)}
              />
              <div className="flex gap-3">
                <button className="flex-1 py-3 rounded-xl bg-gray-100 text-sm font-bold text-slate-600 active:scale-95" onClick={() => { setNewTripModalVisible(false); setNewTripName(''); }}>取消</button>
                <button className="flex-1 py-3 rounded-xl text-white text-sm font-bold active:scale-95 disabled:opacity-50" style={{ backgroundColor: COLORS.primary }} disabled={!newTripName.trim()} onClick={() => {
                  if (newTripName.trim()) {
                    createTrip({ id: Date.now().toString(), name: newTripName.trim(), places: [] });
                    setNewTripModalVisible(false);
                    setNewTripName('');
                  }
                }}>确认创建</button>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 🔥 全新：AI 智能行程约束排期 (支持多天) */}
        {/* ==================================================== */}
        {showSmartPlanModal && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in zoom-in-95">
               <div className="flex items-center gap-2 mb-2">
                 <Sparkles size={20} className="text-blue-500" />
                 <h3 className="text-lg font-bold text-slate-800">AI 智能排期 (支持多天)</h3>
               </div>
               <p className="text-xs text-slate-400 mb-5">告诉 AI 你的特殊要求（例如：3天时间、带老人）。AI 将为你挑选顺路地点并自动生成每天的游玩顺序。</p>
               <textarea
                 autoFocus
                 rows={3}
                 placeholder="例如：我只有2天时间，带着老人，行程尽量轻松..."
                 className="w-full px-4 py-3 rounded-xl bg-gray-50 border-none outline-none text-sm mb-6 focus:ring-2 focus:ring-blue-200 resize-none"
                 value={smartPlanPrompt}
                 onChange={e => setSmartPlanPrompt(e.target.value)}
                 disabled={isSmartPlanning}
               />
               <div className="flex gap-3">
                 <button disabled={isSmartPlanning} onClick={() => setShowSmartPlanModal(false)} className="flex-1 py-3 rounded-xl bg-gray-100 text-sm font-bold text-slate-600 active:scale-95">取消</button>
                 <button disabled={isSmartPlanning} onClick={executeSmartPlan} className="flex-1 py-3 rounded-xl text-white text-sm font-bold active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2" style={{ backgroundColor: COLORS.primary }}>
                   {isSmartPlanning ? <Loader2 size={16} className="animate-spin" /> : '开始智能排期'}
                 </button>
               </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 行程路线展示弹窗：分段交通与自由排序升级 */}
        {/* ==================================================== */}
        {showRoutePanel && activeTripId && (
          <div className="fixed inset-0 z-[120] flex flex-col bg-white animate-in slide-in-from-bottom-full min-h-0">
            <div className="px-6 py-5 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur z-20 border-b border-gray-50 shrink-0">
               <div>
                 <h2 className="text-xl font-bold">行程规划与地图</h2>
               </div>
               <button onClick={() => {setShowRoutePanel(false);}} className="p-2 bg-gray-50 rounded-full"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto pb-10 min-h-0">
              <div className="p-6 pb-2 space-y-6">
                 
                 {/* 传递独立分段交通方式给地图 */}
                 <RealMap 
                   places={tripPlaces} 
                   isRoute={true} 
                   mapStatus={mapStatus} 
                   currentCity={currentCity}
                   routeModes={segmentModes} 
                 />

                 <div className="bg-gray-50 rounded-3xl p-5 border border-gray-100">
                    <div className="flex justify-between items-center mb-5">
                       <h3 className="font-bold text-slate-700 text-base">节点与交通详情</h3>
                       <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded font-bold">可调整顺序</span>
                    </div>
                    
                    <div className="flex flex-col relative">
                       {tripPlaces.map((p, i) => (
                         <React.Fragment key={p.id + i}>
                           <div className="flex gap-4 items-start z-10 relative bg-transparent">
                             <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-md relative z-10 mt-1">
                               {i + 1}
                             </div>
                             <div className="flex-1 pb-2">
                               <div className="font-bold text-sm text-slate-800">{safeStr(p.name)}</div>
                               <div className="text-[11px] text-slate-500 mt-1 flex items-start gap-1">
                                  <MapPin size={12} className="shrink-0 mt-0.5" />
                                  {safeStr(p.address) || safeStr(p.district) || '暂无详细地址'}
                               </div>
                             </div>
                             <div className="flex flex-col gap-1 shrink-0 ml-2">
                               <button disabled={i===0} onClick={() => movePlace(i, 'up')} className="p-1 text-slate-400 hover:text-blue-500 disabled:opacity-20 active:scale-90 transition-all"><ChevronUp size={16}/></button>
                               <button disabled={i===tripPlaces.length-1} onClick={() => movePlace(i, 'down')} className="p-1 text-slate-400 hover:text-blue-500 disabled:opacity-20 active:scale-90 transition-all"><ChevronDown size={16}/></button>
                             </div>
                           </div>
                           
                           {/* 分段交通方式配置区 */}
                           {i < tripPlaces.length - 1 && (
                             <div className="ml-[13px] border-l-[2px] border-dashed border-blue-200 pl-6 py-4 my-0.5 relative">
                               <div className="absolute -left-[11px] top-1/2 -translate-y-1/2 bg-white rounded-full p-1 text-blue-400 border border-blue-100 shadow-sm">
                                  {(segmentModes[i]||'driving') === 'transit' ? <Bus size={12}/> : (segmentModes[i]||'driving') === 'walking' ? <Footprints size={12}/> : (segmentModes[i]||'driving') === 'riding' ? <Bike size={12}/> : <Car size={12}/>}
                               </div>
                               {isCalculatingSegments ? (
                                 <span className="text-[10px] text-slate-400 font-medium tracking-widest animate-pulse">路线规划中...</span>
                               ) : segmentRoutes[i] ? (
                                 <div className="inline-flex items-center gap-2 bg-blue-50/80 px-2.5 py-1.5 rounded-lg border border-blue-100 text-[10px] text-blue-600 font-bold shadow-sm relative overflow-hidden transition-all hover:bg-blue-100">
                                   <select
                                     value={segmentModes[i] || 'driving'}
                                     onChange={(e) => handleSegmentModeChange(i, e.target.value)}
                                     className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                   >
                                     <option value="driving">驾车</option>
                                     <option value="transit">公交地铁</option>
                                     <option value="riding">骑行</option>
                                     <option value="walking">步行</option>
                                   </select>
                                   <span className="flex items-center gap-1">
                                     {(segmentModes[i]||'driving') === 'driving' ? '🚗 驾车' : (segmentModes[i]||'driving') === 'transit' ? '🚌 公交地铁' : (segmentModes[i]||'driving') === 'walking' ? '🚶‍♂️ 步行' : '🚴 骑行'}
                                     <ChevronDown size={10} className="opacity-50"/>
                                   </span>
                                   <span className="opacity-40">|</span> 
                                   <span>{(segmentRoutes[i].distance/1000).toFixed(1)}公里</span> 
                                   <span className="opacity-40">|</span> 
                                   <span>{Math.round(segmentRoutes[i].time/60)}分钟</span>
                                 </div>
                               ) : null}
                             </div>
                           )}
                         </React.Fragment>
                       ))}
                    </div>

                    {segmentRoutes.length > 0 && !isCalculatingSegments && (
                      <div className="mt-6 p-4 bg-white rounded-2xl shadow-sm border border-blue-50">
                         <div className="flex items-center gap-2 mb-4 overflow-x-auto hide-scrollbar pb-1">
                            <span className="text-[11px] font-bold text-slate-400 shrink-0">批量设置:</span>
                            <button onClick={() => setAllSegmentModes('driving')} className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all bg-gray-50 text-slate-500 border border-gray-100 active:scale-95">🚗 驾车</button>
                            <button onClick={() => setAllSegmentModes('transit')} className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all bg-gray-50 text-slate-500 border border-gray-100 active:scale-95">🚌 公交</button>
                            <button onClick={() => setAllSegmentModes('riding')} className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all bg-gray-50 text-slate-500 border border-gray-100 active:scale-95">🚴 骑行</button>
                            <button onClick={() => setAllSegmentModes('walking')} className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all bg-gray-50 text-slate-500 border border-gray-100 active:scale-95">🚶‍♂️ 步行</button>
                         </div>
                         <div className="flex items-center gap-2 mb-3">
                            <Navigation size={16} className="text-blue-600" />
                            <span className="font-bold text-sm text-blue-600">总计行程评估</span>
                         </div>
                         <div className="flex justify-between items-center text-slate-600 bg-gray-50 rounded-xl p-3">
                            <div>
                               <p className="text-[10px] text-slate-400 mb-0.5">总计路程</p>
                               <p className="font-black text-lg">{(totalDist / 1000).toFixed(1)} <span className="text-xs font-medium text-slate-500">公里</span></p>
                            </div>
                            <div className="h-8 w-px bg-gray-200"></div>
                            <div className="text-right">
                               <p className="text-[10px] text-slate-400 mb-0.5">预估总时长</p>
                               <p className="font-black text-lg text-blue-500">
                                  {Math.round(totalTime / 60)} <span className="text-xs font-medium text-slate-500">分钟</span>
                               </p>
                            </div>
                         </div>
                      </div>
                    )}
                 </div>
              </div>
            </div>
          </div>
        )}

        {/* 备忘录常用模板设置弹窗 */}
        {showMemoTemplateModal && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 flex flex-col max-h-[80vh]">
              <div className="flex justify-between items-center mb-4 shrink-0">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">设置常用备忘</h3>
                  <p className="text-[10px] text-slate-400 mt-1">一键添加时将自动引入这些物品</p>
                </div>
                <button onClick={() => setShowMemoTemplateModal(false)} className="p-1.5 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors"><X size={16}/></button>
              </div>
              
              <div className="flex gap-2 mb-4 shrink-0">
                 <input
                   type="text" 
                   value={newTemplateItem} 
                   onChange={e => setNewTemplateItem(e.target.value)}
                   onKeyDown={e => {
                     if (e.key === 'Enter' && newTemplateItem.trim()) {
                        if (!memoTemplate.includes(newTemplateItem.trim())) {
                           setMemoTemplate(prev => [newTemplateItem.trim(), ...prev]);
                        }
                        setNewTemplateItem('');
                     }
                   }}
                   placeholder="添加新模板物品..."
                   className="flex-1 px-4 py-2.5 rounded-xl bg-gray-50 border-none outline-none text-sm focus:ring-2 focus:ring-blue-100"
                 />
                 <button
                   onClick={() => {
                     if (newTemplateItem.trim() && !memoTemplate.includes(newTemplateItem.trim())) {
                       setMemoTemplate(prev => [newTemplateItem.trim(), ...prev]);
                       setNewTemplateItem('');
                     }
                   }}
                   className="px-5 rounded-xl text-white font-bold text-sm transition-transform active:scale-95"
                   style={{ backgroundColor: COLORS.primary }}
                 >新增</button>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2 mb-6 pr-1 min-h-0">
                 {memoTemplate.length === 0 ? <p className="text-xs text-slate-400 text-center py-6">暂无常用物品</p> : null}
                 {memoTemplate.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-white border border-gray-100 px-4 py-3 rounded-xl shadow-sm">
                       <span className="text-slate-700 text-sm font-medium">{item}</span>
                       <button 
                         onClick={() => setMemoTemplate(prev => prev.filter((_, i) => i !== idx))} 
                         className="p-1.5 text-slate-300 hover:text-red-400 hover:bg-red-50 rounded-full transition-colors"
                       ><X size={14}/></button>
                    </div>
                 ))}
              </div>
              
              <button 
                className="w-full py-3.5 rounded-xl text-white text-sm font-bold active:scale-95 shadow-md shrink-0" 
                style={{ backgroundColor: COLORS.primary }}
                onClick={() => setShowMemoTemplateModal(false)}
              >完成设置</button>
            </div>
          </div>
        )}

        {/* 收藏详情弹窗 (轻量级悬浮卡片) */}
        {selectedPlace && (
          <div className="fixed bottom-24 left-6 right-6 z-[100] bg-white/95 backdrop-blur-xl rounded-3xl p-5 shadow-2xl border border-white/50 animate-in slide-in-from-bottom-8 flex items-center justify-between">
            <div className="flex-1 min-w-0 pr-4">
              <h3 className="text-base font-bold text-slate-800 truncate">{safeStr(selectedPlace.name)}</h3>
              <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-1">
                <MapPin size={12} className="shrink-0" /> {safeStr(selectedPlace.district)} {safeStr(selectedPlace.address)}
              </p>
            </div>
            
            <button
              onClick={() => handleSavePlace(selectedPlace, false)} 
              className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform"
              style={{ backgroundColor: COLORS.primary }}
            >
              <Heart size={20} className="fill-white" />
            </button>
            
            <button onClick={() => setSelectedPlace(null)} className="absolute -top-3 -right-3 bg-white text-slate-400 hover:text-slate-600 p-1.5 rounded-full shadow-md border border-gray-100">
              <X size={14}/>
            </button>
          </div>
        )}

        {/* 收藏夹起点规划周边浮层 */}
        {routeBuilderStart && (
          <div className="fixed inset-0 z-[150] flex items-end bg-black/40 backdrop-blur-sm animate-in fade-in">
             <div className="bg-white w-full rounded-t-3xl p-6 pb-safe animate-in slide-in-from-bottom-full min-h-0">
                <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4 shrink-0">
                   <div>
                     <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">已设为起点</p>
                     <h3 className="text-lg font-bold text-slate-800">{routeBuilderStart.name}</h3>
                   </div>
                   <button onClick={() => setRouteBuilderStart(null)} className="p-2 bg-gray-50 rounded-full"><X size={18}/></button>
                </div>
                
                {(() => {
                   const recs = getRecommendations(routeBuilderStart);
                   if (recs.length === 0) return <p className="text-sm text-slate-400 py-6 text-center">附近 10km 内没有其他已收藏的地点</p>;
                   return (
                      <div className="space-y-3 mb-6 flex-1 overflow-y-auto min-h-0">
                         <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5"><Sparkles size={14} color="#FCD34D"/> 推荐顺路一起去：</h4>
                         {recs.map(r => (
                            <div 
                              key={r.id} 
                              onClick={() => {
                               if (routeBuilderTargets.includes(r.id)) setRouteBuilderTargets(prev => prev.filter(id => id !== r.id));
                               else setRouteBuilderTargets(prev => [...prev, r.id]);
                              }} 
                              className={`p-4 rounded-2xl border flex justify-between items-center cursor-pointer active:scale-95 transition-all ${routeBuilderTargets.includes(r.id) ? 'border-blue-500 bg-blue-50/50' : 'border-gray-100 bg-white'}`}
                            >
                               <div className="flex-1 min-w-0 pr-4">
                                  <p className="font-bold text-sm text-slate-700 truncate">{r.name}</p>
                                  <p className="text-[11px] text-slate-400 mt-1">距离起点 {(r.distance/1000).toFixed(1)} km</p>
                               </div>
                               {routeBuilderTargets.includes(r.id) ? <CheckCircle2 size={20} className="text-blue-500 shrink-0" /> : <Circle size={20} className="text-slate-200 shrink-0" />}
                            </div>
                         ))}
                      </div>
                   );
                })()}

                <button
                  onClick={() => {
                     const newTripId = 'trip_' + Date.now().toString();
                     createTrip({
                        id: newTripId,
                        name: `从 ${routeBuilderStart.name} 出发`,
                        places: [routeBuilderStart.id, ...routeBuilderTargets]
                     });
                     setRouteBuilderStart(null);
                     setActiveTab('lists');
                     setActiveTripId(newTripId);
                     setShowRoutePanel(true);
                  }}
                  className="w-full py-4 rounded-2xl text-white font-bold shadow-lg active:scale-95 transition-transform flex justify-center items-center gap-2 shrink-0"
                  style={{ backgroundColor: COLORS.primary }}
                >
                  <Navigation size={18}/> 规划路线并加入行程
                </button>
             </div>
          </div>
        )}

      </div>
      <style>{`.pb-safe{padding-bottom:env(safe-area-inset-bottom)}.pt-safe{padding-top:env(safe-area-inset-top)}.hide-scrollbar::-webkit-scrollbar{display:none}`}</style>
    </div>
  );
}