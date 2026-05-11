import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { 
  Map as MapIcon, List, User, Search, MapPin, Plus, Heart, 
  Navigation, CheckCircle2, Circle, Clock,
  X, Sparkles, Trash2, ClipboardList,
  Mail, KeyRound, Loader2, LogOut, AlertCircle, ChevronDown, ChevronLeft, ChevronRight, LocateFixed,
  Star, Settings, Edit2, CornerDownLeft
} from 'lucide-react';

// ==========================================
// 数据库建表 SQL（建议在 Supabase SQL Editor 执行一次，确保字段一致）
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
// 1. API 密钥配置
// ==========================================
const AMAP_CONFIG = {
  key: import.meta.env.VITE_AMAP_KEY || '', 
  jscode: import.meta.env.VITE_AMAP_JSCODE || '',  
};

const SUPABASE_CONFIG = {
  url: import.meta.env.VITE_SUPABASE_URL || '',
  key: import.meta.env.VITE_SUPABASE_KEY || '',
};

const AI_PLAN_API_URL = import.meta.env.VITE_AI_PLAN_API_URL || '';
const AI_PLAN_BEARER_TOKEN = import.meta.env.VITE_AI_PLAN_BEARER_TOKEN || '';

const COLORS = {
  white: '#FFFFFF',
  bg: '#F4EEEB',
  light: '#DFF2FC',
  medium: '#CED6DF',
  primary: '#95C2E2',
  accent: '#EACDC7',
  neutral: '#E9E7E3',
  textDark: '#455A70',
  textLight: '#6E7C8A'
};

const HOT_CITIES = ['北京', '上海', '广州', '深圳', '成都', '重庆', '杭州', '西安', '武汉', '长春', '长沙', '南京'];

const safeStr = (val) => {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return '';
};

const toMinute = (timeText) => {
  const [hour = '10', minute = '0'] = safeStr(timeText).split(':');
  const safeHour = Math.max(0, Math.min(23, Number(hour) || 10));
  const safeMinute = Math.max(0, Math.min(59, Number(minute) || 0));
  return safeHour * 60 + safeMinute;
};

const toTimeText = (totalMinute) => {
  const safe = ((Math.max(0, totalMinute) % 1440) + 1440) % 1440;
  const hour = String(Math.floor(safe / 60)).padStart(2, '0');
  const minute = String(safe % 60).padStart(2, '0');
  return `${hour}:${minute}`;
};

const formatDurationCn = (totalMinute) => {
  const safeMinute = Math.max(0, Math.round(Number(totalMinute) || 0));
  const hour = Math.floor(safeMinute / 60);
  const minute = safeMinute % 60;
  if (hour <= 0) return `${minute}分`;
  if (minute === 0) return `${hour}小时`;
  return `${hour}小时${minute}分`;
};

const estimateStayMinutes = (place) => {
  const name = safeStr(place?.name);
  const category = safeStr(place?.category);
  const sourceText = `${name}${category}`;
  if (/博物馆|美术馆|展览|古镇|公园|景区/.test(sourceText)) return 120;
  if (/商场|步行街|夜市/.test(sourceText)) return 90;
  if (/咖啡|茶|餐厅|火锅|烧烤|饭店/.test(sourceText)) return 75;
  return 90;
};

const inferCityName = (placeData, fallbackCity) => {
  const fromCity = safeStr(placeData?.city).replace(/市$/, '').trim();
  if (fromCity) return fromCity;
  const district = safeStr(placeData?.district);
  const cityMatch = district.match(/([^省]+?)市/);
  if (cityMatch?.[1]) return cityMatch[1];
  return fallbackCity === '全国' ? '默认城市' : fallbackCity;
};

const logCloudError = (action, error) => {
  console.error(`${action} failed:`, error);
};

// 安全解析经纬度，避免地图 SDK 返回格式差异导致 Script Error
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

const normalizeAddressText = (placeData) => {
  const address = safeStr(placeData?.address).trim();
  const district = safeStr(placeData?.district).trim();
  const merged = address && address !== '地图标记地点' ? (district ? `${district} ${address}` : address) : district;
  if (merged) {
    const deduped = merged
      .split(/\s+/)
      .filter(Boolean)
      .reduce((acc, part) => (acc[acc.length - 1] === part ? acc : [...acc, part]), [])
      .join(' ');
    return deduped;
  }
  return '地址待补全';
};

const placeIdentityKey = (placeData, fallbackCity = '') => {
  const city = inferCityName(placeData, fallbackCity);
  const name = safeStr(placeData?.name).replace(/\s+/g, '').toLowerCase();
  const coords = getLngLat(placeData?.location);
  if (coords) return `${city}::${name}::${coords[0].toFixed(5)}::${coords[1].toFixed(5)}`;
  return `${city}::${name}`;
};

const safeMergeAddress = (district, address) => {
  const d = safeStr(district).trim();
  const a = safeStr(address).trim();
  if (d && a) return `${d} ${a}`;
  return d || a || '';
};

const isNationwideCity = (city) => safeStr(city) === '全国';

const flattenTripPlaceIds = (trip) => {
  if (!trip) return [];
  if (Array.isArray(trip.days) && trip.days.length > 0) {
    return trip.days.flatMap((day) => Array.isArray(day?.places) ? day.places : []);
  }
  return Array.isArray(trip.places) ? trip.places : [];
};

const normalizeTrip = (trip) => {
  if (!trip) return trip;
  const flatPlaces = Array.from(new Set(flattenTripPlaceIds(trip)));
  const safeDays = Array.isArray(trip.days) && trip.days.length > 0
    ? trip.days.map((day, index) => ({
        id: safeStr(day?.id) || `day_${index + 1}`,
        title: safeStr(day?.title) || `Day ${index + 1}`,
        places: Array.from(new Set(Array.isArray(day?.places) ? day.places : [])),
      }))
    : [{
        id: 'day_1',
        title: 'Day 1',
        places: flatPlaces,
      }];
  return {
    ...trip,
    days: safeDays,
    places: Array.from(new Set(safeDays.flatMap((day) => day.places))),
  };
};

// ==========================================
// 地图核心组件
// ==========================================
const RealMapBase = ({ places = [], isRoute = false, mapStatus, mapErrorMsg, currentCity, onMarkerClick, onMapClick, lockViewport = true, mapView, onMapViewChange, routeSegments = [], className = '', heightClassName = '' }) => {
  const containerRef = useRef(null);
  const mapInstance = useRef(null);
  const prevCityRef = useRef('');
  const markerClickRef = useRef(onMarkerClick);
  const mapClickRef = useRef(onMapClick);
  const mapViewChangeRef = useRef(onMapViewChange);

  useEffect(() => {
    markerClickRef.current = onMarkerClick;
    mapClickRef.current = onMapClick;
    mapViewChangeRef.current = onMapViewChange;
  }, [onMarkerClick, onMapClick, onMapViewChange]);

  useEffect(() => {
    if (mapStatus === 'success' && containerRef.current && window.AMap?.Map) {
      try {
        if (!mapInstance.current) {
          mapInstance.current = new window.AMap.Map(containerRef.current, {
            zoom: mapView?.zoom || 11,
            center: mapView?.center || undefined,
            mapStyle: 'amap://styles/normal',
            isHotspot: true 
          });
          
          mapInstance.current.on('hotspotclick', (e) => {
            if (markerClickRef.current) {
              markerClickRef.current({
                id: e.id,
                name: e.name,
                location: e.lnglat,
                district: '',
                address: '地图标记地点',
              });
            }
          });
          mapInstance.current.on('click', (event) => {
            if (mapClickRef.current) {
              mapClickRef.current(event);
            }
          });
          mapInstance.current.on('zoomend', () => {
            const zoom = mapInstance.current?.getZoom?.();
            const center = mapInstance.current?.getCenter?.();
            if (typeof zoom === 'number' && center && mapViewChangeRef.current) {
              mapViewChangeRef.current({ zoom, center: [center.lng, center.lat] });
            }
          });
          mapInstance.current.on('moveend', () => {
            const zoom = mapInstance.current?.getZoom?.();
            const center = mapInstance.current?.getCenter?.();
            if (typeof zoom === 'number' && center && mapViewChangeRef.current) {
              mapViewChangeRef.current({ zoom, center: [center.lng, center.lat] });
            }
          });
        }
        
        const map = mapInstance.current;
        
        if (prevCityRef.current !== currentCity) {
          prevCityRef.current = currentCity;
          if (!mapView?.center) {
            map.setZoom(11);
            if (!isNationwideCity(currentCity) && typeof map.setCity === 'function') {
              map.setCity(currentCity);
            }
          }
        }

        map.clearMap();
        if (mapView?.center && typeof mapView?.zoom === 'number') {
          map.setZoomAndCenter(mapView.zoom, mapView.center);
        }

        places.forEach((p, idx) => {
          const coords = getLngLat(p.location);
          if (coords) {
             const marker = new window.AMap.Marker({
               position: coords,
               cursor: markerClickRef.current ? 'pointer' : 'default',
               label: { content: String(isRoute ? idx + 1 : safeStr(p.name)), direction: 'top' },
               extData: p
             });
             if (markerClickRef.current) marker.on('click', () => markerClickRef.current(p));
             map.add(marker);
          }
        });

        if (isRoute && places.length >= 2) {
          const routePaths = routeSegments
            .map((segment) => Array.isArray(segment?.path) ? segment.path.filter(Boolean) : [])
            .filter((path) => path.length >= 2);
          if (routePaths.length > 0) {
            routePaths.forEach((path) => {
              const polyline = new window.AMap.Polyline({
                path,
                strokeColor: '#95C2E2',
                strokeWeight: 6,
                strokeOpacity: 0.92,
                lineJoin: 'round',
                lineCap: 'round',
              });
              map.add(polyline);
            });
          } else {
            const path = places.map(p => getLngLat(p.location)).filter(Boolean);
            if (path.length >= 2) {
              const polyline = new window.AMap.Polyline({
                path,
                strokeColor: '#95C2E2',
                strokeWeight: 6,
                strokeOpacity: 0.9,
                lineJoin: 'round',
                lineCap: 'round',
              });
              map.add(polyline);
            }
          }
        }

        const shouldFitView = places.length > 0 && (!lockViewport || isRoute || !mapView?.center);
        if (shouldFitView) {
          map.setFitView(undefined, false, [48, 48, 48, 48]);
        }
      } catch (err) {
        console.error("Map rendering error:", err);
      }
    }
  }, [places, isRoute, mapStatus, currentCity, lockViewport, mapView, routeSegments]);

  if (mapStatus === 'loading') return <div className="w-full aspect-square bg-blue-50 rounded-3xl flex items-center justify-center text-blue-300 shadow-inner mb-6"><Loader2 className="animate-spin" /></div>;
  if (mapStatus === 'no-key') return <div className="w-full aspect-square bg-gray-50 border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center p-6 text-center shadow-inner mb-6"><MapIcon size={32} className="text-gray-300 mb-3" /><p className="text-sm font-bold text-gray-500 mb-1">尚未配置完整的地图 API</p></div>;
  if (mapStatus === 'error') return <div className="w-full aspect-square bg-red-50 border-2 border-dashed border-red-200 rounded-3xl flex flex-col items-center justify-center p-6 text-center shadow-inner mb-6"><AlertCircle size={32} className="text-red-300 mb-3" /><p className="text-sm font-bold text-red-500 mb-1">地图加载失败</p><p className="text-[10px] text-red-400">{mapErrorMsg}</p></div>;

  return (
    <div className={`w-full min-h-[300px] overflow-hidden relative ${className} ${heightClassName}`.trim()} style={{ backgroundColor: COLORS.light }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
const RealMap = memo(RealMapBase);

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
    } catch { return []; }
  });
  
  const [trips, setTrips] = useState(() => {
    try {
      const local = localStorage.getItem('travel_trips');
      return local ? JSON.parse(local).map(normalizeTrip) : [];
    } catch { return []; }
  });
  
  const [globalMemos, setGlobalMemos] = useState(() => {
    try {
      const local = localStorage.getItem('travel_memos');
      return local ? JSON.parse(local) : [{ id: '1', text: '身份证及重要证件', done: false }];
    } catch { return [{ id: '1', text: '身份证及重要证件', done: false }]; }
  });
  const [newMemoText, setNewMemoText] = useState('');
  
  const [memoTemplate, setMemoTemplate] = useState(() => {
    try {
      const local = localStorage.getItem('travel_memo_template');
      return local ? JSON.parse(local) : ['身份证', '充电器', '纸巾', '钥匙', '耳机'];
    } catch { return ['身份证', '充电器', '纸巾', '钥匙', '耳机']; }
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

  // AI 智能规划状态
  const [isSmartPlanning, setIsSmartPlanning] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatInput, setAiChatInput] = useState('');
  const [aiConversation, setAiConversation] = useState([]);
  const [aiProposal, setAiProposal] = useState(null);
  const [aiDraftStayMinutesByPlace, setAiDraftStayMinutesByPlace] = useState({});
  const [dayStartTimes, setDayStartTimes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('travel_day_start_times') || '{}');
    } catch {
      return {};
    }
  });

  const [favSearchQuery, setFavSearchQuery] = useState('');
  const [routeBuilderStart, setRouteBuilderStart] = useState(null);
  const [routeBuilderTargets, setRouteBuilderTargets] = useState([]);
  
  const [activeTripId, setActiveTripId] = useState(null);
  const [showRoutePanel, setShowRoutePanel] = useState(false);
  const [newTripModalVisible, setNewTripModalVisible] = useState(false);
  const [newTripName, setNewTripName] = useState('');
  const [newTripDayCount, setNewTripDayCount] = useState(1);
  const [newTripSelectedPlaceIds, setNewTripSelectedPlaceIds] = useState([]);
  const [newTripPlaceDayMap, setNewTripPlaceDayMap] = useState({});
  
  // 分段交通方式配置
  const [segmentModes, setSegmentModes] = useState([]); 
  const [segmentRoutes, setSegmentRoutes] = useState([]); 
  const [, setIsCalculatingSegments] = useState(false);
  const [stayMinutesByPlace, setStayMinutesByPlace] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('travel_stay_minutes') || '{}');
    } catch {
      return {};
    }
  });
  const [currentRouteDay, setCurrentRouteDay] = useState(1);
  const [arrivalOverridesByPlace, setArrivalOverridesByPlace] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('travel_arrival_overrides') || '{}');
    } catch {
      return {};
    }
  });
  const [itinerarySearchQuery, setItinerarySearchQuery] = useState(null);
  const [itinerarySearchResults, setItinerarySearchResults] = useState([]);
  const [isSearchingItinerary, setIsSearchingItinerary] = useState(false);
  const [lockMapViewport] = useState(true);
  const [mapView, setMapView] = useState(() => {
    try {
      const local = JSON.parse(localStorage.getItem('travel_map_view') || '{}');
      if (typeof local.zoom === 'number' && Array.isArray(local.center) && local.center.length === 2) return local;
    } catch {
      return { zoom: 11, center: null };
    }
    return { zoom: 11, center: null };
  });
  const [routeMapView, setRouteMapView] = useState(() => {
    try {
      const local = JSON.parse(localStorage.getItem('travel_route_map_view') || '{}');
      if (typeof local.zoom === 'number' && Array.isArray(local.center) && local.center.length === 2) return local;
    } catch {
      return { zoom: 11, center: null };
    }
    return { zoom: 11, center: null };
  });
  const [collapsedCities, setCollapsedCities] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('travel_collapsed_cities') || '{}');
    } catch {
      return {};
    }
  });

  const autoComplete = useRef(null);
  const aiRequestingRef = useRef(false);
  const routeCacheRef = useRef(new Map());
  const searchRequestRef = useRef(0);
  const itinerarySearchRequestRef = useRef(0);

  // --- 本地缓存备份 ---
  useEffect(() => { localStorage.setItem('travel_saved_places', JSON.stringify(savedPlaces)); }, [savedPlaces]);
  useEffect(() => { localStorage.setItem('travel_trips', JSON.stringify(trips)); }, [trips]);
  useEffect(() => { localStorage.setItem('travel_memos', JSON.stringify(globalMemos)); }, [globalMemos]);
  useEffect(() => { localStorage.setItem('travel_memo_template', JSON.stringify(memoTemplate)); }, [memoTemplate]);
  useEffect(() => { localStorage.setItem('travel_day_start_times', JSON.stringify(dayStartTimes)); }, [dayStartTimes]);
  useEffect(() => { localStorage.setItem('travel_stay_minutes', JSON.stringify(stayMinutesByPlace)); }, [stayMinutesByPlace]);
  useEffect(() => { localStorage.setItem('travel_arrival_overrides', JSON.stringify(arrivalOverridesByPlace)); }, [arrivalOverridesByPlace]);
  useEffect(() => { localStorage.setItem('travel_map_view', JSON.stringify(mapView)); }, [mapView]);
  useEffect(() => { localStorage.setItem('travel_route_map_view', JSON.stringify(routeMapView)); }, [routeMapView]);
  useEffect(() => { localStorage.setItem('travel_collapsed_cities', JSON.stringify(collapsedCities)); }, [collapsedCities]);

  useEffect(() => {
    setNewTripPlaceDayMap((prev) => Object.fromEntries(
      Object.entries(prev).map(([placeId, day]) => [placeId, Math.max(1, Math.min(newTripDayCount, Number(day) || 1))]),
    ));
  }, [newTripDayCount]);

  useEffect(() => {
    setSavedPlaces((prev) => {
      const map = new Map();
      prev.forEach((item) => {
        map.set(placeIdentityKey(item, safeStr(item.city) || currentCity), {
          ...item,
          address: normalizeAddressText(item),
        });
      });
      return Array.from(map.values()).sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
    });
  }, [currentCity]);

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
          if (pRes.data) {
            setSavedPlaces((prev) => {
              const merged = new Map(prev.map((item) => [item.id, item]));
              pRes.data.forEach((item) => merged.set(item.id, item));
              return Array.from(merged.values()).sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
            });
          }
          if (tRes.data) setTrips(tRes.data.map(normalizeTrip));
          if (mRes.data) setGlobalMemos(mRes.data);
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
                         const c = result.city.replace(/市$/, '');
                         setCurrentCity(c);
                         localStorage.setItem('lastCity', c);
                     }
                 });
               });
             }
          } else {
             setMapStatus('error');
             setMapErrorMsg('地图脚本已加载，但 AMap 对象不可用');
          }
        };
        mapScript.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_CONFIG.key}&plugin=AMap.AutoComplete,AMap.PlaceSearch,AMap.InputTips,AMap.Geocoder,AMap.GeometryUtil,AMap.Driving,AMap.Walking,AMap.Riding,AMap.Transfer,AMap.Geolocation&callback=_amapInitCallback`;
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
    const requestId = ++searchRequestRef.current;
    const timer = setTimeout(() => {
      if (mapStatus === 'success' && searchQuery) {
        const mergedResults = [];
        const seen = new Set();
        const append = (item) => {
          if (!item) return;
          const key = `${safeStr(item.name)}|${safeStr(item.address)}|${safeStr(item.location?.lng)}|${safeStr(item.location?.lat)}`;
          if (seen.has(key)) return;
          seen.add(key);
          mergedResults.push(item);
        };
        const done = () => {
          if (searchRequestRef.current !== requestId) return;
          setSearchResults(mergedResults.slice(0, 50));
        };
        let pending = 0;
        const finishOne = () => {
          pending -= 1;
          if (pending <= 0) done();
        };

        try {
          if (window.AMap?.AutoComplete) {
            pending += 1;
            const autoOptions = !isNationwideCity(currentCity) ? { city: currentCity, citylimit: true } : { city: '全国' };
            autoComplete.current = new window.AMap.AutoComplete(autoOptions);
            autoComplete.current.search(searchQuery, (status, result) => {
              if (searchRequestRef.current !== requestId) return;
              const tips = status === 'complete' && result?.tips ? result.tips : [];
              tips.forEach((t) => append(t));
              finishOne();
            });
          }

          if (window.AMap?.InputTips) {
            pending += 1;
            const inputTips = new window.AMap.InputTips({
              city: isNationwideCity(currentCity) ? '全国' : currentCity,
              citylimit: false,
            });
            inputTips.search(searchQuery, (status, result) => {
              if (searchRequestRef.current !== requestId) return;
              const tips = status === 'complete' ? (result?.tips || []) : [];
              tips.forEach((t) => append(t));
              finishOne();
            });
          }

          if (window.AMap?.PlaceSearch) {
            pending += 1;
            const placeSearch = new window.AMap.PlaceSearch({
              city: isNationwideCity(currentCity) ? '全国' : currentCity,
              citylimit: false,
              pageSize: 30,
              extensions: 'all',
            });
            placeSearch.search(searchQuery, (s2, r2) => {
              if (searchRequestRef.current !== requestId) return;
              const pois = s2 === 'complete' ? (r2?.poiList?.pois || []) : [];
              pois.forEach((poi) => append({
                id: safeStr(poi.id) || `${safeStr(poi.name)}_${safeStr(poi.location?.lng)}_${safeStr(poi.location?.lat)}`,
                name: safeStr(poi.name),
                address: safeStr(poi.address),
                district: `${safeStr(poi.pname)}${safeStr(poi.cityname)}${safeStr(poi.adname)}`,
                category: safeStr(poi.type),
                location: poi.location ? { lng: poi.location.lng, lat: poi.location.lat } : null,
                city: safeStr(poi.cityname),
              }));
              finishOne();
            });
          }

          if (pending === 0) {
            done();
          }
        } catch(e) {
          console.error('Search error', e);
          if (searchRequestRef.current === requestId) {
            setSearchResults([]);
          }
        }
      } else {
        if (searchRequestRef.current === requestId) {
          setSearchResults([]);
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery, mapStatus, currentCity]);

  useEffect(() => {
    const requestId = ++itinerarySearchRequestRef.current;
    const timer = setTimeout(async () => {
      const term = safeStr(itinerarySearchQuery).trim();
      if (!term || !showRoutePanel) {
        if (itinerarySearchRequestRef.current === requestId) {
          setItinerarySearchResults([]);
          setIsSearchingItinerary(false);
        }
        return;
      }
      setIsSearchingItinerary(true);
      try {
        const mergedResults = [];
        const seen = new Set();
        const append = (item) => {
          if (!item) return;
          const key = `${safeStr(item.name)}|${safeStr(item.address)}|${safeStr(item.location?.lng)}|${safeStr(item.location?.lat)}`;
          if (seen.has(key)) return;
          seen.add(key);
          mergedResults.push(item);
        };
        await Promise.allSettled([
          new Promise((resolve) => {
            if (!window.AMap?.InputTips) return resolve();
            const inputTips = new window.AMap.InputTips({
              city: isNationwideCity(currentCity) ? '全国' : currentCity,
              citylimit: false,
            });
            inputTips.search(term, (status, result) => {
              const tips = status === 'complete' ? (result?.tips || []) : [];
              tips.forEach((tip) => append(tip));
              resolve();
            });
          }),
          new Promise((resolve) => {
            if (!window.AMap?.PlaceSearch) return resolve();
            const placeSearch = new window.AMap.PlaceSearch({
              city: isNationwideCity(currentCity) ? '全国' : currentCity,
              citylimit: false,
              pageSize: 20,
              extensions: 'all',
            });
            placeSearch.search(term, (status, result) => {
              const pois = status === 'complete' ? (result?.poiList?.pois || []) : [];
              pois.forEach((poi) => append({
                id: safeStr(poi.id) || `${safeStr(poi.name)}_${safeStr(poi.location?.lng)}_${safeStr(poi.location?.lat)}`,
                name: safeStr(poi.name),
                address: safeStr(poi.address),
                district: `${safeStr(poi.pname)}${safeStr(poi.cityname)}${safeStr(poi.adname)}`,
                category: safeStr(poi.type),
                location: poi.location ? { lng: poi.location.lng, lat: poi.location.lat } : null,
                city: safeStr(poi.cityname),
              }));
              resolve();
            });
          }),
        ]);
        const results = mergedResults.slice(0, 20);
        if (itinerarySearchRequestRef.current === requestId) {
          setItinerarySearchResults(results);
        }
      } catch (error) {
        console.error('Itinerary search error', error);
        if (itinerarySearchRequestRef.current === requestId) {
          setItinerarySearchResults([]);
        }
      } finally {
        if (itinerarySearchRequestRef.current === requestId) {
          setIsSearchingItinerary(false);
        }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [itinerarySearchQuery, showRoutePanel, currentCity, mapStatus]);

  // ==========================================
  // AI 核心调用逻辑
  // ==========================================
  const callAiPlanner = async (payload) => {
    if (!AI_PLAN_API_URL) {
      alert('请先配置 VITE_AI_PLAN_API_URL，并通过后端代理调用 AI。');
      return null;
    }
    try {
      const res = await fetch(AI_PLAN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AI_PLAN_BEARER_TOKEN ? { Authorization: `Bearer ${AI_PLAN_BEARER_TOKEN}` } : {}),
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`AI proxy returned ${res.status}`);
      const data = await res.json();
      return data;
    } catch (e) {
      console.error("AI Planner API Error:", e);
      alert("AI 调用失败，请检查代理服务或网络");
      return null;
    }
  };

  const parseDeepSeekJSON = (text) => {
    if (!text) return null;
    let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const firstArray = cleaned.indexOf('[');
    const lastArray = cleaned.lastIndexOf(']');
    const firstObj = cleaned.indexOf('{');
    const lastObj = cleaned.lastIndexOf('}');
    if (firstObj !== -1 && lastObj !== -1 && (firstArray === -1 || firstObj < firstArray)) {
      cleaned = cleaned.substring(firstObj, lastObj + 1);
    } else if (firstArray !== -1 && lastArray !== -1) {
      cleaned = cleaned.substring(firstArray, lastArray + 1);
    }
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("JSON parse error:", e);
      return null;
    }
  };

  const normalizePlanPayload = (payload) => {
    if (!payload) return null;
    if (Array.isArray(payload)) {
      return {
        routes: [{ title: `${currentCity} AI定制路线`, placeIds: payload }]
      };
    }
    if (Array.isArray(payload.placeIds)) {
      return {
        routes: [{ title: safeStr(payload.title) || `${currentCity} AI定制路线`, placeIds: payload.placeIds }]
      };
    }
    if (Array.isArray(payload.days)) {
      return {
        routes: payload.days.map((day, idx) => ({
          title: safeStr(day?.title) || `Day ${idx + 1}`,
          placeIds: Array.isArray(day?.placeIds) ? day.placeIds : [],
        })),
        summary: safeStr(payload.summary),
      };
    }
    if (Array.isArray(payload.routes)) return payload;
    return null;
  };

  const validatePlanPayload = (payload, cityPlaces) => {
    if (!payload || !Array.isArray(payload.routes)) return { ok: false, reason: 'AI 未返回 routes 数组' };
    const validIds = new Set(cityPlaces.map((place) => place.id));
    const usedIds = new Set();
    const safeRoutes = payload.routes.map((route, index) => {
      const title = safeStr(route?.title) || `Day ${index + 1}`;
      const placeIds = Array.isArray(route?.placeIds)
        ? route.placeIds.filter((id) => validIds.has(id)).filter((id) => {
            if (usedIds.has(id)) return false;
            usedIds.add(id);
            return true;
          })
        : [];
      return { title, placeIds };
    }).filter((route) => route.placeIds.length > 0);
    if (!safeRoutes.length) return { ok: false, reason: 'AI 路线没有包含有效收藏地点' };
    return { ok: true, payload: { ...payload, routes: safeRoutes } };
  };

  const buildTripsFromPlan = (planPayload, cityPlaces) => {
    const used = new Set();
    const safeRoutes = (planPayload?.routes || []).map((route, index) => {
      const ids = (route?.placeIds || [])
        .filter((id) => cityPlaces.some((place) => place.id === id))
        .filter((id) => {
          if (used.has(id)) return false;
          used.add(id);
          return true;
        });
      if (ids.length === 0) return null;
      return {
        id: `day_${index + 1}`,
        title: safeStr(route?.title) || `Day ${index + 1}`,
        places: ids
      };
    }).filter(Boolean);
    if (!safeRoutes.length) return [];
    return [normalizeTrip({
      id: `trip_${Date.now()}`,
      name: `${currentCity} AI行程`,
      days: safeRoutes,
    })];
  };

  const applyProposedTrips = async (newTrips) => {
    if (!newTrips?.length) {
      alert('AI 方案里没有可执行的收藏地点，请先补充收藏。');
      return;
    }
    const normalizedTrips = newTrips.map((trip) => normalizeTrip(trip));
    const tripsToAdd = [...normalizedTrips].reverse();
    setTrips((prev) => [...tripsToAdd, ...prev]);
    if (user && !user.is_anonymous && supabase) {
      try {
        const cloudTrips = normalizedTrips.map((trip) => ({ ...trip, user_id: user.id }));
        await supabase.from('trips').upsert(cloudTrips);
      } catch (error) {
        logCloudError('Sync AI trips', error);
      }
    }
    setActiveTripId(normalizedTrips[normalizedTrips.length - 1].id);
    setShowRoutePanel(true);
    setActiveTab('lists');
  };



  const sendAiChatPlan = async () => {
    if (aiRequestingRef.current) return;
    if (!aiChatInput.trim()) return;
    const userText = aiChatInput.trim();
    const cityPlaces = savedPlaces.filter((place) => place.city === currentCity);
    if (cityPlaces.length < 2) {
      alert('当前城市收藏太少，至少收藏 2 个地点后再试。');
      return;
    }
    setIsSmartPlanning(true);
    aiRequestingRef.current = true;
    setAiConversation((prev) => [...prev, { role: 'user', text: userText }]);
    setAiChatInput('');

    const answer = await callAiPlanner({
      action: 'plan',
      prompt: userText,
      city: currentCity,
      places: cityPlaces.map((place) => ({
        id: place.id,
        name: place.name,
        category: place.category,
        address: place.address
      })),
      currentTrip: activeTripId ? (trips.find((trip) => trip.id === activeTripId) || null) : null,
      preferences: {
        dayStartAt: '10:00',
        targetStopsPerDay: 6
      }
    });
    const contentText = answer?.content || answer?.text || answer?.choices?.[0]?.message?.content || '';
    const parsed = answer?.proposal || parseDeepSeekJSON(contentText || '') || (() => {
      try { return JSON.parse(contentText || '{}'); } catch { return null; }
    })();
    const normalized = normalizePlanPayload(parsed) || {
      routes: [{
        title: `${currentCity} AI路线`,
        placeIds: cityPlaces.slice(0, 6).map((p) => p.id),
      }],
      summary: 'AI 返回格式不稳定，已为你生成可执行兜底路线。',
    };
    const validated = validatePlanPayload(normalized, cityPlaces);
    if (!validated.ok) {
      setAiConversation((prev) => [...prev, { role: 'assistant', text: `提案校验失败：${validated.reason}，请换个需求重试。` }]);
      setIsSmartPlanning(false);
      aiRequestingRef.current = false;
      return;
    }
    const proposalTrips = buildTripsFromPlan(validated.payload, cityPlaces);

    if (!proposalTrips.length) {
      setAiConversation((prev) => [...prev, { role: 'assistant', text: '我没有拿到可执行路线，请换个需求再试。' }]);
      setIsSmartPlanning(false);
      return;
    }

    setAiProposal({ trips: proposalTrips, summary: safeStr(parsed?.summary) });
    setAiDraftStayMinutesByPlace({});
    setAiConversation((prev) => [...prev, { role: 'assistant', text: safeStr(parsed?.summary) || `已生成 ${proposalTrips.length} 条可执行路线，确认后可一键加入。` }]);
    setIsSmartPlanning(false);
    aiRequestingRef.current = false;
  };

  const activeTrip = useMemo(() => (
    activeTripId ? normalizeTrip(trips.find((trip) => trip.id === activeTripId)) : null
  ), [activeTripId, trips]);
  const routeDayCount = Math.max(1, activeTrip?.days?.length || 1);

  useEffect(() => {
    setCurrentRouteDay((prev) => Math.min(Math.max(1, prev), routeDayCount));
  }, [routeDayCount, activeTripId]);

  useEffect(() => {
    setItinerarySearchQuery('');
    setItinerarySearchResults([]);
    setIsSearchingItinerary(false);
  }, [activeTripId, currentRouteDay, showRoutePanel]);

  // 获取分段路线详情（独立计算每一段的出行方式）
  useEffect(() => {
    const dayPlaces = activeTrip?.days?.[Math.max(0, currentRouteDay - 1)]?.places || [];
    const currentDayTripPlaces = dayPlaces
      .map((pid) => savedPlaces.find((p) => p.id === pid))
      .filter(Boolean);
    const currentDayTripPlaceIds = currentDayTripPlaces.map((place) => place.id).join(',');
    if (!window.AMap || currentDayTripPlaces.length < 2 || !showRoutePanel) {
      setSegmentRoutes([]);
      return;
    }
    
    let canceled = false;
    setIsCalculatingSegments(true);

    const fetchSegments = async () => {
      const cacheKey = `${currentDayTripPlaceIds}__${JSON.stringify(segmentModes)}__${currentCity}`;
      const cached = routeCacheRef.current.get(cacheKey);
      if (cached) {
        setSegmentRoutes(cached);
        setIsCalculatingSegments(false);
        return;
      }
      const results = [];
      for (let i = 0; i < currentDayTripPlaces.length - 1; i++) {
         const p1 = currentDayTripPlaces[i];
         const p2 = currentDayTripPlaces[i+1];
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
                       let distance = 0, time = 0, path = [];
                       if (currentMode === 'transit' && result.plans && result.plans.length > 0) {
                          distance = result.plans[0].distance;
                          time = result.plans[0].time;
                          path = (result.plans[0].segments || []).flatMap((seg) => [
                            ...(seg.walking?.steps || []).flatMap((step) => step.path || []),
                            ...(seg.transit?.lines || []).flatMap((line) => line.path || []),
                          ]);
                       } else if (result.routes && result.routes.length > 0) {
                          distance = result.routes[0].distance;
                          time = result.routes[0].time;
                          path = (result.routes[0].steps || []).flatMap((step) => step.path || []);
                       }
                       resolve({ distance, time, path: path.length >= 2 ? path : [start, end] });
                    } else {
                       const dist = window.AMap.GeometryUtil.distance(start, end);
                       const speed = currentMode === 'walking' ? 1.2 : currentMode === 'riding' ? 4 : 10;
                       resolve({ distance: dist, time: dist / speed, path: [start, end] });
                    }
                  } catch {
                    resolve({ distance: 0, time: 0, path: [start, end] });
                  }
               });
             } else {
               resolve({ distance: 0, time: 0, path: [start, end] });
             }
           } catch {
             resolve({ distance: 0, time: 0, path: [start, end] });
           }
         });
         results.push(res);
      }
      if (!canceled) {
        setSegmentRoutes(results);
        routeCacheRef.current.set(cacheKey, results);
        setIsCalculatingSegments(false);
      }
    };
    fetchSegments();
    return () => { canceled = true; };
  }, [activeTrip, currentRouteDay, savedPlaces, segmentModes, currentCity, mapStatus, showRoutePanel]);

  const handleSegmentModeChange = (index, newMode) => {
    routeCacheRef.current.clear();
    setSegmentModes(prev => {
      const next = [...prev];
      next[index] = newMode;
      return next;
    });
  };

  const setAllSegmentModes = (mode) => {
    const size = Math.max(0, (activeTrip?.days?.[Math.max(0, currentRouteDay - 1)]?.places || []).length - 1);
    const newModes = new Array(size).fill(mode);
    setSegmentModes(newModes);
  };
  void setAllSegmentModes;

  useEffect(() => {
    setSegmentModes((prev) => {
      const dayPlaces = activeTrip?.days?.[Math.max(0, currentRouteDay - 1)]?.places || [];
      const size = Math.max(0, dayPlaces.length - 1);
      const next = new Array(size).fill('driving').map((mode, index) => prev[index] || mode);
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
  }, [activeTrip, currentRouteDay]);

  // ==========================================
  // 数据同步写入操作逻辑
  // ==========================================
  const handleSavePlace = async (placeData, stayOpen = false) => {
    const placeName = safeStr(placeData.name) || '未知地点';
    const inferredCity = inferCityName(placeData, currentCity);
    const resolvedAddress = await resolveAddressForPlace(placeData);
    const dedupeKey = placeIdentityKey(placeData, currentCity);
    const existingByKey = savedPlaces.find((place) => placeIdentityKey(place, inferredCity) === dedupeKey);
    const newPlace = {
      id: existingByKey?.id || placeData.id || Date.now().toString(),
      name: placeName,
      location: placeData.location,
      category: safeStr(placeData.category) || '景点',
      address: safeStr(resolvedAddress.address) || normalizeAddressText(placeData),
      district: safeStr(resolvedAddress.district) || safeStr(placeData.district) || safeStr(existingByKey?.district) || '',
      city: inferredCity,
      savedAt: Date.now()
    };
    setSavedPlaces(prev => {
      const filtered = prev.filter((p) => placeIdentityKey(p, newPlace.city) !== dedupeKey && p.id !== newPlace.id);
      return [newPlace, ...filtered];
    });

    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('places').upsert({ ...newPlace, user_id: user.id }); } catch(e){ logCloudError('Save place', e); }
    }
    
    if (!stayOpen) {
      setSelectedPlace(null);
      exitSearch();
    }
  };

  const removePlace = async (id) => {
    setSavedPlaces(prev => prev.filter(p => p.id !== id));
    setTrips(prev => prev.map((trip) => normalizeTrip({
      ...trip,
      places: (trip.places || []).filter((pid) => pid !== id),
      days: Array.isArray(trip.days)
        ? trip.days.map((day) => ({ ...day, places: (day.places || []).filter((pid) => pid !== id) }))
        : trip.days,
    })));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('places').delete().eq('id', id); } catch(e){ logCloudError('Remove place', e); }
      try {
        const impacted = trips.filter((trip) => flattenTripPlaceIds(trip).includes(id));
        for (const trip of impacted) {
          const nextTrip = normalizeTrip({
            ...trip,
            places: (trip.places || []).filter((pid) => pid !== id),
            days: Array.isArray(trip.days)
              ? trip.days.map((day) => ({ ...day, places: (day.places || []).filter((pid) => pid !== id) }))
              : trip.days,
          });
          await supabase.from('trips').update({ places: nextTrip.places, days: nextTrip.days }).eq('id', trip.id);
        }
      } catch(e) { logCloudError('Sync trip places after remove place', e); }
    }
  };


  const resolveAddressForPlace = async (placeData) => {
    const location = getLngLat(placeData?.location);
    const direct = safeMergeAddress(placeData?.district, placeData?.address);
    if (direct && !/地图标记地点|地址待补全/.test(direct)) {
      return {
        address: normalizeAddressText(placeData),
        district: safeStr(placeData?.district),
      };
    }
    if (!window.AMap || !location) {
      return { address: normalizeAddressText(placeData), district: safeStr(placeData?.district) };
    }

    // Try PlaceSearch around the clicked coordinate first.
    if (window.AMap.PlaceSearch) {
      try {
        const resolved = await new Promise((resolve) => {
          const ps = new window.AMap.PlaceSearch({
            city: currentCity === '全国' ? '全国' : currentCity,
            citylimit: false,
            pageSize: 1,
            extensions: 'all',
          });
          ps.searchNearBy(safeStr(placeData?.name) || '地点', location, 300, (status, result) => {
            if (status !== 'complete' || !result?.poiList?.pois?.length) {
              resolve(null);
              return;
            }
            const poi = result.poiList.pois[0];
            resolve({
              district: `${safeStr(poi.pname)}${safeStr(poi.cityname)}${safeStr(poi.adname)}`,
              address: safeStr(poi.address),
            });
          });
        });
        if (resolved) {
          return {
            district: resolved.district,
            address: safeMergeAddress(resolved.district, resolved.address),
          };
        }
      } catch (error) {
        console.warn('PlaceSearch reverse lookup failed', error);
      }
    }

    // Fallback to geocoder.
    if (window.AMap.Geocoder) {
      try {
        const resolved = await new Promise((resolve) => {
          const geocoder = new window.AMap.Geocoder({});
          geocoder.getAddress(location, (status, result) => {
            if (status !== 'complete' || !result?.regeocode) {
              resolve(null);
              return;
            }
            const comp = result.regeocode.addressComponent || {};
            const district = `${safeStr(comp.province)}${safeStr(comp.city)}${safeStr(comp.district)}`;
            resolve({
              district,
              address: safeStr(result.regeocode.formattedAddress),
            });
          });
        });
        if (resolved) {
          return {
            district: resolved.district,
            address: safeMergeAddress(resolved.district, resolved.address),
          };
        }
      } catch (error) {
        console.warn('Geocoder reverse lookup failed', error);
      }
    }

    return { address: normalizeAddressText(placeData), district: safeStr(placeData?.district) };
  };

  const createSavedPlaceFromSource = async (placeData) => {
    const placeName = safeStr(placeData?.name) || '未知地点';
    const inferredCity = inferCityName(placeData, currentCity);
    const resolvedAddress = await resolveAddressForPlace(placeData);
    const dedupeKey = placeIdentityKey(placeData, currentCity);
    const existingByKey = savedPlaces.find((place) => placeIdentityKey(place, inferredCity) === dedupeKey);
    const newPlace = {
      id: existingByKey?.id || placeData?.id || Date.now().toString(),
      name: placeName,
      location: placeData?.location,
      category: safeStr(placeData?.category) || '景点',
      address: safeStr(resolvedAddress.address) || normalizeAddressText(placeData),
      district: safeStr(resolvedAddress.district) || safeStr(placeData?.district) || safeStr(existingByKey?.district) || '',
      city: inferredCity,
      savedAt: existingByKey?.savedAt || Date.now(),
    };
    setSavedPlaces((prev) => {
      const filtered = prev.filter((p) => placeIdentityKey(p, newPlace.city) !== dedupeKey && p.id !== newPlace.id);
      return [newPlace, ...filtered];
    });
    if (user && !user.is_anonymous && supabase) {
      try {
        await supabase.from('places').upsert({ ...newPlace, user_id: user.id });
      } catch (e) {
        logCloudError('Save place from itinerary', e);
      }
    }
    return newPlace;
  };

  const createTrip = async (newTrip) => {
    const normalizedTrip = normalizeTrip(newTrip);
    setTrips(prev => [normalizedTrip, ...prev]);
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('trips').upsert({ ...normalizedTrip, user_id: user.id }); } catch(e){ logCloudError('Create trip', e); }
    }
  };

  const removeTrip = async (id) => {
    const nextTrips = trips.filter(t => t.id !== id);
    setTrips(nextTrips);
    if (activeTripId === id) {
      const fallbackId = nextTrips[0]?.id || null;
      setActiveTripId(fallbackId);
      setShowRoutePanel(Boolean(fallbackId));
    }
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('trips').delete().eq('id', id); } catch(e){ logCloudError('Remove trip', e); }
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
      try { await supabase.from('trips').update({ name: editingTripName.trim() }).eq('id', editingTripId); } catch(e){ logCloudError('Rename trip', e); }
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
      try { await supabase.from('trips').update({ places: updatedPlaces }).eq('id', activeTripId); } catch(e){ logCloudError('Reorder trip places', e); }
    }
  };

  const removePlaceFromActiveTrip = async (index) => {
    if (!activeTripId) return;
    let updatedPlaces = [];
    setTrips((prevTrips) => prevTrips.map((trip) => {
      if (trip.id !== activeTripId) return trip;
      const nextPlaces = [...(trip.places || [])];
      if (index < 0 || index >= nextPlaces.length) return trip;
      nextPlaces.splice(index, 1);
      updatedPlaces = nextPlaces;
      return { ...trip, places: nextPlaces };
    }));

    if (updatedPlaces.length === 0) {
      setShowRoutePanel(false);
    }

    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('trips').update({ places: updatedPlaces }).eq('id', activeTripId); } catch(e){ logCloudError('Remove place from trip', e); }
    }
  };

  const handleAddMemo = async () => {
    if (newMemoText.trim()) {
      const newMemo = { id: Date.now().toString(), text: newMemoText.trim(), done: false };
      setGlobalMemos(prev => [newMemo, ...prev]);
      setNewMemoText('');
      
      if (user && !user.is_anonymous && supabase) {
        try { await supabase.from('memos').upsert({ ...newMemo, user_id: user.id }); } catch(e){ logCloudError('Add memo', e); }
      }
    }
  };

  const toggleMemo = async (id, currentDone) => {
    setGlobalMemos(prev => prev.map(m => m.id === id ? { ...m, done: !currentDone } : m));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('memos').update({ done: !currentDone }).eq('id', id); } catch(e){ logCloudError('Toggle memo', e); }
    }
  };

  const handleDeleteMemo = async (id) => {
    setGlobalMemos(prev => prev.filter(m => m.id !== id));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('memos').delete().eq('id', id); } catch(e){ logCloudError('Delete memo', e); }
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
      try { await supabase.from('memos').insert(cloudMemos); } catch(e){ logCloudError('Add memo template items', e); }
    }
  };

  const handleClearDone = async () => {
    const idsToDelete = globalMemos.filter(m => m.done).map(m => m.id);
    if (idsToDelete.length === 0) return;

    setGlobalMemos(prev => prev.filter(m => !m.done));

    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('memos').delete().in('id', idsToDelete); } catch(e){ logCloudError('Clear completed memos', e); }
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
      try { await supabase.from('memos').update({ text: editingMemoText.trim() }).eq('id', editingMemoId); } catch(e){ logCloudError('Edit memo', e); }
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
    else { setOtpSent(true); setAuthMessage('验证码已发送至你的邮箱'); }
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
    if (error) setAuthMessage('游客登录失败，请确认 Supabase 已开启 Anonymous 登录');
    setAuthLoading(false);
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null); setOtpSent(false); setEmail(''); setOtp(''); setAuthMessage('');
  };

  const exitSearch = () => {
    setIsSearching(false);
    setSearchQuery('');
    searchRequestRef.current += 1;
    setSearchResults([]);
  };

  const selectCity = (city) => {
    setCurrentCity(city);
    localStorage.setItem('lastCity', city); 
    setMapView({ zoom: 11, center: null });
    setRouteMapView({ zoom: 11, center: null });
    searchRequestRef.current += 1;
    setSearchResults([]);
    setShowCityPicker(false);
    setCustomCityInput('');
  };
  void removePlaceFromActiveTrip;
  void movePlace;

  const getRecommendations = (place) => {
    if (!place || !window.AMap?.GeometryUtil) return [];
    const p1 = getLngLat(place.location);
    if (!p1) return [];
    
    const deduped = savedPlaces
      .filter(p => p.id !== place.id)
      .map(p => {
        const p2 = getLngLat(p.location);
        if (!p2) return { ...p, distance: Infinity };
        return { ...p, distance: window.AMap.GeometryUtil.distance(p1, p2) };
      })
      .filter(p => p.distance < 10000)
      .sort((a, b) => a.distance - b.distance);
    const unique = [];
    const seen = new Set();
    for (const item of deduped) {
      const key = `${item.city}::${safeStr(item.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
      if (unique.length >= 5) break;
    }
    return unique;
  };

  const addPlaceToActiveTrip = async (placeId) => {
    if (!activeTripId) return;
    await updateTripDays(activeTripId, (normalized) => ({
      ...normalized,
      days: normalized.days.map((day, index) => (
        index === Math.max(0, currentRouteDay - 1)
          ? { ...day, places: Array.from(new Set([...(day.places || []), placeId])) }
          : day
      )),
    }));
  };

  const addPlaceObjectToActiveTrip = async (placeData) => {
    if (!activeTripId) return;
    const savedPlace = await createSavedPlaceFromSource(placeData);
    await addPlaceToActiveTrip(savedPlace.id);
  };

  const movePlaceToTripDay = async (placeId, targetDay) => {
    if (!activeTripId) return;
    await updateTripDays(activeTripId, (normalized) => ({
      ...normalized,
      days: normalized.days.map((day, index) => {
        const filteredPlaces = (day.places || []).filter((id) => id !== placeId);
        if (index === targetDay - 1) {
          return { ...day, places: [...filteredPlaces, placeId] };
        }
        return { ...day, places: filteredPlaces };
      }),
    }));
  };

  const updateTripDays = async (tripId, updater) => {
    let updatedTrip = null;
    setTrips((prevTrips) => prevTrips.map((trip) => {
      if (trip.id !== tripId) return trip;
      updatedTrip = normalizeTrip(updater(normalizeTrip(trip)));
      return updatedTrip;
    }));
    if (user && !user.is_anonymous && supabase && updatedTrip) {
      try {
        await supabase.from('trips').update({ places: updatedTrip.places, days: updatedTrip.days }).eq('id', tripId);
      } catch (e) {
        logCloudError('Update trip days', e);
      }
    }
    return updatedTrip;
  };

  const handleRouteMapClickAdd = async (event) => {
    if (!activeTripId || !event?.lnglat) return;
    await addPlaceObjectToActiveTrip({
      id: `map_pick_${Date.now()}`,
      name: '地图选点',
      location: { lng: event.lnglat.lng, lat: event.lnglat.lat },
      district: '',
      address: '地图标记地点',
      city: currentCity,
      category: '地图选点',
    });
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
  void totalDist;
  void totalTime;
  const dayStorageKey = `${safeStr(activeTripId) || 'default'}::day_${currentRouteDay}`;
  const currentDayPlaceIds = activeTrip?.days?.[currentRouteDay - 1]?.places || [];
  const currentDayTripPlaces = currentDayPlaceIds
    .map((pid) => savedPlaces.find((place) => place.id === pid))
    .filter(Boolean);
  const timelineRows = (() => {
    const dayStartAt = safeStr(dayStartTimes[dayStorageKey]) || '10:00';
    const initialMinute = toMinute(dayStartAt);
    const result = currentDayTripPlaces.reduce((accumulator, place, index) => {
      const segment = index > 0 ? segmentRoutes[index - 1] : null;
      const transitMinute = index > 0 ? Math.max(0, Math.round((segment?.time || 0) / 60)) : 0;
      const overrideMinute = Number(arrivalOverridesByPlace[`${dayStorageKey}::${place.id}`]);
      const arriveMinute = index === 0
        ? (Number.isFinite(overrideMinute) ? overrideMinute : initialMinute)
        : (Number.isFinite(overrideMinute) ? overrideMinute : accumulator.cursor + transitMinute);
      const stayMinutes = Math.max(15, Number(stayMinutesByPlace[place.id]) || estimateStayMinutes(place));
      const leaveMinute = arriveMinute + stayMinutes;
      accumulator.rows.push({
        id: place.id || `${index}`,
        place,
        arriveMinute,
        arriveAt: toTimeText(arriveMinute),
        leaveMinute,
        leaveAt: toTimeText(leaveMinute),
        stayMinutes,
        transitMinute
      });
      accumulator.cursor = leaveMinute;
      return accumulator;
    }, { rows: [], cursor: initialMinute });
    return result.rows;
  })();
  const totalDays = routeDayCount;
  const dayOptions = Array.from({ length: totalDays }, (_, idx) => idx + 1);
  const currentDayRows = timelineRows;
  const currentDayTransitMinutes = currentDayRows.reduce((sum, row) => sum + (row.transitMinute || 0), 0);
  const currentDayStayMinutes = currentDayRows.reduce((sum, row) => sum + (row.stayMinutes || 0), 0);
  const currentDayTotalMinutes = currentDayTransitMinutes + currentDayStayMinutes;
  const currentDayStartAt = safeStr(dayStartTimes[dayStorageKey]) || '10:00';

  return (
    <div className="min-h-[100dvh] w-full flex justify-center bg-gray-100 sm:bg-[#f0f4f8]" style={{ fontFamily: '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",sans-serif' }}>
      <div className="w-full sm:max-w-[960px] h-[100dvh] flex flex-col relative bg-white overflow-hidden shadow-2xl min-h-0">
        
        <div className="absolute top-0 w-full h-40" style={{ background: `linear-gradient(to bottom, ${COLORS.bg}, white)` }}></div>
        <div className="h-12 shrink-0 pt-safe z-10"></div>

        <div className="flex-1 relative z-10 flex flex-col overflow-hidden min-h-0">
          
          {/* ==================== 发现页面 ==================== */}
          {activeTab === 'map' && (
            <div className="flex-1 flex flex-col animate-in fade-in min-h-0">
              <div className="px-6 shrink-0">
                {!isSearching && <h2 className="text-[28px] sm:text-[30px] leading-none font-bold mb-4" style={{ color: COLORS.textDark }}>发现地点</h2>}
                
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

              <div className="flex-1 overflow-y-auto px-6 pb-24 min-h-0 hide-scrollbar overflow-x-hidden">
                {isSearching ? (
                  <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 min-h-[320px]">
                    {searchQuery.length === 0 ? (
                      <div className="text-center py-20 text-slate-400 text-sm flex flex-col items-center">
                        <MapIcon size={32} className="mb-2 text-slate-200" />
                        输入地点名称开始搜索
                      </div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map((p) => {
                        const key = placeIdentityKey(p, currentCity);
                        const isSaved = savedPlaces.some((saved) => placeIdentityKey(saved, currentCity) === key);
                        return (
                          <div key={safeStr(p.id) || key} onClick={() => setSelectedPlace(p)} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex justify-between items-center active:scale-95 transition-transform cursor-pointer min-h-[84px]">
                            <div className="pr-4 overflow-hidden flex-1">
                              <h4 className="font-bold text-base text-slate-700 truncate">{safeStr(p.name)}</h4>
                              <p className="text-[11px] text-slate-400 mt-1.5 truncate flex items-center gap-1">
                                <MapPin size={10}/> {normalizeAddressText(p)}
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
                      places={savedPlaces.filter(p => isNationwideCity(currentCity) || p.city === currentCity)} 
                      mapStatus={mapStatus} 
                      mapErrorMsg={mapErrorMsg} 
                      currentCity={currentCity} 
                      lockViewport={lockMapViewport}
                      mapView={mapView}
                      onMapViewChange={setMapView}
                      onMarkerClick={(p) => setSelectedPlace(p)}
                      className="rounded-[32px] shadow-inner"
                      heightClassName="h-[360px] sm:h-[420px]"
                    />
                    {savedPlaces.length === 0 && mapStatus === 'success' && (
                      <div className="bg-white p-4 rounded-2xl text-center text-xs text-slate-500 shadow-sm flex items-center justify-center gap-2">
                        <LocateFixed size={14}/> 试试在上方搜索框找到你想去的地方
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== 鏀惰棌澶归〉闈?==================== */}
          {activeTab === 'favorites' && (
            <div className="h-full flex flex-col animate-in fade-in bg-[#f0f4f8] min-h-0 overflow-x-hidden">
               <div className="px-6 pt-5 pb-3 bg-white shadow-sm z-10 shrink-0 overflow-x-hidden">
                 <h2 className="text-[22px] sm:text-[24px] leading-tight font-semibold tracking-[0.01em] text-slate-800">我的收藏</h2>
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
               
               <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 space-y-6 pb-24 min-h-0">
                  {Object.keys(groupedFavorites).map(city => (
                    <div key={city} className="space-y-3 overflow-x-hidden">
                      <div className="flex items-center justify-between border-b border-gray-200 pb-1">
                        <h3 className="font-bold text-lg text-slate-800">{city}</h3>
                        <button
                          onClick={() => setCollapsedCities((prev) => ({ ...prev, [city]: !prev[city] }))}
                          className="text-xs text-slate-500 px-2 py-1 rounded bg-white border border-gray-100"
                        >
                          {collapsedCities[city] ? '展开' : '收起'}
                        </button>
                      </div>
                      {!collapsedCities[city] ? <div className="grid gap-3 overflow-x-hidden">
                        {groupedFavorites[city].map(spot => (
                          <div 
                            key={spot.id} 
                            onClick={() => { setRouteBuilderStart(spot); setRouteBuilderTargets([]); }}
                            className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex justify-between items-start cursor-pointer active:scale-95 transition-transform max-w-full overflow-hidden"
                          >
                            <div className="flex-1 min-w-0 pr-4">
                              <p className="font-bold text-slate-700 break-words leading-snug">{safeStr(spot.name)}</p>
                              <p className="text-[11px] leading-5 text-slate-400 break-words flex items-start gap-1 mt-1 max-w-full">
                                <MapPin size={10} className="mt-[3px] shrink-0" /> <span className="min-w-0 break-words">{normalizeAddressText(spot)}</span>
                              </p>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); removePlace(spot.id); }} className="text-slate-300 hover:text-red-400 p-2 rounded-full hover:bg-red-50 transition-colors">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div> : null}
                    </div>
                  ))}
                  {savedPlaces.length === 0 && (
                    <div className="text-center py-20 text-sm text-slate-400">还没有收藏过地点</div>
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
                  <h2 className="text-[22px] sm:text-[24px] font-semibold text-slate-800">我的行程</h2>
                  <button onClick={() => setNewTripModalVisible(true)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm active:scale-95"><Plus size={20} color={COLORS.primary}/></button>
               </div>
               <div className="flex-1 overflow-y-auto pb-24 space-y-4 pt-2 min-h-0">
                  <button
                    onClick={() => setAiChatOpen(true)}
                    className="w-full mt-3 bg-white p-4 rounded-2xl border border-[#ced6df] text-left shadow-sm active:scale-95 transition-transform"
                  >
                    <p className="text-sm font-bold text-slate-700">AI 对话规划</p>
                    <p className="text-[11px] text-slate-500 mt-1">输入需求后先生成提案，确认后再一键应用，结果更稳定</p>
                  </button>

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
                               <button onClick={(e) => startEditingTrip(trip, e)} className="shrink-0 p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors" title="淇敼鍚嶇О">
                                 <Edit2 size={14}/>
                               </button>
                             </div>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); removeTrip(trip.id); }} className="text-slate-300 hover:text-red-400 p-1 shrink-0 ml-2">
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <p className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={12}/> {flattenTripPlaceIds(trip).length} 个地点 · {(trip.days?.length || 1)} 天</p>
                      </div>
                    ))
                  )}
               </div>
            </div>
          )}

          {/* ==================== 澶囧繕椤甸潰 ==================== */}
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
                      placeholder="添加新备忘（如：遮阳帽...）"
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

                 {/* UI 重塑：融合主色调的低饱和度标签按钮 */}
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
                    <div className="text-center py-10 text-sm text-slate-400">备忘录还是空的，先加一些物品吧</div>
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

          {/* ==================== 鎴戠殑椤甸潰 ==================== */}
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

        {/* ===================== 弹窗组件组 ===================== */}
        
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
                      placeholder="输入城市名，例如：沈阳"
                      className="flex-1 px-4 py-3 rounded-xl bg-gray-50 border-none outline-none text-sm"
                    />
                    <button onClick={() => {if(customCityInput) selectCity(customCityInput)}} className="px-5 rounded-xl text-white font-bold text-sm" style={{ backgroundColor: COLORS.primary }}>确定</button>
                 </div>
                 
                 <h4 className="text-sm font-bold text-slate-400 mb-4">热门城市</h4>
                 <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => selectCity('全国')} className={`py-3 rounded-xl font-bold text-sm ${isNationwideCity(currentCity) ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-slate-600'}`}>全国</button>
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
              <div className="mb-4">
                <p className="text-xs font-bold text-slate-500 mb-2">天数</p>
                <select
                  value={newTripDayCount}
                  onChange={(e) => setNewTripDayCount(Math.max(1, Math.min(7, Number(e.target.value) || 1)))}
                  className="w-full px-4 py-3 rounded-xl bg-gray-50 border-none outline-none text-sm"
                >
                  {Array.from({ length: 7 }, (_, idx) => idx + 1).map((day) => (
                    <option key={`new_day_${day}`} value={day}>{day} 天</option>
                  ))}
                </select>
              </div>
              <div className="mb-6">
                <p className="text-xs font-bold text-slate-500 mb-2">选择地点</p>
                <div className="max-h-48 overflow-y-auto space-y-2 rounded-2xl bg-gray-50 p-3">
                  {savedPlaces.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-4">先去收藏地点，再创建行程</div>
                  ) : savedPlaces.map((place) => {
                    const checked = newTripSelectedPlaceIds.includes(place.id);
                    return (
                      <button
                        key={`new_trip_place_${place.id}`}
                        type="button"
                        onClick={() => {
                          setNewTripSelectedPlaceIds((prev) => checked ? prev.filter((id) => id !== place.id) : [...prev, place.id]);
                          setNewTripPlaceDayMap((prev) => checked ? Object.fromEntries(Object.entries(prev).filter(([key]) => key !== place.id)) : { ...prev, [place.id]: prev[place.id] || 1 });
                        }}
                        className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${checked ? 'bg-blue-50 border-blue-200 text-slate-700' : 'bg-white border-transparent text-slate-600'}`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm truncate">{safeStr(place.name)}</div>
                            <div className="text-[11px] truncate text-slate-400">{safeStr(place.city)} {safeStr(place.address)}</div>
                          </div>
                          {checked ? (
                            <select
                              value={Math.max(1, Math.min(newTripDayCount, Number(newTripPlaceDayMap[place.id] || 1)))}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => setNewTripPlaceDayMap((prev) => ({ ...prev, [place.id]: Math.max(1, Math.min(newTripDayCount, Number(event.target.value) || 1)) }))}
                              className="shrink-0 px-2 py-1 rounded-lg border border-blue-200 bg-white text-xs font-bold"
                            >
                              {Array.from({ length: newTripDayCount }, (_, idx) => idx + 1).map((day) => (
                                <option key={`new_trip_place_day_${place.id}_${day}`} value={day}>D{day}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3">
                <button className="flex-1 py-3 rounded-xl bg-gray-100 text-sm font-bold text-slate-600 active:scale-95" onClick={() => { setNewTripModalVisible(false); setNewTripName(''); setNewTripDayCount(1); setNewTripSelectedPlaceIds([]); setNewTripPlaceDayMap({}); }}>取消</button>
                <button className="flex-1 py-3 rounded-xl text-white text-sm font-bold active:scale-95 disabled:opacity-50" style={{ backgroundColor: COLORS.primary }} disabled={!newTripName.trim()} onClick={() => {
                  if (newTripName.trim()) {
                    const dayCount = Math.max(1, newTripDayCount);
                    const selectedPlaceIds = Array.from(new Set(newTripSelectedPlaceIds));
                    const tripDays = Array.from({ length: dayCount }, (_, index) => ({
                      id: `day_${index + 1}`,
                      title: `Day ${index + 1}`,
                      places: selectedPlaceIds.filter((placeId) => Math.max(1, Math.min(dayCount, Number(newTripPlaceDayMap[placeId] || 1))) === index + 1),
                    }));
                    createTrip({
                      id: Date.now().toString(),
                      name: newTripName.trim(),
                      places: selectedPlaceIds,
                      days: tripDays,
                    });
                    setNewTripModalVisible(false);
                    setNewTripName('');
                    setNewTripDayCount(1);
                    setNewTripSelectedPlaceIds([]);
                    setNewTripPlaceDayMap({});
                  }
                }}>确认创建</button>
              </div>
            </div>
          </div>
        )}

        {aiChatOpen && (
          <div className="fixed inset-0 z-[165] flex items-end bg-black/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-[#f8f6f2] w-full rounded-t-3xl p-6 pb-safe max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">AI 对话规划</h3>
                  <p className="text-[11px] text-slate-500 mt-1">先生成提案，再确认应用，避免不可执行结果</p>
                </div>
                <button onClick={() => setAiChatOpen(false)} className="p-2 rounded-full bg-white"><X size={16} /></button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {aiConversation.length === 0 ? (
                  <div className="text-xs text-slate-500 bg-white rounded-xl p-3 border border-[#e9e7e3]">
                    示例：我想周末轻松逛 2 天，咖啡店加公园，最多 6 个点，步行少一点。
                  </div>
                ) : null}
                {aiConversation.map((item, index) => (
                  <div key={`chat_${index}`} className={`p-3 rounded-xl text-xs ${item.role === 'user' ? 'bg-[#ced6df] text-slate-700 ml-6' : 'bg-white text-slate-700 mr-6 border border-[#e9e7e3]'}`}>
                    {item.text}
                  </div>
                ))}

                {aiProposal ? (
                  <div className="bg-white border border-[#ced6df] rounded-2xl p-4">
                    <p className="text-sm font-bold text-slate-700 mb-2">提案预览</p>
                    <p className="text-xs text-slate-500 mb-3">{aiProposal.summary || '已生成可执行行程提案。'}</p>
                    <button
                      onClick={async () => {
                        await applyProposedTrips(aiProposal.trips || []);
                        setStayMinutesByPlace((prev) => ({ ...prev, ...aiDraftStayMinutesByPlace }));
                        if ((aiProposal.trips || []).length > 0) {
                          const firstTrip = aiProposal.trips[0];
                          setSegmentModes(new Array(Math.max(0, (firstTrip?.places?.length || 0) - 1)).fill('driving'));
                        }
                        setAiProposal(null);
                        setAiChatOpen(false);
                      }}
                      className="w-full py-3 rounded-xl text-white text-sm font-bold"
                      style={{ backgroundColor: COLORS.primary }}
                    >
                      应用提案到行程
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex gap-2">
                <input
                  value={aiChatInput}
                  onChange={(event) => setAiChatInput(event.target.value)}
                  placeholder="告诉 AI 你的偏好：天数、节奏、预算、体力..."
                  className="flex-1 px-4 py-3 rounded-xl bg-white border border-[#ced6df] outline-none text-sm"
                />
                <button
                  disabled={isSmartPlanning || !aiChatInput.trim()}
                  onClick={sendAiChatPlan}
                  className="px-5 rounded-xl text-white text-sm font-bold disabled:opacity-50"
                  style={{ backgroundColor: COLORS.primary }}
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 行程路线展示弹窗：分段交通与自由排序升级 */}
        {/* ==================================================== */}
        {showRoutePanel && activeTripId && (
          <div className="fixed inset-0 z-[120] flex flex-col bg-slate-50 min-h-0">
            <div className="px-5 sm:px-6 py-4 flex items-center justify-between border-b border-slate-100 shrink-0 bg-white">
              <h2 className="text-[20px] sm:text-[24px] leading-tight font-semibold text-slate-800">行程规划与地图</h2>
              <button onClick={() => setShowRoutePanel(false)} className="p-2 rounded-full bg-slate-100"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-y-contain">
              <div className="mx-auto w-full max-w-[960px] px-3 sm:px-5 py-3 sm:py-4">
                <div className="sticky top-0 z-20 pb-3 bg-slate-50">
                  <div className="relative bg-slate-200 rounded-[28px] overflow-hidden border border-slate-200 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
                    <RealMap
                      places={currentDayTripPlaces}
                      isRoute={true}
                      mapStatus={mapStatus}
                      currentCity={currentCity}
                      lockViewport={lockMapViewport}
                      mapView={routeMapView}
                      onMapViewChange={setRouteMapView}
                      routeSegments={segmentRoutes}
                      onMapClick={handleRouteMapClickAdd}
                      className="rounded-[28px]"
                      heightClassName="h-[280px] sm:h-[360px] lg:h-[400px]"
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/20 to-transparent" />
                  </div>
                </div>
                <div className="bg-white rounded-[28px] shadow-[0_12px_30px_rgba(15,23,42,0.06)] border border-slate-100 overflow-hidden">
                  <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-slate-100 bg-white">
                    <div className="flex items-center justify-between">
                    <button onClick={() => setCurrentRouteDay((d) => Math.max(1, d - 1))} className={`p-2 rounded-full ${currentRouteDay === 1 ? 'opacity-10 pointer-events-none' : 'text-slate-400 hover:bg-slate-100'}`}><ChevronLeft size={22} /></button>
                    <div className="text-center">
                      <span className="block text-[10px] font-black tracking-[0.25em] mb-1 uppercase" style={{ color: COLORS.primary }}>Itinerary</span>
                      <h2 className="font-semibold text-base sm:text-lg text-slate-800 max-w-[220px] sm:max-w-[360px] truncate">{safeStr(activeTrip?.name) || `Day ${currentRouteDay}`}</h2>
                      <p className="text-[11px] sm:text-xs text-slate-400 mt-1">第 {currentRouteDay} 天 / 共 {totalDays} 天</p>
                    </div>
                    <button onClick={() => setCurrentRouteDay((d) => Math.min(totalDays, d + 1))} className={`p-2 rounded-full ${currentRouteDay === totalDays ? 'opacity-10 pointer-events-none' : 'text-slate-400 hover:bg-slate-100'}`}><ChevronRight size={22} /></button>
                    </div>
                    <div className="mt-3 flex items-center gap-2 overflow-x-auto hide-scrollbar">
                      {dayOptions.map((d) => (
                        <button
                          key={`day_chip_${d}`}
                          onClick={() => setCurrentRouteDay(d)}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors ${currentRouteDay === d ? 'text-white border-transparent' : 'text-slate-500 bg-slate-50 border-slate-200'}`}
                          style={currentRouteDay === d ? { backgroundColor: COLORS.primary } : {}}
                        >
                          DAY {d}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center">
                      <button
                        type="button"
                        onClick={() => setItinerarySearchQuery(itinerarySearchQuery === null ? '' : null)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-slate-400 text-xs font-semibold hover:bg-slate-100 transition-colors"
                        aria-label="添加地点"
                      >
                        <Search size={12} />
                        <span>添加地点</span>
                      </button>
                    </div>
                    {itinerarySearchQuery !== null && (
                      <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => { setItinerarySearchQuery(null); setItinerarySearchResults([]); }}>
                        <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
                        <div
                          className="relative w-full max-w-lg bg-white rounded-t-3xl px-4 pt-4 pb-8 shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-4" />
                          <p className="text-xs font-bold text-slate-400 mb-2 px-1">搜索地点加入 DAY {currentRouteDay}</p>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                            <input
                              autoFocus
                              value={itinerarySearchQuery}
                              onChange={(event) => setItinerarySearchQuery(event.target.value)}
                              placeholder="输入地点名称..."
                              className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-slate-300"
                            />
                            {itinerarySearchQuery ? (
                              <button type="button" onClick={() => setItinerarySearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                                <X size={14} />
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-2 max-h-52 overflow-y-auto space-y-1.5 pr-0.5">
                            {isSearchingItinerary ? <p className="text-xs text-slate-400 py-3 text-center">搜索中...</p> : null}
                            {!isSearchingItinerary && itinerarySearchQuery && itinerarySearchResults.length === 0 ? <p className="text-xs text-slate-400 py-3 text-center">没有找到地点</p> : null}
                            {!itinerarySearchQuery ? <p className="text-xs text-slate-400 py-3 text-center">也可以直接点击地图添加地点</p> : null}
                            {itinerarySearchResults.map((result) => (
                              <button
                                key={`route_search_${safeStr(result.id) || placeIdentityKey(result, currentCity)}`}
                                type="button"
                                onClick={async () => {
                                  await addPlaceObjectToActiveTrip(result);
                                  setItinerarySearchQuery(null);
                                  setItinerarySearchResults([]);
                                }}
                                className="w-full text-left rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 hover:bg-slate-100 transition-colors"
                              >
                                <p className="text-sm font-semibold text-slate-700 break-words">{safeStr(result.name)}</p>
                                <p className="text-[11px] text-slate-400 mt-0.5 break-words">{normalizeAddressText(result)}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <main className="px-4 sm:px-5 pt-3 pb-8">
                    <div className="space-y-3">
                      {currentDayRows.length === 0 ? (
                        <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
                          <p className="text-sm font-bold text-slate-600">这一天还没有地点</p>
                          <p className="text-xs text-slate-400 mt-2">先在行程里把地点分配到这一天</p>
                        </div>
                      ) : null}
                      {currentDayRows.map((row) => {
                        const rowIndex = timelineRows.findIndex((item) => item.id === row.id);
                        const segMode = segmentModes[Math.max(0, rowIndex - 1)] || 'driving';
                        const transitMinute = row.transitMinute || 0;
                        const modeLabel = segMode === 'transit' ? '公交' : segMode === 'riding' ? '骑行' : segMode === 'walking' ? '步行' : '驾车';
                        return (
                          <div key={`timeline_${row.id}`} className="group bg-white rounded-[24px] p-4 border border-slate-100 shadow-sm transition-all relative">
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex gap-3 min-w-0">
                                <div className="w-7 h-10 rounded-[14px] shrink-0 text-white flex items-start justify-center pt-2" style={{ backgroundColor: COLORS.primary }}><MapPin size={11} /></div>
                                <div className="flex flex-col gap-1 min-w-0">
                                  <h3 className="font-bold text-slate-800 text-[13px] break-words leading-snug">{safeStr(row.place.name)}</h3>
                                  <div className="text-[10px] leading-4 text-slate-400 break-words">{normalizeAddressText(row.place)}</div>
                                  <div className="flex items-center flex-wrap gap-1.5 text-slate-400 mt-1">
                                    <div className="flex items-center gap-1 rounded-full bg-slate-50 border border-slate-100 px-2 py-1">
                                      <Clock size={14} />
                                      <span className="text-[10px]">停留</span>
                                      <span className="text-[10px] font-bold text-slate-700">{formatDurationCn(Number(stayMinutesByPlace[row.place.id]) || row.stayMinutes)}</span>
                                    </div>
                                    {rowIndex > 0 ? <div className="text-[10px] px-2 py-1 rounded-full bg-slate-50 border border-slate-100 text-slate-500">{modeLabel} · {formatDurationCn(transitMinute)}</div> : null}
                                  </div>
                                </div>
                              </div>
                              <div className="w-24 shrink-0">
                                <select value={currentDayPlaceIds.includes(row.place.id) ? currentRouteDay : Math.max(1, Math.min(totalDays, Number(stayMinutesByPlace[`day_${row.place.id}`] || currentRouteDay)))} onChange={(event) => movePlaceToTripDay(row.place.id, Math.max(1, Math.min(totalDays, Number(event.target.value) || 1)))} className="mb-2 w-full px-2 py-1 rounded-xl border border-slate-200 text-xs font-bold bg-white">
                                  {dayOptions.map((d) => <option key={`d_${row.id}_${d}`} value={d}>D{d}</option>)}
                                </select>
                                <select value={segMode} onChange={(event) => { if (rowIndex > 0) handleSegmentModeChange(rowIndex - 1, event.target.value); }} className="w-full px-2 py-1 rounded-xl border border-slate-200 text-xs font-bold bg-white">
                                  <option value="driving">驾车</option>
                                  <option value="transit">公交</option>
                                  <option value="riding">骑行</option>
                                  <option value="walking">步行</option>
                                </select>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-5 pt-4 border-t border-dashed border-slate-100 gap-3">
                              <div className="flex flex-col">
                                <span className="text-[9px] text-slate-400 font-black uppercase">Arrival</span>
                                <input
                                  type="time"
                                  value={row.arriveAt}
                                  onChange={(event) => setArrivalOverridesByPlace((prev) => ({ ...prev, [`${dayStorageKey}::${row.place.id}`]: toMinute(event.target.value) }))}
                                  className="text-sm font-black text-slate-700 bg-transparent outline-none"
                                />
                              </div>
                              <div className="flex-1 mx-6 h-1 bg-slate-50 rounded-full relative"><div className="absolute top-0 left-0 h-full w-1/3 rounded-full" style={{ backgroundColor: COLORS.light }}></div></div>
                              <div className="flex flex-col text-right"><span className="text-[9px] text-slate-400 font-black uppercase">Leave</span><span className="text-sm font-black text-slate-700">{row.leaveAt}</span></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </main>
                  <div className="px-6 py-3 bg-white/90 backdrop-blur-md border-t border-slate-50 text-center shrink-0">
                    <div className="flex justify-center gap-2.5 mb-2">
                      {dayOptions.map((d) => (
                        <div key={`page_${d}`} onClick={() => setCurrentRouteDay(d)} className={`h-1.5 rounded-full transition-all duration-500 cursor-pointer ${currentRouteDay === d ? 'w-10 shadow-lg' : 'w-1.5 bg-slate-200'}`} style={currentRouteDay === d ? { backgroundColor: COLORS.primary } : {}} />
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400">本日总时长 {formatDurationCn(currentDayTotalMinutes)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showMemoTemplateModal && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 flex flex-col max-h-[80vh]">
              <div className="flex justify-between items-center mb-4 shrink-0">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">设置常用备忘</h3>
                  <p className="text-[10px] text-slate-400 mt-1">一键添加时将自动带入这些物品</p>
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
                   placeholder="添加新的模板物品..."
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

        {/* 收藏详情弹窗（轻量级悬浮卡片） */}
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
                   if (recs.length === 0) return <p className="text-sm text-slate-400 py-6 text-center">附近 10km 内没有其他已收藏地点</p>;
                   return (
                      <div className="space-y-3 mb-6 flex-1 overflow-y-auto min-h-0">
                         <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5"><Sparkles size={14} color="#FCD34D"/> 推荐顺路一起去</h4>
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
                        places: [routeBuilderStart.id, ...routeBuilderTargets],
                        days: [{
                          id: 'day_1',
                          title: 'Day 1',
                          places: [routeBuilderStart.id, ...routeBuilderTargets],
                        }],
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
      <style>{`.pb-safe{padding-bottom:env(safe-area-inset-bottom)}.pt-safe{padding-top:env(safe-area-inset-top)}.hide-scrollbar::-webkit-scrollbar{display:none}.amap-logo,.amap-copyright{display:none!important}`}</style>
    </div>
  );
}

