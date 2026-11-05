// Какое значение показать крупно. Логика вынесена отдельно, чтобы её можно было проверить тестами.
//
// Показания датчиков всегда важнее расчёта модели, пока они свежие: модель не должна молча подменять
// измерение. Если датчиков нет или они устарели, показываем расчёт, полученный браузером прямо сейчас,
// и говорим об этом читателю. Если и его нет, показываем последнее известное с пометкой.
export const SENSOR_FRESH_MS = 2 * 3600e3;
export const FILE_STALE_MS = 3 * 3600e3;

const hasReading = (city) => typeof city?.aqi === 'number' && Boolean(city.timestamp);

export function chooseReading({ file, live, cached, nowMs }) {
  const fileCity = hasReading(file?.city) ? file.city : null;
  const fileAge = fileCity ? nowMs - Date.parse(fileCity.timestamp) : Infinity;
  const sensorsFresh = fileCity?.source === 'waqi' && fileAge <= SENSOR_FRESH_MS;

  if (sensorsFresh) {
    return { mode: 'sensors', city: fileCity, districts: file.districts, comparable: Boolean(file.districts_comparable), modelCheck: live?.city ?? file.model_check ?? null, notice: null };
  }
  if (hasReading(live?.city)) {
    let notice = null;
    if (!fileCity) notice = { key: 'notice.no_file' };
    else if (fileCity.source === 'waqi') notice = { key: 'notice.stale_file', time: fileCity.timestamp };
    else if (fileAge > FILE_STALE_MS) notice = { key: 'notice.stale_file', time: fileCity.timestamp };
    return { mode: 'model', city: live.city, districts: live.districts, comparable: false, modelCheck: null, notice };
  }
  if (fileCity) {
    return {
      mode: fileCity.source === 'waqi' ? 'sensors' : 'model',
      city: fileCity,
      districts: file.districts,
      comparable: Boolean(file.districts_comparable),
      modelCheck: null,
      notice: fileAge > FILE_STALE_MS ? { key: 'notice.stale', time: fileCity.timestamp } : null,
    };
  }
  if (hasReading(cached?.city)) {
    return {
      mode: cached.city.source === 'waqi' ? 'sensors' : 'model',
      city: cached.city,
      districts: cached.districts,
      comparable: Boolean(cached.comparable),
      modelCheck: null,
      notice: { key: 'notice.cached', time: cached.city.timestamp },
    };
  }
  return { mode: 'none', city: null, districts: null, comparable: false, modelCheck: null, notice: { key: 'notice.no_data' } };
}
