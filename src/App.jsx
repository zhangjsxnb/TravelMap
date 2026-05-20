import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
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

const toAMapLngLat = (loc) => {
  const coords = getLngLat(loc);
  if (!coords || !window.AMap?.LngLat) return coords;
  return new window.AMap.LngLat(coords[0], coords[1]);
};

const escapeRegExp = (value) => safeStr(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeDistrictText = (district) => safeStr(district).replace(/\s+/g, '').trim();

const stripDistrictPrefix = (address, district) => {
  const rawAddress = safeStr(address).trim();
  const normalizedDistrict = normalizeDistrictText(district);
  if (!rawAddress || !normalizedDistrict) return rawAddress;

  const compactAddress = rawAddress.replace(/\s+/g, '');
  if (compactAddress.startsWith(normalizedDistrict)) {
    const remaining = compactAddress.slice(normalizedDistrict.length).trim();
    return remaining || rawAddress;
  }

  const districtPattern = new RegExp(`^${escapeRegExp(normalizedDistrict)}[\\s,-]*`, 'i');
  return rawAddress.replace(districtPattern, '').trim() || rawAddress;
};

const normalizePlaceLocation = (location) => {
  const coords = getLngLat(location);
  return coords ? { lng: coords[0], lat: coords[1] } : null;
};

const normalizeAddressText = (placeData) => {
  const district = safeStr(placeData?.district).trim();
  const address = stripDistrictPrefix(placeData?.address, district);
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

const isPlaceholderAddress = (value) => /^(地图标记地点|地址待补全)$/.test(safeStr(value).trim());

const isPlaceholderPlaceName = (value) => /^(地图选点|地图标记地点|未知地点)$/.test(safeStr(value).trim());

const derivePlaceName = (placeData = {}, existingPlace = null) => {
  const candidates = [
    placeData?.name,
    existingPlace?.name,
    placeData?.address,
    existingPlace?.address,
    placeData?.district,
    existingPlace?.district,
  ];

  for (const candidate of candidates) {
    const text = safeStr(candidate).trim();
    if (!text) continue;
    if (!isPlaceholderPlaceName(text) && !isPlaceholderAddress(text)) return text;
  }

  const mergedAddress = safeMergeAddress(placeData?.district || existingPlace?.district, placeData?.address || existingPlace?.address);
  if (mergedAddress && !isPlaceholderAddress(mergedAddress)) return mergedAddress;

  return '未知地点';
};

const normalizeSavedPlaceRecord = (placeData, fallbackCity = '', existingPlace = null) => {
  const nextDistrict = safeStr(placeData?.district || existingPlace?.district).trim();
  const rawAddress = stripDistrictPrefix(
    safeStr(placeData?.address) || safeStr(existingPlace?.address),
    nextDistrict,
  );
  const displayAddress = normalizeAddressText({
    district: nextDistrict,
    address: rawAddress,
  });

  return {
    id: safeStr(placeData?.id) || safeStr(existingPlace?.id) || Date.now().toString(),
    name: derivePlaceName(placeData, existingPlace),
    location: normalizePlaceLocation(placeData?.location || existingPlace?.location),
    category: safeStr(placeData?.category) || safeStr(existingPlace?.category) || '景点',
    address: displayAddress,
    district: nextDistrict,
    city: inferCityName({ ...existingPlace, ...placeData, district: nextDistrict }, fallbackCity || safeStr(existingPlace?.city)),
    savedAt: Number(placeData?.savedAt || existingPlace?.savedAt) || Date.now(),
  };
};

const normalizeSearchCandidate = (item, fallbackCity = '') => {
  if (!item) return null;
  const location = normalizePlaceLocation(item.location);
  const district = safeStr(item?.district).trim();
  const address = stripDistrictPrefix(safeStr(item?.address), district);
  return {
    ...item,
    id: safeStr(item?.id) || (location ? `${safeStr(item?.name)}_${location.lng}_${location.lat}` : safeStr(item?.name)),
    name: safeStr(item?.name),
    address,
    district,
    category: safeStr(item?.category || item?.type) || '地点',
    location,
    city: inferCityName({ ...item, district }, fallbackCity),
  };
};

const extractPoiAddress = (poi) => ({
  district: `${safeStr(poi?.pname)}${safeStr(poi?.cityname)}${safeStr(poi?.adname)}`,
  address: safeStr(poi?.address),
  city: safeStr(poi?.cityname),
  name: safeStr(poi?.name),
  location: poi?.location ? normalizePlaceLocation({ lng: poi.location.lng, lat: poi.location.lat }) : null,
});

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

const getSuggestedViewport = (places = []) => {
  const coords = places
    .map((place) => getLngLat(place?.location))
    .filter((item) => Array.isArray(item) && item.length === 2);

  if (coords.length === 0) return null;

  const lngs = coords.map(([lng]) => Number(lng));
  const lats = coords.map(([, lat]) => Number(lat));
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const span = Math.max(maxLng - minLng, maxLat - minLat);

  let zoom = 10;
  if (coords.length === 1 || span <= 0.01) zoom = 15;
  else if (span <= 0.03) zoom = 14;
  else if (span <= 0.08) zoom = 13;
  else if (span <= 0.2) zoom = 12;
  else if (span <= 0.5) zoom = 11;

  return {
    zoom,
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
  };
};

const STAY_PICKER_HOURS = Array.from({ length: 13 }, (_, index) => index);
const STAY_PICKER_MINUTES = [0, 15, 30, 45];

const normalizeStayMinute = (value) => (
  Math.max(15, Math.min(24 * 60, Math.round(Number(value) || 0)))
);

const toStayPickerValue = (totalMinute) => {
  const normalized = normalizeStayMinute(totalMinute);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return {
    hour,
    minute: STAY_PICKER_MINUTES.includes(minute) ? minute : 0,
  };
};

const buildSegmentCacheKey = ({ start, end, mode, city }) => {
  const startText = Array.isArray(start) ? `${start[0]},${start[1]}` : 'no_start';
  const endText = Array.isArray(end) ? `${end[0]},${end[1]}` : 'no_end';
  return `${startText}__${endText}__${mode}__${safeStr(city)}`;
};

const inferRouteCity = (startPlace, endPlace, fallbackCity) => {
  const startCity = inferCityName(startPlace, fallbackCity);
  const endCity = inferCityName(endPlace, fallbackCity);
  if (startCity && endCity && startCity === endCity) return startCity;
  if (startCity) return startCity;
  if (endCity) return endCity;
  return fallbackCity === '全国' ? '北京' : fallbackCity;
};

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

const normalizeTripsList = (list = []) => Array.isArray(list) ? list.map(normalizeTrip).filter(Boolean) : [];

const mergeTripLists = (localTrips = [], cloudTrips = []) => {
  const merged = new Map();
  normalizeTripsList(localTrips).forEach((trip) => {
    merged.set(trip.id, trip);
  });
  normalizeTripsList(cloudTrips).forEach((trip) => {
    merged.set(trip.id, trip);
  });
  return Array.from(merged.values());
};

const areCoordsEqual = (a, b, tolerance = 0.000001) => (
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === 2 &&
  b.length === 2 &&
  Math.abs(Number(a[0]) - Number(b[0])) <= tolerance &&
  Math.abs(Number(a[1]) - Number(b[1])) <= tolerance
);

const buildPlacesSignature = (places = [], isRoute = false) => places
  .map((place, index) => {
    const coords = getLngLat(place?.location);
    return [
      safeStr(place?.id) || `idx_${index}`,
      isRoute ? index + 1 : safeStr(place?.name),
      coords ? `${coords[0]},${coords[1]}` : 'no_coords',
    ].join(':');
  })
  .join('|');

const buildMarkerKey = (place, index, isRoute) => {
  const coords = getLngLat(place?.location);
  return [
    safeStr(place?.id) || `idx_${index}`,
    isRoute ? `route_${index + 1}` : `spot_${safeStr(place?.name)}`,
    coords ? `${coords[0].toFixed(6)},${coords[1].toFixed(6)}` : 'no_coords',
  ].join('::');
};

const createMarkerContent = (labelText) => `
  <div style="position:relative;display:flex;align-items:flex-start;justify-content:center;width:32px;height:44px;overflow:visible;">
    <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);min-width:18px;height:18px;padding:0 4px;border:2px solid #4C6FFF;border-radius:2px;background:#FFFFFF;color:#1F2937;font-size:12px;font-weight:700;line-height:14px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;white-space:nowrap;">
      ${String(labelText ?? '')}
    </div>
    <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:18px;height:24px;background:linear-gradient(180deg,#5EA7FF 0%,#347DFF 100%);border-radius:9px 9px 9px 0;rotate:-45deg;box-shadow:0 4px 10px rgba(52,125,255,0.22);"></div>
    <div style="position:absolute;left:50%;bottom:10px;transform:translateX(-50%);width:8px;height:8px;border-radius:9999px;background:#FFFFFF;"></div>
  </div>
`;

// ==========================================
// 地图核心组件
// ==========================================
const RealMapBase = ({ places = [], isRoute = false, mapStatus, mapErrorMsg, currentCity, onMarkerClick, onMapClick, lockViewport = true, mapView, onMapViewChange, routeSegments = [], className = '', heightClassName = '', visible = true }) => {
  const containerRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef(new Map());
  const polylinesRef = useRef([]);
  const prevCityRef = useRef('');
  const markerClickRef = useRef(onMarkerClick);
  const mapClickRef = useRef(onMapClick);
  const mapViewChangeRef = useRef(onMapViewChange);
  const debounceRef = useRef(null);
  const isUserInteractingRef = useRef(false);
  const suppressViewSyncRef = useRef(false);
  const lastAutoFitSignatureRef = useRef('');
  const hasUserAdjustedViewRef = useRef(false);

  // 始终保持回调最新，不触发重渲染
  useEffect(() => {
    markerClickRef.current = onMarkerClick;
    mapClickRef.current = onMapClick;
    mapViewChangeRef.current = onMapViewChange;
  }, [onMarkerClick, onMapClick, onMapViewChange]);

  useEffect(() => {
    if (!visible || !mapInstance.current) return;
    const timer = setTimeout(() => {
      try {
        mapInstance.current?.resize?.();
      } catch (err) {
        console.error('Map resize error:', err);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [visible]);

  // 第一个useEffect：只负责初始化地图实例，只跑一次
  useEffect(() => {
    if (mapStatus !== 'success' || !containerRef.current || !window.AMap?.Map) return;
    if (mapInstance.current) return;

    try {
      mapInstance.current = new window.AMap.Map(containerRef.current, {
        zoom: mapView?.zoom || 13,
        center: mapView?.center || undefined,
        mapStyle: 'amap://styles/normal',
        isHotspot: true,
      });

      const handleViewChange = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const zoom = mapInstance.current?.getZoom?.();
          const center = mapInstance.current?.getCenter?.();
          if (typeof zoom === 'number' && center && mapViewChangeRef.current) {
            hasUserAdjustedViewRef.current = true;
            suppressViewSyncRef.current = true;
            mapViewChangeRef.current({ zoom, center: [center.lng, center.lat] });
            setTimeout(() => { suppressViewSyncRef.current = false; }, 0);
          }
        }, 500);
      };

      mapInstance.current.on('dragstart', () => { isUserInteractingRef.current = true; });
      mapInstance.current.on('dragend', () => { isUserInteractingRef.current = false; handleViewChange(); });
      mapInstance.current.on('zoomend', () => { isUserInteractingRef.current = false; handleViewChange(); });
      mapInstance.current.on('hotspotclick', (e) => {
        if (markerClickRef.current) markerClickRef.current({ id: e.id, name: e.name, location: e.lnglat, district: '', address: '地图标记地点' });
      });
      mapInstance.current.on('click', (event) => {
        if (mapClickRef.current) mapClickRef.current(event);
      });
    } catch (err) {
      console.error('Map init error:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStatus]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const map = mapInstance.current;
    if (!map) return;
    try {
      markersRef.current.forEach((marker) => map.remove(marker));
      polylinesRef.current.forEach((polyline) => map.remove(polyline));
      map.destroy?.();
    } catch (err) {
      console.error('Map cleanup error:', err);
    } finally {
      markersRef.current = new Map();
      polylinesRef.current = [];
      mapInstance.current = null;
    }
  }, []);

  // 第二个useEffect：只负责更新城市定位，不重建地图
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !currentCity || prevCityRef.current === currentCity) return;
    prevCityRef.current = currentCity;
    if (!mapView?.center && !isNationwideCity(currentCity) && typeof map.setCity === 'function') {
      map.setCity(currentCity);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCity]);

  // 当外部明确修改 mapView（例如重置视图）时，同步到地图实例
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapView || suppressViewSyncRef.current) return;
    const currentCenter = map.getCenter?.();
    const nextCenter = Array.isArray(mapView.center) && mapView.center.length === 2 ? mapView.center : null;
    const currentZoom = map.getZoom?.();
    const nextZoom = typeof mapView.zoom === 'number' ? mapView.zoom : null;

    if (nextCenter && currentCenter && !areCoordsEqual([currentCenter.lng, currentCenter.lat], nextCenter)) {
      map.setCenter(nextCenter);
    }
    if (typeof nextZoom === 'number' && typeof currentZoom === 'number' && currentZoom !== nextZoom) {
      map.setZoom(nextZoom);
    }
  }, [mapView]);

  // 第三个useEffect：只更新 marker，避免路线返回时反复重建 marker
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (isUserInteractingRef.current) return;

    try {
      const nextMarkerKeys = new Set();
      places.forEach((p, idx) => {
        const position = toAMapLngLat(p.location);
        if (!position) return;
        const markerKey = buildMarkerKey(p, idx, isRoute);
        nextMarkerKeys.add(markerKey);
        const markerLabel = isRoute ? idx + 1 : safeStr(p.name);
        let marker = markersRef.current.get(markerKey);
        if (!marker) {
          marker = new window.AMap.Marker({
            position,
            cursor: markerClickRef.current ? 'pointer' : 'default',
            anchor: 'bottom-center',
            content: createMarkerContent(markerLabel),
            extData: p,
            zIndex: 100 + idx,
          });
          if (markerClickRef.current) marker.on('click', () => markerClickRef.current(marker.getExtData?.() || p));
          map.add(marker);
          markersRef.current.set(markerKey, marker);
        } else {
          marker.setPosition?.(position);
          marker.setContent?.(createMarkerContent(markerLabel));
          marker.setExtData?.(p);
          marker.setzIndex?.(100 + idx);
        }
      });

      Array.from(markersRef.current.entries()).forEach(([markerKey, marker]) => {
        if (nextMarkerKeys.has(markerKey)) return;
        map.remove(marker);
        markersRef.current.delete(markerKey);
      });

      const placesSignature = buildPlacesSignature(places, isRoute);
      const shouldAutoFit = places.length > 0 &&
        (!lockViewport || isRoute) &&
        lastAutoFitSignatureRef.current !== placesSignature &&
        (!hasUserAdjustedViewRef.current || lastAutoFitSignatureRef.current === '');

      if (shouldAutoFit) {
        suppressViewSyncRef.current = true;
        map.setFitView(Array.from(markersRef.current.values()), false, [60, 60, 60, 60]);
        setTimeout(() => { suppressViewSyncRef.current = false; }, 0);
        lastAutoFitSignatureRef.current = placesSignature;
      }
    } catch (err) {
      console.error('Map update error:', err);
    }
  }, [places, isRoute, lockViewport]);

  // 第四个useEffect：只更新连线，不触发 marker 重建或 fitView
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    try {
      polylinesRef.current.forEach(p => map.remove(p));
      polylinesRef.current = [];

      if (!isRoute || places.length < 2) return;

      const validSegments = routeSegments.length === places.length - 1;
      if (validSegments) {
        routeSegments.forEach((segment, i) => {
          const start = toAMapLngLat(places[i]?.location);
          const end = toAMapLngLat(places[i + 1]?.location);
          const directPath = [start, end].filter(Boolean);
          const normalizedSegmentPath = Array.isArray(segment?.path)
            ? segment.path.map((point) => toAMapLngLat(point)).filter(Boolean)
            : [];
          const path = directPath.length >= 2 ? directPath : normalizedSegmentPath;
          if (path.length >= 2) {
            const polyline = new window.AMap.Polyline({
              path,
              geodesic: false,
              showDir: false,
              strokeColor: '#95C2E2',
              strokeWeight: 6,
              strokeOpacity: 0.92,
              lineJoin: 'round',
              lineCap: 'round',
              zIndex: 50,
            });
            map.add(polyline);
            polylinesRef.current.push(polyline);
          }
        });
      } else {
        const path = places.map((p) => toAMapLngLat(p.location)).filter(Boolean);
        if (path.length >= 2) {
          const polyline = new window.AMap.Polyline({
            path,
            geodesic: false,
            showDir: false,
            strokeColor: '#95C2E2',
            strokeWeight: 4,
            strokeOpacity: 0.6,
            strokeDasharray: [10, 5],
            lineJoin: 'round',
            lineCap: 'round',
            zIndex: 50,
          });
          map.add(polyline);
          polylinesRef.current.push(polyline);
        }
      }
    } catch (err) {
      console.error('Map polyline update error:', err);
    }
  }, [places, isRoute, routeSegments]);

  if (mapStatus === 'loading') return <div className="w-full aspect-square bg-blue-50 rounded-3xl flex items-center justify-center text-blue-300 shadow-inner mb-6"><Loader2 className="animate-spin" /></div>;
  if (mapStatus === 'no-key') return <div className="w-full aspect-square bg-gray-50 border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center p-6 text-center shadow-inner mb-6"><MapIcon size={32} className="text-gray-300 mb-3" /><p className="text-sm font-bold text-gray-500 mb-1">尚未配置完整的地图 API</p></div>;
  if (mapStatus === 'error') return <div className="w-full aspect-square bg-red-50 border-2 border-dashed border-red-200 rounded-3xl flex flex-col items-center justify-center p-6 text-center shadow-inner mb-6"><AlertCircle size={32} className="text-red-300 mb-3" /><p className="text-sm font-bold text-red-500 mb-1">地图加载失败</p><p className="text-[10px] text-red-400">{mapErrorMsg}</p></div>;

  return (
    <div className={`w-full min-h-[300px] relative ${className} ${heightClassName}`.trim()} style={{ backgroundColor: COLORS.light }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};

const StayDurationPicker = ({ open, initialMinute, onClose, onConfirm }) => {
  const initialValue = useMemo(() => toStayPickerValue(initialMinute), [initialMinute]);
  const [hour, setHour] = useState(initialValue.hour);
  const [minute, setMinute] = useState(initialValue.minute);

  useEffect(() => {
    if (!open) return;
    setHour(initialValue.hour);
    setMinute(initialValue.minute);
  }, [initialValue, open]);

  if (!open) return null;

  const confirmValue = () => {
    onConfirm(normalizeStayMinute(hour * 60 + minute));
  };

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/35 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-[260px] rounded-[28px] bg-white shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-black text-slate-800">选择停留时间</h3>
            <p className="text-[11px] text-slate-400 mt-1">{formatDurationCn(hour * 60 + minute)}</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 relative">
          <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-14 rounded-2xl border-2 border-slate-900 pointer-events-none" />
          <div className="h-72 overflow-y-auto py-[108px] snap-y snap-mandatory">
            {STAY_PICKER_HOURS.map((value) => {
              const selected = value === hour;
              return (
                <button
                  key={`stay_hour_${value}`}
                  type="button"
                  onClick={() => setHour(value)}
                  className={`h-14 w-full snap-center text-3xl font-black transition-colors ${selected ? 'bg-blue-600 text-white' : 'text-slate-900 hover:bg-slate-50'}`}
                >
                  {String(value).padStart(2, '0')}
                </button>
              );
            })}
          </div>
          <div className="h-72 overflow-y-auto py-[108px] border-l border-slate-200 snap-y snap-mandatory">
            {STAY_PICKER_MINUTES.map((value) => {
              const selected = value === minute;
              return (
                <button
                  key={`stay_minute_${value}`}
                  type="button"
                  onClick={() => setMinute(value)}
                  className={`h-14 w-full snap-center text-3xl font-black transition-colors ${selected ? 'bg-blue-600 text-white' : 'text-slate-900 hover:bg-slate-50'}`}
                >
                  {String(value).padStart(2, '0')}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-2xl bg-slate-100 text-slate-600 font-bold">取消</button>
          <button type="button" onClick={confirmValue} className="flex-1 h-11 rounded-2xl bg-blue-600 text-white font-bold">确定</button>
        </div>
      </div>
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
      return local ? JSON.parse(local).map((item) => normalizeSavedPlaceRecord(item)).filter(Boolean) : [];
    } catch { return []; }
  });
  const deletedPlaceIdsRef = useRef((() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('travel_deleted_place_ids') || '[]').map((id) => safeStr(id)));
    } catch {
      return new Set();
    }
  })());
  
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

  // 统一退出行程重命名态，避免状态残留
  const cancelEditingTrip = () => {
    setEditingTripId(null);
    setEditingTripName('');
  };

  // 仅在点击行程内容区时打开详情，避免和编辑/删除按钮冲突
  const openTripPanel = (tripId) => {
    if (editingTripId) return;
    setActiveTripId(tripId);
    setShowRoutePanel(true);
  };

  const [editingMemoId, setEditingMemoId] = useState(null);
  const [editingMemoText, setEditingMemoText] = useState('');

  const [dayStartTimes] = useState(() => {
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
  const [stayPickerState, setStayPickerState] = useState({ open: false, placeId: '', minute: 90 });
  
  // 分段交通方式配置
  const [segmentModes, setSegmentModes] = useState([]); 
  const [segmentRoutes, setSegmentRoutes] = useState([]); 
  const [isCalculatingSegments, setIsCalculatingSegments] = useState(false);
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
  const routePanelSessionRef = useRef({ tripId: '', day: 0, visible: false });
  const [collapsedCities, setCollapsedCities] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('travel_collapsed_cities') || '{}');
    } catch {
      return {};
    }
  });

  const autoComplete = useRef(null);
  const routeCacheRef = useRef(new Map());
  const segmentRequestSeqRef = useRef(0);
  const searchRequestRef = useRef(0);
  const itinerarySearchRequestRef = useRef(0);
  const favoriteActionTokenRef = useRef(0);
  const repairRequestTokenRef = useRef(0);
  const repairingPlaceIdsRef = useRef(new Set());

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
        const normalizedItem = normalizeSavedPlaceRecord(item, safeStr(item.city) || currentCity);
        map.set(placeIdentityKey(normalizedItem, safeStr(normalizedItem.city) || currentCity), normalizedItem);
      });
      return Array.from(map.values()).sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
    });
  }, [currentCity]);

  const savedPlacesById = useMemo(() => {
    const map = new Map();
    savedPlaces.forEach((place) => {
      map.set(safeStr(place.id), place);
    });
    return map;
  }, [savedPlaces]);

  const cityFilteredPlaces = useMemo(
    () => savedPlaces.filter((place) => isNationwideCity(currentCity) || place.city === currentCity),
    [savedPlaces, currentCity],
  );

  useEffect(() => {
    if (mapView.center) return;
    const suggested = getSuggestedViewport(cityFilteredPlaces);
    if (suggested) setMapView((prev) => (prev.center ? prev : suggested));
  }, [cityFilteredPlaces, mapView.center]);

  const persistDeletedPlaceIds = (nextIds) => {
    deletedPlaceIdsRef.current = new Set(Array.from(nextIds).map((id) => safeStr(id)).filter(Boolean));
    localStorage.setItem('travel_deleted_place_ids', JSON.stringify(Array.from(deletedPlaceIdsRef.current)));
  };

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
              const deletedIds = deletedPlaceIdsRef.current;
              const merged = new Map(prev.map((item) => [item.id, normalizeSavedPlaceRecord(item, safeStr(item.city) || currentCity)]));
              pRes.data
                .filter((item) => !deletedIds.has(safeStr(item.id)))
                .forEach((item) => merged.set(item.id, normalizeSavedPlaceRecord(item, safeStr(item.city) || currentCity, merged.get(item.id))));
              return Array.from(merged.values()).sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
            });
          }
          if (tRes.data) {
            const cloudTrips = normalizeTripsList(tRes.data);
            setTrips((prev) => mergeTripLists(prev, cloudTrips));

            const localTrips = normalizeTripsList(JSON.parse(localStorage.getItem('travel_trips') || '[]'));
            const cloudIds = new Set(cloudTrips.map((trip) => trip.id));
            const missingLocalTrips = localTrips.filter((trip) => !cloudIds.has(trip.id));
            if (missingLocalTrips.length > 0) {
              try {
                await supabase.from('trips').upsert(
                  missingLocalTrips.map((trip) => ({ ...trip, user_id: user.id })),
                );
              } catch (e) {
                logCloudError('Sync local trips to cloud', e);
              }
            }
          }
          if (mRes.data) setGlobalMemos(mRes.data);
        } catch(e) { console.error('Cloud fetch error', e); }
      };
      fetchCloudData();
    }
  }, [user, supabase, currentCity]);

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
          const normalizedItem = normalizeSearchCandidate(item, currentCity);
          if (!normalizedItem?.name) return;
          if (!normalizedItem.location && !safeStr(normalizedItem.address) && !safeStr(normalizedItem.district)) return;
          const key = `${safeStr(normalizedItem.name)}|${safeStr(normalizedItem.address)}|${safeStr(normalizedItem.location?.lng)}|${safeStr(normalizedItem.location?.lat)}`;
          if (seen.has(key)) return;
          seen.add(key);
          mergedResults.push(normalizedItem);
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
          const normalizedItem = normalizeSearchCandidate(item, currentCity);
          if (!normalizedItem?.name) return;
          const key = `${safeStr(normalizedItem.name)}|${safeStr(normalizedItem.address)}|${safeStr(normalizedItem.location?.lng)}|${safeStr(normalizedItem.location?.lat)}`;
          if (seen.has(key)) return;
          seen.add(key);
          mergedResults.push(normalizedItem);
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

  const activeTrip = useMemo(() => (
    activeTripId ? normalizeTrip(trips.find((trip) => trip.id === activeTripId)) : null
  ), [activeTripId, trips]);
  const routeDayCount = Math.max(1, activeTrip?.days?.length || 1);

  useEffect(() => {
    setCurrentRouteDay((prev) => Math.min(Math.max(1, prev), routeDayCount));
  }, [routeDayCount, activeTripId]);

  useEffect(() => {
    setItinerarySearchQuery(null);
    setItinerarySearchResults([]);
    setIsSearchingItinerary(false);
  }, [activeTripId, currentRouteDay, showRoutePanel]);

  const fetchSegmentRoute = useCallback(async ({ startPlace, endPlace, mode }) => {
    const start = getLngLat(startPlace?.location);
    const end = getLngLat(endPlace?.location);
    const routeCity = inferRouteCity(startPlace, endPlace, currentCity);
    const cacheKey = buildSegmentCacheKey({ start, end, mode, city: routeCity });

    if (!start || !end) {
      return { distance: 0, time: 0, path: start && end ? [start, end] : [], mode, pending: false };
    }

    const cached = routeCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const result = await new Promise((resolve) => {
      let searcher;
      const finish = (payload) => {
        try {
          searcher?.clear?.();
        } catch {
          void 0;
        }
        resolve({ ...payload, mode, pending: false });
      };

      try {
        if (mode === 'walking' && window.AMap.Walking) searcher = new window.AMap.Walking();
        else if (mode === 'riding' && window.AMap.Riding) searcher = new window.AMap.Riding();
        else if (mode === 'transit' && window.AMap.Transfer) searcher = new window.AMap.Transfer({ city: routeCity });
        else if (window.AMap.Driving) searcher = new window.AMap.Driving();

        if (!searcher?.search) {
          finish({ distance: 0, time: 0, path: [start, end] });
          return;
        }

        searcher.search(start, end, (status, searchResult) => {
          try {
            if (status === 'complete') {
              let distance = 0;
              let time = 0;
              let path = [];
              if (mode === 'transit' && searchResult?.plans?.length > 0) {
                distance = searchResult.plans[0].distance;
                time = searchResult.plans[0].time;
                path = (searchResult.plans[0].segments || []).flatMap((seg) => [
                  ...(seg.walking?.steps || []).flatMap((step) => step.path || []),
                  ...(seg.transit?.lines || []).flatMap((line) => line.path || []),
                ]);
              } else if (searchResult?.routes?.length > 0) {
                distance = searchResult.routes[0].distance;
                time = searchResult.routes[0].time;
                path = (searchResult.routes[0].steps || []).flatMap((step) => step.path || []);
              }
              finish({ distance, time, path: path.length >= 2 ? path : [start, end] });
              return;
            }

            const dist = window.AMap?.GeometryUtil?.distance?.(start, end) || 0;
            const speed = mode === 'walking' ? 1.2 : mode === 'riding' ? 4 : 10;
            finish({ distance: dist, time: dist / speed, path: [start, end] });
          } catch {
            finish({ distance: 0, time: 0, path: [start, end] });
          }
        });
      } catch {
        finish({ distance: 0, time: 0, path: [start, end] });
      }
    });

    routeCacheRef.current.set(cacheKey, result);
    return result;
  }, [currentCity]);

  // 获取分段路线详情（独立计算每一段的出行方式）
  useEffect(() => {
    if (!window.AMap || currentDayTripPlaces.length < 2 || !showRoutePanel) {
      setSegmentRoutes([]);
      setIsCalculatingSegments(false);
      return;
    }
    
    const requestSeq = ++segmentRequestSeqRef.current;
    const segmentCount = Math.max(0, currentDayTripPlaces.length - 1);
    setSegmentRoutes((prev) => Array.from({ length: segmentCount }, (_, index) => prev[index] || { distance: 0, time: 0, path: [], pending: true }));
    setIsCalculatingSegments(true);

    const fetchSegments = async () => {
      const results = await Promise.all(
        currentDayTripPlaces.slice(0, -1).map((place, index) => fetchSegmentRoute({
          startPlace: place,
          endPlace: currentDayTripPlaces[index + 1],
          mode: segmentModes[index] || 'driving',
        }))
      );

      if (segmentRequestSeqRef.current === requestSeq) {
        setSegmentRoutes(results);
        setIsCalculatingSegments(false);
      }
    };

    fetchSegments().catch(() => {
      if (segmentRequestSeqRef.current === requestSeq) {
        setSegmentRoutes(Array.from({ length: segmentCount }, () => ({ distance: 0, time: 0, path: [], pending: false })));
        setIsCalculatingSegments(false);
      }
    });
  }, [currentDayTripPlaces, fetchSegmentRoute, segmentModes, mapStatus, showRoutePanel]);

  const handleSegmentModeChange = (index, newMode) => {
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

  const updateStayMinutes = (placeId, nextMinute) => {
    const normalizedMinute = normalizeStayMinute(nextMinute);
    setStayMinutesByPlace((prev) => ({
      ...prev,
      [placeId]: normalizedMinute,
    }));
  };

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
  const upsertSavedPlaceLocally = (placeData, dedupeKey) => {
    setSavedPlaces((prev) => {
      const existingPlace = prev.find((place) => (
        placeIdentityKey(place, place.city || currentCity) === dedupeKey ||
        safeStr(place.id) === safeStr(placeData.id)
      ));
      const normalizedPlace = normalizeSavedPlaceRecord(placeData, currentCity, existingPlace);
      const filtered = prev.filter((place) => (
        placeIdentityKey(place, place.city || currentCity) !== dedupeKey &&
        safeStr(place.id) !== safeStr(normalizedPlace.id)
      ));
      return [normalizedPlace, ...filtered].sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
    });
  };

  const handleSavePlace = async (placeData, stayOpen = false) => {
    const placeName = derivePlaceName(placeData);
    const inferredCity = inferCityName(placeData, currentCity);
    const dedupeKey = placeIdentityKey(placeData, currentCity);
    const existingByKey = savedPlaces.find((place) => placeIdentityKey(place, inferredCity) === dedupeKey);
    const optimisticPlace = normalizeSavedPlaceRecord({
      id: existingByKey?.id || placeData.id || Date.now().toString(),
      name: placeName,
      location: normalizePlaceLocation(placeData.location),
      category: safeStr(placeData.category) || '景点',
      address: stripDistrictPrefix(placeData?.address, placeData?.district) || safeStr(existingByKey?.address) || '地址待补全',
      district: safeStr(placeData.district) || safeStr(existingByKey?.district) || '',
      city: inferredCity,
      savedAt: Date.now()
    }, currentCity, existingByKey);
    upsertSavedPlaceLocally(optimisticPlace, dedupeKey);
    persistDeletedPlaceIds(new Set([...deletedPlaceIdsRef.current].filter((id) => id !== safeStr(optimisticPlace.id))));
    const actionToken = ++favoriteActionTokenRef.current;

    if (user && !user.is_anonymous && supabase) {
      supabase.from('places').upsert({ ...optimisticPlace, user_id: user.id }).catch((e) => logCloudError('Save place', e));
    }

    resolveAddressForPlace(placeData)
      .then((resolvedAddress) => {
        if (favoriteActionTokenRef.current < actionToken) return;
        const hydratedPlace = normalizeSavedPlaceRecord({
          ...optimisticPlace,
          address: safeStr(resolvedAddress.address) || optimisticPlace.address,
          district: safeStr(resolvedAddress.district) || optimisticPlace.district,
          location: normalizePlaceLocation(resolvedAddress.location) || optimisticPlace.location,
          city: safeStr(resolvedAddress.city) || optimisticPlace.city,
      }, currentCity, optimisticPlace);
        upsertSavedPlaceLocally(hydratedPlace, dedupeKey);
        if (user && !user.is_anonymous && supabase) {
          supabase.from('places').upsert({ ...hydratedPlace, user_id: user.id }).catch((e) => logCloudError('Save hydrated place', e));
        }
      })
      .catch((e) => logCloudError('Resolve address for save place', e));
    
    if (!stayOpen) {
      setSelectedPlace(null);
      exitSearch();
    }
  };

  const handleMapPlaceAction = (placeData) => {
    const dedupeKey = placeIdentityKey(placeData, currentCity);
    const existingPlace = savedPlaces.find((place) => placeIdentityKey(place, place.city || currentCity) === dedupeKey);
    if (existingPlace) {
      setSelectedPlace(existingPlace);
      return;
    }
    void handleSavePlace(placeData, false);
  };

  const removePlace = async (targetPlaceOrId) => {
    const targetPlace = typeof targetPlaceOrId === 'object' && targetPlaceOrId
      ? targetPlaceOrId
      : savedPlaces.find((place) => safeStr(place.id) === safeStr(targetPlaceOrId));
    const targetId = safeStr(targetPlace?.id || targetPlaceOrId);
    const targetIdentityKey = targetPlace
      ? placeIdentityKey(targetPlace, targetPlace.city || currentCity)
      : '';

    // 删除时同时按 id 和地点身份键匹配，避免同一地点因不同来源生成多个 id 时看起来“删不掉”。
    const matchedPlaces = savedPlaces.filter((place) => {
      const sameId = safeStr(place.id) === targetId;
      const sameIdentity = targetIdentityKey
        ? placeIdentityKey(place, place.city || currentCity) === targetIdentityKey
        : false;
      return sameId || sameIdentity;
    });
    const idsToRemove = new Set(
      matchedPlaces
        .map((place) => safeStr(place.id))
        .concat(targetId)
        .filter(Boolean)
    );

    if (idsToRemove.size === 0) return;
    persistDeletedPlaceIds(new Set([...deletedPlaceIdsRef.current, ...idsToRemove]));

    const stripPlaceIdsFromTrip = (trip) => normalizeTrip({
      ...trip,
      places: (trip.places || []).filter((pid) => !idsToRemove.has(safeStr(pid))),
      days: Array.isArray(trip.days)
        ? trip.days.map((day) => ({
            ...day,
            places: (day.places || []).filter((pid) => !idsToRemove.has(safeStr(pid))),
          }))
        : trip.days,
    });

    setSavedPlaces((prev) => prev.filter((place) => !idsToRemove.has(safeStr(place.id))));
    setTrips((prev) => prev.map(stripPlaceIdsFromTrip));

    if (user && !user.is_anonymous && supabase) {
      try {
        for (const placeId of idsToRemove) {
          await supabase.from('places').delete().eq('id', placeId).eq('user_id', user.id);
        }
      } catch (e) {
        logCloudError('Remove place', e);
      }

      try {
        const impacted = trips.filter((trip) =>
          flattenTripPlaceIds(trip).some((pid) => idsToRemove.has(safeStr(pid)))
        );
        for (const trip of impacted) {
          const nextTrip = stripPlaceIdsFromTrip(trip);
          await supabase
            .from('trips')
            .update({ places: nextTrip.places, days: nextTrip.days })
            .eq('id', trip.id);
        }
      } catch (e) {
        logCloudError('Sync trip places after remove place', e);
      }
    }
  };


  async function resolveAddressForPlace(placeData) {
    const normalizedInput = normalizeSearchCandidate(placeData, currentCity) || placeData;
    const location = getLngLat(normalizedInput?.location);
    const direct = safeMergeAddress(placeData?.district, placeData?.address);
    if (direct && !isPlaceholderAddress(direct)) {
      return {
        address: stripDistrictPrefix(placeData?.address, placeData?.district),
        district: safeStr(placeData?.district),
        name: safeStr(placeData?.name),
      };
    }
    if (!window.AMap) {
      return {
        address: normalizeAddressText(normalizedInput),
        district: safeStr(normalizedInput?.district),
        name: derivePlaceName(normalizedInput),
      };
    }

    // For lightweight search suggestions, fetch the full POI detail first.
    if (window.AMap.PlaceSearch) {
      try {
        const resolvedByKeyword = await new Promise((resolve) => {
          const ps = new window.AMap.PlaceSearch({
            city: currentCity === '全国' ? '全国' : currentCity,
            citylimit: false,
            pageSize: 10,
            extensions: 'all',
          });
          ps.search(safeStr(normalizedInput?.name) || '地点', (status, result) => {
            if (status !== 'complete' || !result?.poiList?.pois?.length) {
              resolve(null);
              return;
            }

            const pois = result.poiList.pois;
            const matchedPoi = pois.find((poi) => safeStr(poi.id) && safeStr(poi.id) === safeStr(normalizedInput?.id))
              || pois.find((poi) => safeStr(poi.name) === safeStr(normalizedInput?.name))
              || pois[0];

            resolve(matchedPoi ? extractPoiAddress(matchedPoi) : null);
          });
        });

        if (resolvedByKeyword && !isPlaceholderAddress(safeMergeAddress(resolvedByKeyword.district, resolvedByKeyword.address))) {
          return {
            name: safeStr(resolvedByKeyword.name) || derivePlaceName({ ...normalizedInput, ...resolvedByKeyword }),
            district: resolvedByKeyword.district,
            address: stripDistrictPrefix(resolvedByKeyword.address, resolvedByKeyword.district),
            location: resolvedByKeyword.location || normalizePlaceLocation(normalizedInput?.location),
            city: resolvedByKeyword.city || safeStr(normalizedInput?.city),
          };
        }
      } catch (error) {
        console.warn('PlaceSearch detail lookup failed', error);
      }
    }

    if (!location) {
      return {
        address: normalizeAddressText(normalizedInput),
        district: safeStr(normalizedInput?.district),
        name: derivePlaceName(normalizedInput),
      };
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
            resolve(extractPoiAddress(poi));
          });
        });
        if (resolved) {
          return {
            name: safeStr(resolved.name) || derivePlaceName({ ...normalizedInput, ...resolved }),
            district: resolved.district,
            address: stripDistrictPrefix(resolved.address, resolved.district),
            location: resolved.location || normalizePlaceLocation(normalizedInput?.location),
            city: resolved.city || safeStr(normalizedInput?.city),
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
              city: safeStr(comp.city),
            });
          });
        });
        if (resolved) {
          return {
            name: derivePlaceName({ ...normalizedInput, ...resolved }),
            district: resolved.district,
            address: stripDistrictPrefix(resolved.address, resolved.district),
            city: resolved.city || safeStr(normalizedInput?.city),
          };
        }
      } catch (error) {
        console.warn('Geocoder reverse lookup failed', error);
      }
    }

    return {
      address: normalizeAddressText(normalizedInput),
      district: safeStr(normalizedInput?.district),
      city: safeStr(normalizedInput?.city),
      name: derivePlaceName(normalizedInput),
    };
  }

  const createSavedPlaceFromSource = async (placeData) => {
    const placeName = safeStr(placeData?.name) || '未知地点';
    const inferredCity = inferCityName(placeData, currentCity);
    const resolvedAddress = await resolveAddressForPlace(placeData);
    const dedupeKey = placeIdentityKey(placeData, currentCity);
    const existingByKey = savedPlaces.find((place) => placeIdentityKey(place, inferredCity) === dedupeKey);
    const newPlace = normalizeSavedPlaceRecord({
      id: existingByKey?.id || placeData?.id || Date.now().toString(),
      name: safeStr(resolvedAddress.name) || placeName,
      location: normalizePlaceLocation(resolvedAddress.location) || normalizePlaceLocation(placeData?.location),
      category: safeStr(placeData?.category) || '景点',
      address: safeStr(resolvedAddress.address) || stripDistrictPrefix(placeData?.address, placeData?.district),
      district: safeStr(resolvedAddress.district) || safeStr(placeData?.district) || safeStr(existingByKey?.district) || '',
      city: safeStr(resolvedAddress.city) || inferredCity,
      savedAt: existingByKey?.savedAt || Date.now(),
    }, currentCity, existingByKey);
    upsertSavedPlaceLocally(newPlace, dedupeKey);
    if (user && !user.is_anonymous && supabase) {
      try {
        await supabase.from('places').upsert({ ...newPlace, user_id: user.id });
      } catch (e) {
        logCloudError('Save place from itinerary', e);
      }
    }
    return newPlace;
  };

  useEffect(() => {
    if (mapStatus !== 'success' || !window.AMap) return;
    const requestToken = ++repairRequestTokenRef.current;
    const candidates = savedPlaces.filter((place) => (
      !repairingPlaceIdsRef.current.has(safeStr(place.id)) &&
      (isPlaceholderPlaceName(place.name) || isPlaceholderAddress(place.address) || isPlaceholderAddress(normalizeAddressText(place)))
    ));

    if (candidates.length === 0) return;

    candidates.forEach((place) => {
      const placeId = safeStr(place.id);
      if (!placeId) return;
      repairingPlaceIdsRef.current.add(placeId);
      resolveAddressForPlace(place)
        .then((resolvedAddress) => {
          if (repairRequestTokenRef.current !== requestToken) return;
          const repairedPlace = normalizeSavedPlaceRecord({
            ...place,
            ...resolvedAddress,
            name: derivePlaceName({ ...place, ...resolvedAddress }, place),
          }, currentCity, place);
          if (safeStr(repairedPlace.name) === safeStr(place.name) && safeStr(repairedPlace.address) === safeStr(place.address)) return;
          upsertSavedPlaceLocally(repairedPlace, placeIdentityKey(repairedPlace, repairedPlace.city || currentCity));
          if (user && !user.is_anonymous && supabase) {
            supabase.from('places').upsert({ ...repairedPlace, user_id: user.id }).catch((e) => logCloudError('Repair saved place', e));
          }
        })
        .catch((e) => logCloudError('Repair saved place address', e))
        .finally(() => {
          repairingPlaceIdsRef.current.delete(placeId);
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPlaces, mapStatus, currentCity, user, supabase]);

  const createTrip = async (newTrip) => {
    const normalizedTrip = normalizeTrip(newTrip);
    setTrips(prev => [normalizedTrip, ...prev]);
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('trips').upsert({ ...normalizedTrip, user_id: user.id }); } catch(e){ logCloudError('Create trip', e); }
    }
  };

  const removeTrip = async (id) => {
    if (editingTripId === id) {
      cancelEditingTrip();
    }
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
    setEditingTripName(safeStr(trip.name));
  };

  const saveTripName = async () => {
    const nextName = editingTripName.trim();
    if (!editingTripId) {
      cancelEditingTrip();
      return;
    }
    if (!nextName) {
      cancelEditingTrip();
      return;
    }
    setTrips(prev => prev.map(t => t.id === editingTripId ? { ...t, name: nextName } : t));
    if (user && !user.is_anonymous && supabase) {
      try { await supabase.from('trips').update({ name: nextName }).eq('id', editingTripId); } catch(e){ logCloudError('Rename trip', e); }
    }
    cancelEditingTrip();
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

  const movePlaceInDay = async (placeId, direction) => {
    if (!activeTripId) return;
    await updateTripDays(activeTripId, (normalized) => ({
      ...normalized,
      days: normalized.days.map((day, index) => {
        if (index !== currentRouteDay - 1) return day;
        const places = [...(day.places || [])];
        const idx = places.indexOf(placeId);
        if (idx === -1) return day;
        const swapIdx = idx + direction;
        if (swapIdx < 0 || swapIdx >= places.length) return day;
        [places[idx], places[swapIdx]] = [places[swapIdx], places[idx]];
        return { ...day, places };
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
      name: '',
      location: { lng: event.lnglat.lng, lat: event.lnglat.lat },
      district: '',
      address: '',
      city: currentCity,
      category: '地点',
    });
  };

  const deferredFavSearchQuery = favSearchQuery.trim().toLowerCase();
  const filteredFavs = useMemo(() => (
    savedPlaces.filter((place) => (
      safeStr(place.name).toLowerCase().includes(deferredFavSearchQuery) ||
      safeStr(place.address).toLowerCase().includes(deferredFavSearchQuery)
    ))
  ), [savedPlaces, deferredFavSearchQuery]);

  const groupedFavorites = useMemo(() => (
    filteredFavs.reduce((acc, spot) => {
      const city = spot.city || '其他城市';
      if (!acc[city]) acc[city] = [];
      acc[city].push(spot);
      return acc;
    }, {})
  ), [filteredFavs]);

  const totalDist = segmentRoutes.reduce((acc, curr) => acc + (curr?.distance || 0), 0);
  const totalTime = segmentRoutes.reduce((acc, curr) => acc + (curr?.time || 0), 0);
  void totalDist;
  void totalTime;
  const dayStorageKey = `${safeStr(activeTripId) || 'default'}::day_${currentRouteDay}`;
  const currentDayPlaceIds = useMemo(() => activeTrip?.days?.[currentRouteDay - 1]?.places || [], [activeTrip, currentRouteDay]);
  const currentDayTripPlaces = useMemo(() => (
    currentDayPlaceIds
      .map((pid) => savedPlacesById.get(safeStr(pid)))
      .filter(Boolean)
  ), [currentDayPlaceIds, savedPlacesById]);

  useEffect(() => {
    if (!showRoutePanel || !activeTripId) {
      routePanelSessionRef.current = { tripId: '', day: 0, visible: false };
      return;
    }

    const session = routePanelSessionRef.current;
    const nextSuggested = getSuggestedViewport(currentDayTripPlaces);
    const isNewSession =
      !session.visible ||
      session.tripId !== safeStr(activeTripId) ||
      session.day !== Number(currentRouteDay);

    if (isNewSession && nextSuggested) {
      setRouteMapView(nextSuggested);
      routePanelSessionRef.current = {
        tripId: safeStr(activeTripId),
        day: Number(currentRouteDay),
        visible: true,
      };
      return;
    }

    routePanelSessionRef.current = {
      tripId: safeStr(activeTripId),
      day: Number(currentRouteDay),
      visible: true,
    };
  }, [showRoutePanel, activeTripId, currentRouteDay, currentDayTripPlaces]);

  const timelineRows = useMemo(() => {
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
  }, [arrivalOverridesByPlace, currentDayTripPlaces, dayStartTimes, dayStorageKey, segmentRoutes, stayMinutesByPlace]);
  const totalDays = routeDayCount;
  const dayOptions = useMemo(() => Array.from({ length: totalDays }, (_, idx) => idx + 1), [totalDays]);
  const currentDayRows = timelineRows;
  const currentDayTransitMinutes = currentDayRows.reduce((sum, row) => sum + (row.transitMinute || 0), 0);
  const currentDayStayMinutes = currentDayRows.reduce((sum, row) => sum + (row.stayMinutes || 0), 0);
  const currentDayTotalMinutes = currentDayTransitMinutes + currentDayStayMinutes;

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

  return (
    <div className="min-h-[100dvh] w-full flex justify-center bg-gray-100 sm:bg-[#f0f4f8]" style={{ fontFamily: '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",sans-serif' }}>
      <div className="w-full sm:max-w-[960px] h-[100dvh] flex flex-col relative bg-white overflow-hidden shadow-2xl min-h-0">
        
        <div className="absolute top-0 w-full h-40" style={{ background: `linear-gradient(to bottom, ${COLORS.bg}, white)` }}></div>
        <div className="h-12 shrink-0 pt-safe z-10"></div>

        <div className="flex-1 relative z-10 flex flex-col overflow-hidden min-h-0">
          
          {/* ==================== 发现页面 ==================== */}
          <div className={`${activeTab === 'map' ? 'flex' : 'hidden'} flex-1 flex-col animate-in fade-in min-h-0`}>
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
                      places={cityFilteredPlaces}
                      mapStatus={mapStatus} 
                      mapErrorMsg={mapErrorMsg} 
                      currentCity={currentCity} 
                      lockViewport={lockMapViewport}
                      mapView={mapView}
                      onMapViewChange={setMapView}
                      onMarkerClick={handleMapPlaceAction}
                      visible={activeTab === 'map'}
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

          {/* ==================== 鏀惰棌澶归〉闈?==================== */}
          <div className={`${activeTab === 'favorites' ? 'flex' : 'hidden'} h-full flex-col animate-in fade-in bg-[#f0f4f8] min-h-0 overflow-x-hidden`}>
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
                            className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex justify-between items-start max-w-full overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setRouteBuilderStart(spot);
                                setRouteBuilderTargets([]);
                              }}
                              className="flex-1 min-w-0 pr-4 text-left cursor-pointer active:scale-95 transition-transform"
                            >
                              <p className="font-bold text-slate-700 break-words leading-snug">{safeStr(spot.name)}</p>
                              <p className="text-[11px] leading-5 text-slate-400 break-words flex items-start gap-1 mt-1 max-w-full">
                                <MapPin size={10} className="mt-[3px] shrink-0" /> <span className="min-w-0 break-words">{normalizeAddressText(spot)}</span>
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                removePlace(spot);
                              }}
                              className="text-slate-300 hover:text-red-400 p-2 rounded-full hover:bg-red-50 transition-colors"
                            >
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

          {/* ==================== 行程页面 ==================== */}
          <div className={`${activeTab === 'lists' ? 'flex' : 'hidden'} h-full flex-col px-6 animate-in fade-in min-h-0`}>
               <div className="flex justify-between items-center py-4 shrink-0">
                  <h2 className="text-[22px] sm:text-[24px] font-semibold text-slate-800">我的行程</h2>
                  <button onClick={() => setNewTripModalVisible(true)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm active:scale-95"><Plus size={20} color={COLORS.primary}/></button>
               </div>
               <div className="flex-1 overflow-y-auto pb-24 space-y-4 pt-2 min-h-0">
                  <div className="h-px bg-gray-200 my-4"></div>

                  <h3 className="font-bold text-slate-600">自定义行程</h3>
                  {trips.length === 0 ? (
                    <div className="text-center py-6 text-sm text-slate-400">还没创建自定义行程，点击上方卡片或右上角加号创建吧</div>
                  ) : (
                    trips.map(trip => (
                      <div key={trip.id} className="bg-white p-5 rounded-3xl shadow-sm border border-gray-50">
                        <div className="flex justify-between items-start mb-2">
                          {editingTripId === trip.id ? (
                             <div className="flex-1 flex items-center gap-2 mr-2" data-trip-action="true">
                               <input
                                 autoFocus
                                 value={editingTripName}
                                 onChange={e => setEditingTripName(e.target.value)}
                                 onBlur={saveTripName}
                                 onKeyDown={(e) => {
                                   if (e.key === 'Enter') saveTripName();
                                   if (e.key === 'Escape') cancelEditingTrip();
                                 }}
                                 onClick={e => e.stopPropagation()}
                                 className="flex-1 font-bold text-lg border-b border-blue-200 outline-none bg-transparent pb-0.5 text-slate-800"
                               />
                               <button type="button" data-trip-action="true" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); saveTripName(); }} className="p-1.5 bg-blue-100 text-blue-600 rounded-lg active:scale-95 shrink-0"><CheckCircle2 size={16}/></button>
                             </div>
                          ) : (
                             <div onClick={() => openTripPanel(trip.id)} className="flex-1 min-w-0 cursor-pointer active:scale-95">
                               <div className="flex items-center gap-2 min-w-0">
                                 <h3 className="font-bold text-lg truncate text-slate-800">{safeStr(trip.name)}</h3>
                                 <button type="button" data-trip-action="true" onClick={(e) => startEditingTrip(trip, e)} className="shrink-0 p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors" title="修改名称">
                                   <Edit2 size={14}/>
                                 </button>
                               </div>
                               <p className="text-xs text-slate-400 flex items-center gap-1 mt-2"><MapPin size={12}/> {flattenTripPlaceIds(trip).length} 个地点 · {(trip.days?.length || 1)} 天</p>
                             </div>
                          )}
                          <button type="button" data-trip-action="true" onClick={(e) => { e.stopPropagation(); removeTrip(trip.id); }} className="text-slate-300 hover:text-red-400 p-1 shrink-0 ml-2" title="删除行程">
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {editingTripId === trip.id ? (
                          <p className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={12}/> {flattenTripPlaceIds(trip).length} 个地点 · {(trip.days?.length || 1)} 天</p>
                        ) : null}
                      </div>
                    ))
                  )}
               </div>
            </div>

          {/* ==================== 澶囧繕椤甸潰 ==================== */}
          <div className={`${activeTab === 'memo' ? 'flex' : 'hidden'} h-full flex-col animate-in fade-in bg-[#f0f4f8] min-h-0`}>
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

          {/* ==================== 鎴戠殑椤甸潰 ==================== */}
          <div className={`${activeTab === 'profile' ? 'flex' : 'hidden'} h-full flex-col items-center justify-center animate-in fade-in px-6`}>
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

        {/* ==================================================== */}
        {/* 行程路线展示弹窗：分段交通与自由排序升级 */}
        {/* ==================================================== */}
        <div className={`${showRoutePanel && activeTripId ? 'flex' : 'hidden'} fixed inset-0 z-[120] flex-col bg-slate-50 min-h-0`}>
            <div className="px-5 sm:px-6 py-4 flex items-center justify-between border-b border-slate-100 shrink-0 bg-white">
              <h2 className="text-[20px] sm:text-[24px] leading-tight font-semibold text-slate-800">行程规划与地图</h2>
              <button onClick={() => setShowRoutePanel(false)} className="p-2 rounded-full bg-slate-100"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-y-contain">
              <div className="mx-auto w-full max-w-[960px] px-3 sm:px-5 py-3 sm:py-4">
                <div className="pb-3">
                  <div className="relative bg-slate-200 rounded-[28px] border border-slate-200 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
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
                      visible={showRoutePanel && activeTripId}
                      className="rounded-[28px]"
                      heightClassName="h-[280px] sm:h-[360px] lg:h-[400px]"
                    />
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
                        const segmentIndex = rowIndex - 1;
                        const hasIncomingSegment = segmentIndex >= 0;
                        const segMode = hasIncomingSegment ? (segmentModes[segmentIndex] || 'driving') : 'driving';
                        const segmentInfo = hasIncomingSegment ? segmentRoutes[segmentIndex] : null;
                        const transitMinute = row.transitMinute || 0;
                        const modeLabel = segMode === 'transit' ? '公交' : segMode === 'riding' ? '骑行' : segMode === 'walking' ? '步行' : '驾车';
                        const currentStayMinute = Math.max(15, Number(stayMinutesByPlace[row.place.id]) || row.stayMinutes);
                        return (
                          <div key={`timeline_${row.id}`} className="group bg-white rounded-[24px] p-4 border border-slate-100 shadow-sm transition-all relative">
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex gap-3 min-w-0">
                                <div className="w-7 h-10 rounded-[14px] shrink-0 text-white flex items-start justify-center pt-2" style={{ backgroundColor: COLORS.primary }}><MapPin size={11} /></div>
                                <div className="flex flex-col gap-1 min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <h3 className="font-bold text-slate-800 text-[13px] break-words leading-snug flex-1 min-w-0">{safeStr(row.place.name)}</h3>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button type="button" onClick={() => movePlaceInDay(row.place.id, -1)} disabled={currentDayRows.indexOf(row) === 0} className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors" title="上移">
                                        <ChevronLeft size={13} style={{ transform: 'rotate(90deg)' }} />
                                      </button>
                                      <button type="button" onClick={() => movePlaceInDay(row.place.id, 1)} disabled={currentDayRows.indexOf(row) === currentDayRows.length - 1} className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors" title="下移">
                                        <ChevronRight size={13} style={{ transform: 'rotate(90deg)' }} />
                                      </button>
                                      <button type="button" onClick={() => removePlace(row.place.id)} className="w-6 h-6 flex items-center justify-center rounded-lg text-red-300 hover:bg-red-50 hover:text-red-500 transition-colors" title="删除">
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="text-[10px] leading-4 text-slate-400 break-words">{normalizeAddressText(row.place)}</div>
                                  <div className="flex items-center flex-wrap gap-1.5 text-slate-400 mt-1">
                                    <button
                                      type="button"
                                      onClick={() => setStayPickerState({ open: true, placeId: row.place.id, minute: currentStayMinute })}
                                      className="flex items-center gap-1 rounded-full bg-slate-50 border border-slate-100 px-2 py-1 hover:bg-slate-100 transition-colors"
                                    >
                                      <Clock size={14} />
                                      <span className="text-[10px]">停留</span>
                                      <span className="text-[10px] font-bold text-slate-700">{formatDurationCn(currentStayMinute)}</span>
                                      <ChevronDown size={12} />
                                    </button>
                                    {hasIncomingSegment ? (
                                      <div className="text-[10px] px-2 py-1 rounded-full bg-slate-50 border border-slate-100 text-slate-500">
                                        {modeLabel} · {segmentInfo?.pending ? '计算中...' : formatDurationCn(transitMinute)}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                              <div className="w-24 shrink-0">
                                <select value={currentDayPlaceIds.includes(row.place.id) ? currentRouteDay : Math.max(1, Math.min(totalDays, Number(stayMinutesByPlace[`day_${row.place.id}`] || currentRouteDay)))} onChange={(event) => movePlaceToTripDay(row.place.id, Math.max(1, Math.min(totalDays, Number(event.target.value) || 1)))} className="mb-2 w-full px-2 py-1 rounded-xl border border-slate-200 text-xs font-bold bg-white">
                                  {dayOptions.map((d) => <option key={`d_${row.id}_${d}`} value={d}>D{d}</option>)}
                                </select>
                                {hasIncomingSegment ? (
                                  <select value={segMode} onChange={(event) => handleSegmentModeChange(segmentIndex, event.target.value)} className="w-full px-2 py-1 rounded-xl border border-slate-200 text-xs font-bold bg-white">
                                    <option value="driving">驾车</option>
                                    <option value="transit">公交</option>
                                    <option value="riding">骑行</option>
                                    <option value="walking">步行</option>
                                  </select>
                                ) : (
                                  <div className="w-full px-2 py-1 rounded-xl border border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-400 text-center">当天首站</div>
                                )}
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

        <StayDurationPicker
          open={stayPickerState.open}
          initialMinute={stayPickerState.minute}
          onClose={() => setStayPickerState((prev) => ({ ...prev, open: false }))}
          onConfirm={(minute) => {
            updateStayMinutes(stayPickerState.placeId, minute);
            setStayPickerState({ open: false, placeId: '', minute });
          }}
        />

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
                <MapPin size={12} className="shrink-0" /> {normalizeAddressText(selectedPlace)}
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

