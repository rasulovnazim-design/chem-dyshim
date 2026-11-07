// Какое значение показать крупно. Логика вынесена отдельно, чтобы её можно было проверить тестами.
//
// Порядок: свежий показатель IQAir, затем свежие показания датчиков, затем расчёт модели, который браузер
// получил прямо сейчас, затем последнее известное с пометкой. Модель никогда не подменяет измерение молча:
// если показывается она или устаревшие данные, рядом с цифрой есть объяснение.
export const IQAIR_FRESH_MS = 3 * 3600e3;
export const SENSOR_FRESH_MS = 2 * 3600e3;
export const FILE_STALE_MS = 3 * 3600e3;

const hasReading = (city) => typeof city?.aqi === 'number' && Boolean(city.timestamp);
const modeFor = (source) => ({ iqair: 'iqair', waqi: 'sensors', 'sensor-community': 'community' }[source] ?? 'model');

export function chooseReading({ file, live, liveSensors, cached, nowMs }) {
  const fileCity = hasReading(file?.city) ? file.city : null;
  const fileAge = fileCity ? nowMs - Date.parse(fileCity.timestamp) : Infinity;
  const fileMap = {
    districts: file?.districts ?? null,
    districtsSource: file?.districts_source ?? fileCity?.source ?? null,
    comparable: Boolean(file?.districts_comparable),
  };
  const map = liveSensors?.districts
    ? { districts: liveSensors.districts, districtsSource: 'sensor-community', comparable: Boolean(liveSensors.comparable) }
    : fileMap;
  const modelNow = live?.city ?? file?.model_check ?? null;

  if (fileCity?.source === 'iqair' && fileAge <= IQAIR_FRESH_MS) {
    return { mode: 'iqair', city: fileCity, ...map, stationCheck: liveSensors?.city ?? file.station_check ?? null, modelCheck: modelNow, notice: null };
  }
  if (hasReading(liveSensors?.city)) {
    const notice = fileCity?.source === 'iqair' ? { key: 'notice.iqair_stale', time: fileCity.timestamp } : null;
    return { mode: 'community', city: liveSensors.city, ...map, stationCheck: null, modelCheck: modelNow, notice };
  }
  const stationFile = fileCity?.source === 'waqi' || fileCity?.source === 'sensor-community';
  if (stationFile && fileAge <= SENSOR_FRESH_MS) {
    return { mode: modeFor(fileCity.source), city: fileCity, ...fileMap, stationCheck: null, modelCheck: modelNow, notice: null };
  }
  if (hasReading(live?.city)) {
    let notice = null;
    if (!fileCity) notice = { key: 'notice.no_file' };
    else if (fileCity.source === 'iqair') notice = { key: 'notice.iqair_stale_model', time: fileCity.timestamp };
    else if (stationFile || fileAge > FILE_STALE_MS) notice = { key: 'notice.stale_file', time: fileCity.timestamp };
    return { mode: 'model', city: live.city, districts: live.districts, districtsSource: 'open-meteo', comparable: false, stationCheck: null, modelCheck: null, notice };
  }
  if (fileCity) {
    return {
      mode: modeFor(fileCity.source),
      city: fileCity,
      ...fileMap,
      stationCheck: null,
      modelCheck: null,
      notice: fileAge > FILE_STALE_MS ? { key: 'notice.stale', time: fileCity.timestamp } : null,
    };
  }
  if (hasReading(cached?.city)) {
    return {
      mode: modeFor(cached.city.source),
      city: cached.city,
      districts: cached.districts,
      districtsSource: cached.districtsSource ?? cached.city.source,
      comparable: Boolean(cached.comparable),
      stationCheck: null,
      modelCheck: null,
      notice: { key: 'notice.cached', time: cached.city.timestamp },
    };
  }
  return { mode: 'none', city: null, districts: null, districtsSource: null, comparable: false, stationCheck: null, modelCheck: null, notice: { key: 'notice.no_data' } };
}
