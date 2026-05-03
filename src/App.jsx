import React, { useState, useEffect, useRef } from 'react';
import { 
  Map as MapIcon, List, User, Search, MapPin, Plus, Heart, 
  Navigation, Calendar, CheckCircle2, Circle, 
  ChevronRight, ArrowRight, X, Sparkles, Trash2, ClipboardList,
  Mail, KeyRound, Loader2, LogOut, AlertCircle, ChevronDown, ChevronLeft, LocateFixed
} from 'lucide-react';

// ==========================================
// 1. 安全配置
// ==========================================
// ⚠️ 注意：为了在当前网页预览中不报错，我暂时将 import.meta.env 改回了直接填写。
// 当您复制这段代码到本地 VS Code 时，为了安全，请将这四个值重新改回：
// import.meta.env.VITE_AMAP_KEY
// import.meta.env.VITE_AMAP_JSCODE
// import.meta.env.VITE_SUPABASE_URL
// import.meta.env.VITE_SUPABASE_KEY

const AMAP_CONFIG = {
  key: import.meta.env.VITE_AMAP_KEY, 
  jscode: import.meta.env.VITE_AMAP_JSCODE,  
};

const SUPABASE_CONFIG = {
  url: import.meta.env.VITE_SUPABASE_URL, 
  key: import.meta.env.VITE_SUPABASE_KEY, 
};

// 正式开启云端同步
const ENABLE_DB_SYNC = true; 

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

const HOT_CITIES = ['北京', '上海', '广州', '深圳', '成都', '重庆', '杭州', '西安', '武汉', '长春', '长沙', '南京'];

const safeStr = (val) => {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return '';
};

// ==========================================
// 地图核心组件
// ==========================================
const RealMap = ({ places = [], isRoute = false, mapStatus, mapErrorMsg, currentCity }) => {
  const containerRef = useRef(null);
  const mapInstance = useRef(null);

  useEffect(() => {
    if (mapStatus === 'success' && containerRef.current && window.AMap?.Map) {
      try {
        if (!mapInstance.current) {
          mapInstance.current = new window.AMap.Map(containerRef.current, {
            zoom: 11,
            mapStyle: 'amap://styles/normal'
          });
        }
        
        const map = mapInstance.current;
        map.clearMap(); 

        if (places.length === 0 && currentCity !== '全国') {
          map.setCity(currentCity);
        }

        places.forEach((p, idx) => {
          if (p.location) {
             const marker = new window.AMap.Marker({
               position: [p.location.lng, p.location.lat],
               label: { content: String(isRoute ? idx + 1 : safeStr(p.name)), direction: 'top' }
             });
             map.add(marker);
          }
        });

        if (isRoute && places.length >= 2 && window.AMap.Driving) {
          const driving = new window.AMap.Driving({ map, hideMarkers: true });
          const path = places.filter(p => p.location).map(p => [p.location.lng, p.location.lat]);
          if (path.length >= 2) driving.search(path[0], path[path.length - 1], { waypoints: path.slice(1, -1) });
        }

        if (places.length > 0) {
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
  
  // 地图加载状态监控
  const [mapStatus, setMapStatus] = useState('loading');
  const [mapErrorMsg, setMapErrorMsg] = useState('');

  // 核心功能状态
  const [activeTab, setActiveTab] = useState('map');
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [trips, setTrips] = useState([]);
  const [globalMemos, setGlobalMemos] = useState([]);
  const [newMemoText, setNewMemoText] = useState('');
  
  const [currentCity, setCurrentCity] = useState('全国');
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

  // 初始化加载：高德地图 & Supabase 状态
  useEffect(() => {
    // 1. 高德加载
    if (!AMAP_CONFIG.key || !AMAP_CONFIG.jscode) {
      setMapStatus('no-key');
    } else {
      window._AMapSecurityConfig = { securityJsCode: AMAP_CONFIG.jscode };
      const mapScript = document.createElement('script');
      window._amapInitCallback = () => {
        if (window.AMap) {
           setMapStatus('success');
           window.AMap.plugin('AMap.Geolocation', function() {
             var geolocation = new window.AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000 });
             geolocation.getCityInfo((status, result) => {
                 if(status === 'complete' && result.city) setCurrentCity(result.city.replace('市', ''));
             });
           });
        } else {
           setMapStatus('error');
           setMapErrorMsg('脚本加载成功但 AMap 对象不存在');
        }
      };
      mapScript.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_CONFIG.key}&plugin=AMap.AutoComplete,AMap.PlaceSearch,AMap.GeometryUtil,AMap.Driving,AMap.Geolocation&callback=_amapInitCallback`;
      mapScript.async = true;
      mapScript.onerror = () => { setMapStatus('error'); setMapErrorMsg('网络请求被拦截，请检查浏览器插件或白名单'); };
      document.head.appendChild(mapScript);
    }

    // 2. Supabase 异步加载 (解决在线预览依赖问题)
    if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.key) {
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

  // 跨设备同步：用户登录后拉取云端数据
  useEffect(() => {
    if (user && supabase && ENABLE_DB_SYNC && !user.is_anonymous) {
      const fetchData = async () => {
        const { data: placesData } = await supabase.from('places').select('*').eq('user_id', user.id);
        if (placesData) setSavedPlaces(placesData);

        const { data: tripsData } = await supabase.from('trips').select('*').eq('user_id', user.id);
        if (tripsData) setTrips(tripsData);

        const { data: memosData } = await supabase.from('memos').select('*').eq('user_id', user.id);
        if (memosData) setGlobalMemos(memosData);
      };
      fetchData();
    }
  }, [user, supabase]);

  // 高德精准搜索逻辑
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mapStatus === 'success' && searchQuery && window.AMap?.AutoComplete) {
        const autoOptions = currentCity !== '全国' ? { city: currentCity, citylimit: true } : { city: '全国' };
        if (!autoComplete.current) autoComplete.current = new window.AMap.AutoComplete(autoOptions);
        else {
           autoComplete.current.setCity(currentCity !== '全国' ? currentCity : '全国');
           autoComplete.current.setCityLimit(currentCity !== '全国');
        }
        autoComplete.current.search(searchQuery, (status, result) => {
          if (status === 'complete' && result?.tips) setSearchResults(result.tips.filter(item => item && item.location));
          else setSearchResults([]);
        });
      } else setSearchResults([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, mapStatus, currentCity]);

  // 云端操作 Helpers
  const syncToDB = async (table, data) => {
    if (!supabase || !ENABLE_DB_SYNC || !user || user.is_anonymous) return;
    try { await supabase.from(table).upsert({ ...data, user_id: user.id }); } 
    catch (err) { console.error('DB Sync Error:', err); }
  };

  const syncDeleteFromDB = async (table, id) => {
    if (!supabase || !ENABLE_DB_SYNC || !user || user.is_anonymous) return;
    try { await supabase.from(table).delete().eq('id', id).eq('user_id', user.id); } 
    catch (err) { console.error('DB Delete Error:', err); }
  };

  // 鉴权操作
  const handleSendOtp = async () => {
    if (!supabase) return setAuthMessage('请确保配置了 Supabase 密钥');
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
    if (error) setAuthMessage('游客登录失败，请确保在后台开启了 Anonymous 登录');
    setAuthLoading(false);
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null); setOtpSent(false); setEmail(''); setOtp(''); setAuthMessage('');
    // 清空本地状态
    setSavedPlaces([]); setTrips([]); setGlobalMemos([]);
  };

  // 核心业务功能
  const exitSearch = () => { setIsSearching(false); setSearchQuery(''); setSearchResults([]); };
  const selectCity = (city) => { setCurrentCity(city); setShowCityPicker(false); setCustomCityInput(''); };

  const handleSavePlace = (placeData) => {
    const newPlace = {
      id: placeData.id || Date.now().toString(),
      name: safeStr(placeData.name) || '未知地点',
      location: placeData.location,
      category: safeStr(placeData.category) || '景点',
      address: safeStr(placeData.address) || '',
      desc: safeStr(placeData.district) || '地理位置',
      savedAt: Date.now()
    };
    setSavedPlaces(prev => {
      const exists = prev.find(p => p.id === newPlace.id);
      return exists ? prev.map(p => p.id === newPlace.id ? newPlace : p) : [newPlace, ...prev];
    });
    syncToDB('places', newPlace);
    setSelectedPlace(null);
    exitSearch(); 
  };

  const getRecommendations = (place) => {
    if (!place || !place.location || !window.AMap?.GeometryUtil) return [];
    const p1 = [place.location.lng, place.location.lat];
    return savedPlaces
      .filter(p => p.id !== place.id && p.location)
      .map(p => {
        const p2 = [p.location.lng, p.location.lat];
        return { ...p, distance: window.AMap.GeometryUtil.distance(p1, p2) };
      })
      .filter(p => p.distance < 5000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
  };

  const handleAddMemo = () => {
    if (newMemoText.trim()) {
      const newMemo = { id: Date.now().toString(), text: newMemoText.trim(), done: false };
      setGlobalMemos([newMemo, ...globalMemos]);
      syncToDB('memos', newMemo);
      setNewMemoText('');
    }
  };

  const handleDeleteMemo = (id) => {
    setGlobalMemos(globalMemos.filter(m => m.id !== id));
    syncDeleteFromDB('memos', id);
  };

  // UI 渲染 - 登录页
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

  // UI 渲染 - 主应用
  return (
    <div className="min-h-[100dvh] w-full flex justify-center bg-gray-100 sm:bg-[#f0f4f8]">
      <div className="w-full sm:max-w-md h-[100dvh] flex flex-col relative bg-white overflow-hidden shadow-2xl">
        
        <div className="absolute top-0 w-full h-40" style={{ background: `linear-gradient(to bottom, ${COLORS.bg}, white)` }}></div>
        <div className="h-12 shrink-0 pt-safe z-10"></div>

        <div className="flex-1 relative z-10 flex flex-col overflow-hidden">
          
          {/* 发现页面 */}
          {activeTab === 'map' && (
            <div className="flex-1 flex flex-col animate-in fade-in">
              <div className="px-6 shrink-0">
                {!isSearching && <h2 className="text-2xl font-bold mb-4" style={{ color: COLORS.textDark }}>发现地点</h2>}
                
                <div className="flex items-center gap-3 mb-6">
                  {isSearching ? (
                    <button onClick={exitSearch} className="p-2 -ml-2 rounded-full hover:bg-gray-100 active:scale-95 transition-all text-slate-600 shrink-0">
                      <ChevronLeft size={24} />
                    </button>
                  ) : (
                    <div onClick={() => setShowCityPicker(true)} className="flex items-center gap-1 font-bold text-slate-700 cursor-pointer shrink-0 max-w-[80px]">
                      <span className="truncate text-base">{currentCity}</span>
                      <ChevronDown size={16} />
                    </div>
                  )}

                  <div className="flex-1 relative transition-all">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      className="w-full pl-10 pr-4 py-3 rounded-full bg-white shadow-sm border border-gray-100 outline-none text-sm focus:ring-2 transition-all"
                      placeholder={mapStatus === 'success' ? "搜索地点 / 酒店 / 景点..." : "请先配置高德 API 密钥"}
                      value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onFocus={() => setIsSearching(true)}
                      disabled={mapStatus !== 'success'} style={{ '--tw-ring-color': COLORS.light }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-24">
                {isSearching ? (
                  <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4">
                    {searchQuery.length === 0 ? (
                      <div className="text-center py-20 text-slate-400 text-sm flex flex-col items-center">
                        <MapIcon size={32} className="mb-2 text-slate-200" />输入地点名称开始搜索
                      </div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map(p => (
                        <div key={p.id} onClick={() => setSelectedPlace(p)} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex justify-between items-center active:scale-95 transition-transform cursor-pointer">
                          <div className="pr-4 overflow-hidden">
                            <h4 className="font-bold text-base text-slate-700 truncate">{safeStr(p.name)}</h4>
                            <p className="text-[11px] text-slate-400 mt-1.5 truncate flex items-center gap-1"><MapPin size={10}/> {safeStr(p.district)} {safeStr(p.address)}</p>
                          </div>
                          <Plus size={20} color={COLORS.primary} className="shrink-0 bg-blue-50 p-1 rounded-full" />
                        </div>
                      ))
                    ) : <div className="text-center py-10 text-slate-400 text-sm">未找到相关地点，请尝试其他关键词</div>}
                  </div>
                ) : (
                  <div className="animate-in fade-in">
                    <RealMap places={savedPlaces} mapStatus={mapStatus} mapErrorMsg={mapErrorMsg} currentCity={currentCity} />
                    {savedPlaces.length === 0 && mapStatus === 'success' && (
                      <div className="bg-white p-4 rounded-2xl text-center text-xs text-slate-500 shadow-sm flex items-center justify-center gap-2"><LocateFixed size={14}/> 尝试在上方搜索框寻找想去的地方吧</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 行程页面 */}
          {activeTab === 'lists' && (
            <div className="h-full flex flex-col px-6 animate-in fade-in">
               <div className="flex justify-between items-center py-4">
                  <h2 className="text-2xl font-bold">我的行程</h2>
                  <button onClick={() => setNewTripModalVisible(true)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm active:scale-95"><Plus size={20} color={COLORS.primary}/></button>
               </div>
               <div className="flex-1 overflow-y-auto pb-24 space-y-4">
                  {trips.length === 0 ? (
                    <div className="text-center py-10 text-sm text-slate-400 mt-10">还没创建行程，点击右上角加号创建吧</div>
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

          {/* 备忘页面 */}
          {activeTab === 'memo' && (
            <div className="h-full flex flex-col animate-in fade-in bg-[#f0f4f8]">
               <div className="px-6 py-5 bg-white shadow-sm z-10 shrink-0">
                 <h2 className="text-2xl font-bold">出行备忘录</h2>
                 <p className="text-xs mt-1 font-medium text-slate-400">记录你的通用出行装备与事项</p>
               </div>
               <div className="px-6 py-4 shrink-0 mt-2">
                 <div className="flex gap-2 bg-white p-2 rounded-2xl shadow-sm border border-gray-50">
                    <input type="text" value={newMemoText} onChange={e => setNewMemoText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddMemo()} placeholder="添加新备忘 (如: 遮阳帽)..." className="flex-1 px-3 py-2 text-sm outline-none bg-transparent" />
                    <button onClick={handleAddMemo} className="w-10 h-10 rounded-xl flex items-center justify-center text-white active:scale-95 transition-transform shrink-0" style={{ backgroundColor: COLORS.primary }}><Plus size={20} /></button>
                 </div>
               </div>
               <div className="flex-1 overflow-y-auto px-6 pb-24 space-y-3">
                  {globalMemos.length === 0 ? (
                    <div className="text-center py-10 text-sm text-slate-400">备忘录空空如也，添加一些物品吧</div>
                  ) : (
                    globalMemos.map(m => (
                      <div key={m.id} className="bg-white p-4 rounded-2xl shadow-sm flex items-center justify-between border border-gray-50 transition-transform">
                         <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => {
                             const updatedMemo = {...m, done: !m.done};
                             setGlobalMemos(globalMemos.map(g => g.id === m.id ? updatedMemo : g));
                             syncToDB('memos', updatedMemo);
                         }}>
                            {m.done ? <CheckCircle2 size={20} color={COLORS.primary}/> : <Circle size={20} color={COLORS.textLight}/>}
                            <span className={`text-sm font-medium ${m.done ? 'line-through text-slate-300' : 'text-slate-700'}`}>{safeStr(m.text)}</span>
                         </div>
                         <button onClick={() => handleDeleteMemo(m.id)} className="p-2 ml-2 text-gray-300 hover:text-red-400 active:scale-95 transition-all rounded-full hover:bg-red-50"><Trash2 size={16} /></button>
                      </div>
                    ))
                  )}
               </div>
            </div>
          )}

          {/* 我的页面 */}
          {activeTab === 'profile' && (
            <div className="h-full flex flex-col items-center justify-center animate-in fade-in px-6">
              <div className="w-20 h-20 rounded-full mb-4 shadow-md flex items-center justify-center bg-white border-4 border-white"><User size={32} color={COLORS.primary} /></div>
              <h2 className="text-xl font-bold text-slate-800">{user.is_anonymous ? '游客' : (user.email || '旅行者')}</h2>
              <div className="mt-8 w-full bg-gray-50 rounded-3xl p-4 space-y-2 border border-gray-100">
                <div className="flex justify-between items-center p-3 bg-white rounded-2xl shadow-sm">
                   <span className="text-sm font-bold text-gray-700">地图状态</span>
                   <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${mapStatus === 'success' ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>{mapStatus === 'success' ? '已连接' : '未连接/异常'}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-white rounded-2xl shadow-sm">
                   <span className="text-sm font-bold text-gray-700">云端同步</span>
                   <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${supabase && !user.is_anonymous ? 'text-blue-600 bg-blue-50' : 'text-slate-400 bg-slate-100'}`}>{supabase && !user.is_anonymous ? '已连接 Supabase' : '本地离线模式'}</span>
                </div>
              </div>
              <button onClick={handleLogout} className="mt-12 py-3 px-6 rounded-2xl bg-red-50 text-red-500 font-bold text-sm shadow-sm transition-transform active:scale-95 flex items-center gap-2"><LogOut size={16} />退出账号 / 返回登录</button>
            </div>
          )}
        </div>

        {/* 底部导航 */}
        <div className="shrink-0 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.03)] rounded-t-3xl z-30 pb-safe px-4 relative">
          <div className="flex justify-around items-center h-16">
            <button onClick={() => {setActiveTab('map'); setIsSearching(false);}} className={`flex flex-col items-center gap-1 ${activeTab==='map'?'text-[#95C2E2]':'text-slate-300'}`}><MapIcon size={20} /><span className="text-[10px] font-bold">发现</span></button>
            <button onClick={() => setActiveTab('lists')} className={`flex flex-col items-center gap-1 ${activeTab==='lists'?'text-[#95C2E2]':'text-slate-300'}`}><List size={20} /><span className="text-[10px] font-bold">行程</span></button>
            <button onClick={() => setActiveTab('memo')} className={`flex flex-col items-center gap-1 ${activeTab==='memo'?'text-[#95C2E2]':'text-slate-300'}`}><ClipboardList size={20} /><span className="text-[10px] font-bold">备忘</span></button>
            <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center gap-1 ${activeTab==='profile'?'text-[#95C2E2]':'text-slate-300'}`}><User size={20} /><span className="text-[10px] font-bold">我的</span></button>
          </div>
        </div>

        {/* 城市选择面板 */}
        {showCityPicker && (
          <div className="fixed inset-0 z-[130] flex items-end bg-black/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full h-[80vh] rounded-t-3xl flex flex-col pb-safe animate-in slide-in-from-bottom-full">
               <div className="px-6 py-5 flex items-center justify-between border-b border-gray-50"><h3 className="text-xl font-bold">选择城市</h3><button onClick={() => setShowCityPicker(false)} className="p-2 bg-gray-50 rounded-full"><X size={18}/></button></div>
               <div className="flex-1 overflow-y-auto p-6">
                 <div className="flex gap-2 mb-8">
                    <input type="text" value={customCityInput} onChange={e=>setCustomCityInput(e.target.value)} placeholder="输入城市名，如：沈阳" className="flex-1 px-4 py-3 rounded-xl bg-gray-50 border-none outline-none text-sm" />
                    <button onClick={() => {if(customCityInput) selectCity(customCityInput)}} className="px-5 rounded-xl text-white font-bold text-sm" style={{ backgroundColor: COLORS.primary }}>确定</button>
                 </div>
                 <h4 className="text-sm font-bold text-slate-400 mb-4">热门城市</h4>
                 <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => selectCity('全国')} className={`py-3 rounded-xl font-bold text-sm ${currentCity === '全国' ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-slate-600'}`}>全国</button>
                    {HOT_CITIES.map(city => <button key={city} onClick={() => selectCity(city)} className={`py-3 rounded-xl font-bold text-sm active:scale-95 transition-all ${currentCity === city ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-slate-600'}`}>{city}</button>)}
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
              <input type="text" autoFocus placeholder="例如：周末散心之旅" className="w-full px-4 py-3 rounded-xl bg-gray-50 border-none outline-none text-sm mb-6 focus:ring-2" style={{ '--tw-ring-color': COLORS.light }} value={newTripName} onChange={e => setNewTripName(e.target.value)} />
              <div className="flex gap-3">
                <button className="flex-1 py-3 rounded-xl bg-gray-100 text-sm font-bold text-slate-600 active:scale-95" onClick={() => { setNewTripModalVisible(false); setNewTripName(''); }}>取消</button>
                <button className="flex-1 py-3 rounded-xl text-white text-sm font-bold active:scale-95 disabled:opacity-50" style={{ backgroundColor: COLORS.primary }} disabled={!newTripName.trim()} onClick={() => {
                  if (newTripName.trim()) {
                    const newTrip = { id: Date.now().toString(), name: newTripName.trim(), places: [], memos: [] };
                    setTrips([newTrip, ...trips]);
                    syncToDB('trips', newTrip);
                    setNewTripModalVisible(false);
                    setNewTripName('');
                  }
                }}>确认创建</button>
              </div>
            </div>
          </div>
        )}

        {/* 路线规划 */}
        {showRoutePanel && activeTripId && (
          <div className="fixed inset-0 z-[120] flex flex-col bg-white animate-in slide-in-from-bottom-full">
            <div className="px-6 py-5 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur z-20 border-b border-gray-50">
               <h2 className="text-xl font-bold">智能路线规划</h2>
               <button onClick={() => setShowRoutePanel(false)} className="p-2 bg-gray-50 rounded-full"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto pb-10">
              <div className="p-6 pb-2">
                 <RealMap places={trips.find(t => t.id === activeTripId)?.places.map(pid => savedPlaces.find(p => p.id === pid)).filter(Boolean) || []} isRoute={true} mapStatus={mapStatus} currentCity={currentCity} />
              </div>
            </div>
          </div>
        )}

        {/* 收藏详情 */}
        {selectedPlace && (
          <div className="fixed inset-0 z-[100] flex items-end bg-black/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full rounded-t-3xl p-6 pb-safe animate-in slide-in-from-bottom-full max-h-[85vh] overflow-y-auto">
               <div className="flex justify-between items-start mb-4"><h3 className="text-xl font-bold pr-4 leading-tight">{safeStr(selectedPlace.name)}</h3><button onClick={() => setSelectedPlace(null)} className="shrink-0 bg-gray-50 p-2 rounded-full"><X size={20}/></button></div>
               <p className="text-xs text-slate-400 mb-6 flex items-start gap-1"><MapPin size={14} className="shrink-0 mt-0.5" /> {safeStr(selectedPlace.district)} {safeStr(selectedPlace.address)}</p>
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
               <button onClick={() => handleSavePlace(selectedPlace)} className="w-full py-4 rounded-2xl text-white font-bold shadow-lg active:scale-95 transition-transform" style={{ backgroundColor: COLORS.primary }}>加入收藏夹</button>
            </div>
          </div>
        )}
      </div>
      <style>{`.pb-safe{padding-bottom:env(safe-area-bottom)}.pt-safe{padding-top:env(safe-area-top)}.hide-scrollbar::-webkit-scrollbar{display:none}`}</style>
    </div>
  );
}