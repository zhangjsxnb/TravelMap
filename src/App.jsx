import React, { useState, useEffect, useRef } from 'react';
import { 
  Map as MapIcon, List, User, Search, MapPin, Plus, Heart, 
  Navigation, Calendar, CheckCircle2, Circle, 
  ChevronRight, ArrowRight, X, Sparkles, Trash2, ClipboardList,
  Mail, KeyRound, Loader2, LogOut, AlertCircle, ChevronDown, ChevronLeft, LocateFixed
} from 'lucide-react';

// ==========================================
// 1. API 密钥配置区
// ==========================================
const AMAP_CONFIG = {
  key: '6a06a2de3f4cc4a4a7a21a12e85aa48f', 
  jscode: 'ec662b0cbf8e9b00dfd0642742c51808',  
};

// 安全地获取环境变量，兼容不同的构建环境避免编译报错
const getEnv = (key) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env[key] || '';
    }
  } catch (e) {
    // 降级处理
  }
  return '';
};

const SUPABASE_CONFIG = {
  url: getEnv('VITE_SUPABASE_URL'), 
  key: getEnv('VITE_SUPABASE_KEY'), 
};

const COLORS = {
  white: '#FFFFFF',
  bg: '#FCF8E7',
  light: '#DFF2FC',
  medium: '#A6D0F1',
  primary: '#95C2E2',
  danger: '#ff8fa3',
  textDark: '#334155',
  textLight: '#64748B'
};

const HOT_CITIES = ['北京', '上海', '广州', '深圳', '成都', '重庆', '杭州', '西安', '武汉', '哈尔滨', '长沙', '南京'];

const safeStr = (val) => {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return '';
};

// ==========================================
// 地图核心组件 (修复问题 7、问题 2 空白页)
// ==========================================
const RealMap = ({ places = [], isRoute = false, mapStatus, mapErrorMsg, currentCity }) => {
  const containerRef = useRef(null);
  const mapInstance = useRef(null);
  const prevCityRef = useRef(currentCity);

  useEffect(() => {
    if (mapStatus === 'success' && containerRef.current && window.AMap?.Map) {
      try {
        if (!mapInstance.current) {
          mapInstance.current = new window.AMap.Map(containerRef.current, {
            zoom: 11,
            mapStyle: 'amap://styles/normal'
          });
          // 首次加载若不是全国，直接定位到城市
          if (currentCity !== '全国') {
            mapInstance.current.setCity(currentCity);
          }
        }
        
        const map = mapInstance.current;
        
        // 修复问题 7：只有当城市发生切换时，地图才联动平滑飞过去
        if (prevCityRef.current !== currentCity) {
          if (currentCity !== '全国') {
            map.setCity(currentCity);
          }
          prevCityRef.current = currentCity;
        }

        map.clearMap(); // 清除之前的标记

        places.forEach((p, idx) => {
          // 修复问题 2 空白页：兼容各种格式的经纬度，防止地图崩溃
          const lng = p.location?.lng || p.location?.R || p.location?.[0];
          const lat = p.location?.lat || p.location?.Q || p.location?.[1];
          
          if (lng && lat) {
             const marker = new window.AMap.Marker({
               position: [lng, lat],
               label: { content: String(isRoute ? idx + 1 : safeStr(p.name)), direction: 'top' }
             });
             map.add(marker);
          }
        });

        if (isRoute && places.length >= 2 && window.AMap.Driving) {
          const driving = new window.AMap.Driving({ map, hideMarkers: true });
          const path = places.map(p => {
            const lng = p.location?.lng || p.location?.R || p.location?.[0];
            const lat = p.location?.lat || p.location?.Q || p.location?.[1];
            return lng && lat ? [lng, lat] : null;
          }).filter(Boolean);

          if (path.length >= 2) driving.search(path[0], path[path.length - 1], { waypoints: path.slice(1, -1) });
        } else if (places.length > 0 && !isRoute) {
          map.setFitView();
        }
      } catch (err) {
        console.error("Map rendering error:", err);
      }
    }
  }, [places, isRoute, mapStatus, currentCity]);

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

  // 核心功能状态
  const [activeTab, setActiveTab] = useState('map');
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [trips, setTrips] = useState([]);
  
  // 备忘录状态 (为你保留了！)
  const [globalMemos, setGlobalMemos] = useState([{ id: '1', text: '身份证及重要证件', done: false }]);
  const [newMemoText, setNewMemoText] = useState('');
  
  // 发现页面 & 城市切换 (修复问题 3：本地存储记忆)
  const [currentCity, setCurrentCity] = useState(localStorage.getItem('lastCity') || '北京');
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [customCityInput, setCustomCityInput] = useState('');
  
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  
  const [activeTripId, setActiveTripId] = useState(null);
  const [showRoutePanel, setShowRoutePanel] = useState(false);
  const [newTripModalVisible, setNewTripModalVisible] = useState(false);
  const [newTripName, setNewTripName] = useState('');

  const autoComplete = useRef(null);

  // ==========================================
  // 初始化加载：高德地图 & Supabase (恢复原版安全加载)
  // ==========================================
  useEffect(() => {
    // 1. 高德地图安全加载
    if (!AMAP_CONFIG.key || !AMAP_CONFIG.jscode) {
      setMapStatus('no-key');
    } else {
      window._AMapSecurityConfig = { securityJsCode: AMAP_CONFIG.jscode };
      const mapScript = document.createElement('script');
      window._amapInitCallback = () => {
        if (window.AMap) {
           setMapStatus('success');
           // 如果本地没有记忆城市，则自动定位
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
      mapScript.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_CONFIG.key}&plugin=AMap.AutoComplete,AMap.PlaceSearch,AMap.GeometryUtil,AMap.Driving,AMap.Geolocation&callback=_amapInitCallback`;
      mapScript.async = true;
      mapScript.onerror = () => {
        setMapStatus('error');
        setMapErrorMsg('网络请求被拦截，请检查浏览器插件或白名单');
      };
      document.head.appendChild(mapScript);
    }

    // 2. Supabase 异步加载 (原始版本，避免CDN报错)
    if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.key && !SUPABASE_CONFIG.url.includes('你的Supabase')) {
      const supaScript = document.createElement('script');
      supaScript.src = 'https://unpkg.com/@supabase/supabase-js@2';
      supaScript.async = true;
      supaScript.onload = () => {
        if (window.supabase) {
          const client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
          setSupabase(client);
          client.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            setAuthLoading(false);
          });
          client.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
          });
        } else {
          setAuthLoading(false);
        }
      };
      supaScript.onerror = () => setAuthLoading(false);
      document.head.appendChild(supaScript);
    } else {
      setAuthLoading(false); 
    }
  }, []);

  // ==========================================
  // 高德精准搜索逻辑
  // ==========================================
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

        autoComplete.current.search(searchQuery, (status, result) => {
          if (status === 'complete' && result?.tips) {
            setSearchResults(result.tips.filter(item => item && item.location));
          } else {
            setSearchResults([]);
          }
        });
      } else {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, mapStatus, currentCity]);

  // ==========================================
  // 核心业务功能
  // ==========================================
  const exitSearch = () => {
    setIsSearching(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const selectCity = (city) => {
    setCurrentCity(city);
    localStorage.setItem('lastCity', city); // 记录切换的城市
    setShowCityPicker(false);
    setCustomCityInput('');
  };

  const handleSavePlace = (placeData) => {
    const newPlace = {
      id: placeData.id || Date.now().toString(),
      name: safeStr(placeData.name) || '未知地点',
      location: placeData.location,
      category: safeStr(placeData.category) || '景点',
      address: safeStr(placeData.address) || '',
      desc: safeStr(placeData.district) || '地理位置',
      city: currentCity === '全国' ? '默认城市' : currentCity, // 修复问题 1/5：保存时绑定城市
      savedAt: Date.now()
    };
    setSavedPlaces(prev => {
      const exists = prev.find(p => p.id === newPlace.id);
      return exists ? prev.map(p => p.id === newPlace.id ? newPlace : p) : [newPlace, ...prev];
    });
    setSelectedPlace(null);
    exitSearch(); // 收藏后退出搜索模式
  };

  // 修复问题 4 & 6：智能规划当前城市的收藏路线
  const handleSmartRoute = () => {
    const cityPlaces = savedPlaces.filter(p => p.city === currentCity);
    if (cityPlaces.length < 2) {
      alert(`${currentCity} 收藏的地点不足2个，无法规划路线，请先去发现页面多收藏几个吧！`);
      return;
    }
    setActiveTripId('smart-route');
    setShowRoutePanel(true);
  };

  // 备忘录功能
  const handleAddMemo = () => {
    if (newMemoText.trim()) {
      setGlobalMemos([{ id: Date.now().toString(), text: newMemoText.trim(), done: false }, ...globalMemos]);
      setNewMemoText('');
    }
  };
  
  const handleDeleteMemo = (id) => {
    setGlobalMemos(globalMemos.filter(m => m.id !== id));
  };

  const getRecommendations = (place) => {
    if (!place || !place.location || !window.AMap?.GeometryUtil) return [];
    const p1 = [place.location.lng || place.location.R, place.location.lat || place.location.Q];
    return savedPlaces
      .filter(p => p.id !== place.id && p.location)
      .map(p => {
        const p2 = [p.location.lng || p.location.R, p.location.lat || p.location.Q];
        return { ...p, distance: window.AMap.GeometryUtil.distance(p1, p2) };
      })
      .filter(p => p.distance < 5000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
  };

  // 修复问题 5：城市分组计算
  const groupedFavorites = savedPlaces.reduce((acc, spot) => {
    const city = spot.city || '其他城市';
    if (!acc[city]) acc[city] = [];
    acc[city].push(spot);
    return acc;
  }, {});

  // ==========================================
  // UI 渲染 - 登录页 (完全保留原始样式)
  // ==========================================
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
          
          <button 
            onClick={async () => {
              if (!supabase) setUser({ id: 'local-guest', is_anonymous: true, email: '本地游客' });
              else {
                setAuthLoading(true);
                await supabase.auth.signInAnonymously();
                setAuthLoading(false);
              }
            }} 
            disabled={authLoading}
            className="w-full mt-6 py-3.5 rounded-2xl bg-white border border-gray-100 text-sm font-bold shadow-sm transition-transform active:scale-95 text-slate-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {authLoading ? <Loader2 size={16} className="animate-spin" /> : '进入应用 (游客模式免登录)'}
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // UI 渲染 - 主应用
  // ==========================================
  return (
    <div className="min-h-[100dvh] w-full flex justify-center bg-gray-100 sm:bg-[#f0f4f8]">
      <div className="w-full sm:max-w-md h-[100dvh] flex flex-col relative bg-white overflow-hidden shadow-2xl">
        
        <div className="absolute top-0 w-full h-40" style={{ background: `linear-gradient(to bottom, ${COLORS.bg}, white)` }}></div>
        <div className="h-12 shrink-0 pt-safe z-10"></div>

        <div className="flex-1 relative z-10 flex flex-col overflow-hidden">
          
          {/* ==================== 发现页面 ==================== */}
          {activeTab === 'map' && (
            <div className="flex-1 flex flex-col animate-in fade-in">
              <div className="px-6 shrink-0">
                {!isSearching && <h2 className="text-2xl font-bold mb-4" style={{ color: COLORS.textDark }}>发现地点</h2>}
                
                {/* 顶部搜索与城市切换栏 */}
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

              {/* 动态内容区：搜索结果列表 OR 默认地图 */}
              <div className="flex-1 overflow-y-auto px-6 pb-24">
                {isSearching ? (
                  <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4">
                    {searchQuery.length === 0 ? (
                      <div className="text-center py-20 text-slate-400 text-sm flex flex-col items-center">
                        <MapIcon size={32} className="mb-2 text-slate-200" />
                        输入地点名称开始搜索
                      </div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map(p => (
                        <div key={p.id} onClick={() => setSelectedPlace(p)} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex justify-between items-center active:scale-95 transition-transform cursor-pointer">
                          <div className="pr-4 overflow-hidden">
                            <h4 className="font-bold text-base text-slate-700 truncate">{safeStr(p.name)}</h4>
                            <p className="text-[11px] text-slate-400 mt-1.5 truncate flex items-center gap-1">
                              <MapPin size={10}/> {safeStr(p.district)} {safeStr(p.address)}
                            </p>
                          </div>
                          <Plus size={20} color={COLORS.primary} className="shrink-0 bg-blue-50 p-1 rounded-full" />
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-10 text-slate-400 text-sm">未找到相关地点，请尝试其他关键词</div>
                    )}
                  </div>
                ) : (
                  <div className="animate-in fade-in">
                    <RealMap 
                      // 发现页地图只渲染当前城市的点
                      places={savedPlaces.filter(p => currentCity === '全国' || p.city === currentCity)} 
                      mapStatus={mapStatus} 
                      mapErrorMsg={mapErrorMsg} 
                      currentCity={currentCity} 
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

          {/* ==================== 新增：分类收藏夹页面 ==================== */}
          {activeTab === 'favorites' && (
            <div className="h-full flex flex-col animate-in fade-in bg-[#f0f4f8]">
               <div className="px-6 py-5 bg-white shadow-sm z-10 shrink-0">
                 <h2 className="text-2xl font-bold">我的收藏夹</h2>
                 <p className="text-xs mt-1 font-medium text-slate-400">已自动为您按城市分类</p>
               </div>
               
               <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 pb-24">
                  {Object.keys(groupedFavorites).map(city => (
                    <div key={city} className="space-y-3">
                      <h3 className="font-bold text-lg text-slate-800 border-b border-gray-200 pb-1">{city}</h3>
                      <div className="grid gap-3">
                        {groupedFavorites[city].map(spot => (
                          <div key={spot.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex justify-between items-center">
                            <div className="flex-1 min-w-0 pr-4">
                              <p className="font-bold text-slate-700 truncate">{safeStr(spot.name)}</p>
                              <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-1">
                                <MapPin size={10} /> {safeStr(spot.address)}
                              </p>
                            </div>
                            <button onClick={() => setSavedPlaces(savedPlaces.filter(p => p.id !== spot.id))} className="text-slate-300 hover:text-red-400 p-2">
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
               </div>
            </div>
          )}

          {/* ==================== 行程页面 (保留原逻辑 + 增加智能规划按钮) ==================== */}
          {activeTab === 'lists' && (
            <div className="h-full flex flex-col px-6 animate-in fade-in">
               <div className="flex justify-between items-center py-4">
                  <h2 className="text-2xl font-bold">我的行程</h2>
                  <button onClick={() => setNewTripModalVisible(true)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm active:scale-95"><Plus size={20} color={COLORS.primary}/></button>
               </div>
               
               <div className="flex-1 overflow-y-auto pb-24 space-y-4 pt-2">
                  {/* 智能路线规划卡片 (修复问题 4 & 6) */}
                  <div 
                    onClick={handleSmartRoute} 
                    className="bg-gradient-to-r from-blue-400 to-blue-600 p-5 rounded-3xl shadow-md text-white cursor-pointer active:scale-95 transition-transform"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Navigation size={20} />
                      <h3 className="font-bold text-lg">智能路线规划</h3>
                    </div>
                    <p className="text-xs text-blue-100 opacity-90">一键串联你在 {currentCity} 收藏的所有地点</p>
                  </div>

                  <div className="h-px bg-gray-200 my-4"></div>

                  <h3 className="font-bold text-slate-600">自定义行程</h3>
                  {trips.length === 0 ? (
                    <div className="text-center py-6 text-sm text-slate-400">还没创建自定义行程，点击右上角加号创建吧</div>
                  ) : (
                    trips.map(trip => (
                      <div key={trip.id} onClick={() => {setActiveTripId(trip.id); setShowRoutePanel(true)}} className="bg-white p-5 rounded-3xl shadow-sm border border-gray-50 cursor-pointer active:scale-95">
                        <h3 className="font-bold text-lg mb-2">{safeStr(trip.name)}</h3>
                        <p className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={12}/> {trip.places?.length || 0} 个站点</p>
                      </div>
                    ))
                  )}
               </div>
            </div>
          )}

          {/* ==================== 备忘页面 (为你完美保留！) ==================== */}
          {activeTab === 'memo' && (
            <div className="h-full flex flex-col animate-in fade-in bg-[#f0f4f8]">
               <div className="px-6 py-5 bg-white shadow-sm z-10 shrink-0">
                 <h2 className="text-2xl font-bold">出行备忘录</h2>
                 <p className="text-xs mt-1 font-medium text-slate-400">记录你的通用出行装备与事项</p>
               </div>
               
               <div className="px-6 py-4 shrink-0 mt-2">
                 <div className="flex gap-2 bg-white p-2 rounded-2xl shadow-sm border border-gray-50">
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
               </div>

               <div className="flex-1 overflow-y-auto px-6 pb-24 space-y-3">
                  {globalMemos.length === 0 ? (
                    <div className="text-center py-10 text-sm text-slate-400">备忘录空空如也，添加一些物品吧</div>
                  ) : (
                    globalMemos.map(m => (
                      <div key={m.id} className="bg-white p-4 rounded-2xl shadow-sm flex items-center justify-between border border-gray-50 transition-transform">
                         <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => {
                             setGlobalMemos(globalMemos.map(g => g.id === m.id ? {...g, done: !g.done} : g));
                         }}>
                            {m.done ? <CheckCircle2 size={20} color={COLORS.primary}/> : <Circle size={20} color={COLORS.textLight}/>}
                            <span className={`text-sm font-medium ${m.done ? 'line-through text-slate-300' : 'text-slate-700'}`}>{safeStr(m.text)}</span>
                         </div>
                         <button 
                           onClick={() => handleDeleteMemo(m.id)} 
                           className="p-2 ml-2 text-gray-300 hover:text-red-400 active:scale-95 transition-all rounded-full hover:bg-red-50"
                         >
                           <Trash2 size={16} />
                         </button>
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
                {user.is_anonymous ? '游客' : (user.email || '旅行者')}
              </h2>
              
              <button 
                onClick={() => setUser(null)}
                className="mt-12 py-3 px-6 rounded-2xl bg-red-50 text-red-500 font-bold text-sm shadow-sm transition-transform active:scale-95 flex items-center gap-2"
              >
                <LogOut size={16} /> 退出账号 / 返回登录页
              </button>
            </div>
          )}
        </div>

        {/* ==================== 底部导航 (变更为 5 个选项) ==================== */}
        <div className="shrink-0 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.03)] rounded-t-3xl z-30 pb-safe px-2 relative">
          <div className="flex justify-around items-center h-16">
            <button onClick={() => {setActiveTab('map'); setIsSearching(false);}} className={`flex flex-col items-center gap-1 flex-1 ${activeTab==='map'?'text-[#95C2E2]':'text-slate-300'}`}>
              <MapIcon size={20} /><span className="text-[10px] font-bold">发现</span>
            </button>
            <button onClick={() => setActiveTab('favorites')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab==='favorites'?'text-[#95C2E2]':'text-slate-300'}`}>
              <Heart size={20} /><span className="text-[10px] font-bold">收藏</span>
            </button>
            <button onClick={() => setActiveTab('lists')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab==='lists'?'text-[#95C2E2]':'text-slate-300'}`}>
              <Navigation size={20} /><span className="text-[10px] font-bold">行程</span>
            </button>
            <button onClick={() => setActiveTab('memo')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab==='memo'?'text-[#95C2E2]':'text-slate-300'}`}>
              <ClipboardList size={20} /><span className="text-[10px] font-bold">备忘</span>
            </button>
            <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center gap-1 flex-1 ${activeTab==='profile'?'text-[#95C2E2]':'text-slate-300'}`}>
              <User size={20} /><span className="text-[10px] font-bold">我的</span>
            </button>
          </div>
        </div>

        {/* ===================== 弹窗组件群 ===================== */}
        
        {/* 城市选择面板 */}
        {showCityPicker && (
          <div className="fixed inset-0 z-[130] flex items-end bg-black/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full h-[80vh] rounded-t-3xl flex flex-col pb-safe animate-in slide-in-from-bottom-full">
               <div className="px-6 py-5 flex items-center justify-between border-b border-gray-50">
                  <h3 className="text-xl font-bold">选择城市</h3>
                  <button onClick={() => setShowCityPicker(false)} className="p-2 bg-gray-50 rounded-full"><X size={18}/></button>
               </div>
               <div className="flex-1 overflow-y-auto p-6">
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

        {/* 新建行程弹窗 */}
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
                    setTrips([{ id: Date.now().toString(), name: newTripName.trim(), places: [], memos: [] }, ...trips]);
                    setNewTripModalVisible(false);
                    setNewTripName('');
                  }
                }}>确认创建</button>
              </div>
            </div>
          </div>
        )}

        {/* 路线规划结果弹窗 */}
        {showRoutePanel && activeTripId && (
          <div className="fixed inset-0 z-[120] flex flex-col bg-white animate-in slide-in-from-bottom-full">
            <div className="px-6 py-5 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur z-20 border-b border-gray-50">
               <div>
                 <h2 className="text-xl font-bold">路线规划</h2>
               </div>
               <button onClick={() => setShowRoutePanel(false)} className="p-2 bg-gray-50 rounded-full"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto pb-10">
              <div className="p-6 pb-2">
                 <RealMap 
                   // 判断是智能路线（根据当前城市收藏）还是普通的自定义行程
                   places={activeTripId === 'smart-route' 
                     ? savedPlaces.filter(p => p.city === currentCity) 
                     : trips.find(t => t.id === activeTripId)?.places.map(pid => savedPlaces.find(p => p.id === pid)).filter(Boolean) || []} 
                   isRoute={true} 
                   mapStatus={mapStatus} 
                   currentCity={currentCity}
                 />
              </div>
            </div>
          </div>
        )}

        {/* 收藏详情弹窗 */}
        {selectedPlace && (
          <div className="fixed inset-0 z-[100] flex items-end bg-black/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full rounded-t-3xl p-6 pb-safe animate-in slide-in-from-bottom-full max-h-[85vh] overflow-y-auto">
               <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-bold pr-4 leading-tight">{safeStr(selectedPlace.name)}</h3>
                  <button onClick={() => setSelectedPlace(null)} className="shrink-0 bg-gray-50 p-2 rounded-full"><X size={20}/></button>
               </div>
               <p className="text-xs text-slate-400 mb-6 flex items-start gap-1">
                 <MapPin size={14} className="shrink-0 mt-0.5" /> 
                 {safeStr(selectedPlace.district)} {safeStr(selectedPlace.address)}
               </p>
               
               {getRecommendations(selectedPlace).length > 0 && (
                 <div className="mb-6">
                    <h4 className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1"><Sparkles size={14} color="#FCD34D"/> 周边已收藏</h4>
                    <div className="flex gap-2 overflow-x-auto hide-scrollbar">
                       {getRecommendations(selectedPlace).map(r => (
                         <div key={r.id} className="min-w-[120px] bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <div className="text-[11px] font-bold truncate">{safeStr(r.name)}</div>
                            <div className="text-[9px] text-slate-400 mt-1">{(r.distance/1000).toFixed(1)}km</div>
                         </div>
                       ))}
                    </div>
                 </div>
               )}

               <button 
                onClick={() => handleSavePlace(selectedPlace)}
                className="w-full py-4 rounded-2xl text-white font-bold shadow-lg active:scale-95 transition-transform"
                style={{ backgroundColor: COLORS.primary }}
               >
                 加入收藏夹
               </button>
            </div>
          </div>
        )}

      </div>
      <style>{`.pb-safe{padding-bottom:env(safe-area-inset-bottom)}.pt-safe{padding-top:env(safe-area-inset-top)}.hide-scrollbar::-webkit-scrollbar{display:none}`}</style>
    </div>
  );
}