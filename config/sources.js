// Источники данных. Файл читают и скрипты, и браузер (FALLBACK_POINTS).

// Границы поиска станций WAQI вокруг Бишкека
export const BBOX = { south: 42.78, west: 74.45, north: 42.95, east: 74.72 };

// Шесть точек для резервного источника Open-Meteo: по одной-две в каждом районе.
export const FALLBACK_POINTS = [
  { id: 'om-kyzyl-asker', name: 'Кызыл-Аскер', neighbourhood: 'Кызыл-Аскер', district: 'leninsky', lat: 42.8692, lon: 74.529 },
  { id: 'om-jal', name: 'Джал-23', neighbourhood: 'Джал-23', district: 'leninsky', lat: 42.8391, lon: 74.5659 },
  { id: 'om-center', name: 'Центр', neighbourhood: 'Центр', district: 'pervomaisky', lat: 42.8761, lon: 74.6033 },
  { id: 'om-asanbay', name: 'Асанбай', neighbourhood: 'Асанбай', district: 'oktyabrsky', lat: 42.8185, lon: 74.6249 },
  { id: 'om-tokoldosh', name: 'Токольдош', neighbourhood: 'Токольдош', district: 'oktyabrsky', lat: 42.8642, lon: 74.6429 },
  { id: 'om-alamedin', name: 'Аламедин-1', neighbourhood: 'Аламедин 1', district: 'sverdlovsky', lat: 42.878, lon: 74.6847 },
];

export const DISTRICT_IDS = ['leninsky', 'oktyabrsky', 'pervomaisky', 'sverdlovsky'];

// Новостные ленты. Если адрес ленты изменится, поправьте его здесь.
export const FEEDS = [
  { id: 'kaktus', name: 'Kaktus.media', url: 'https://kaktus.media/?rss' },
  { id: '24kg', name: '24.kg', url: 'https://24.kg/rss/' },
  { id: 'economist', name: 'Economist.kg', url: 'https://economist.kg/feed/' },
  { id: 'akipress', name: 'АКИpress', url: 'https://kg.akipress.org/rss/news.rss' },
  { id: 'vesti', name: 'Вести.kg', url: 'https://vesti.kg/?format=feed&type=rss' },
];

export const USER_AGENT = 'ChemDyshim/1.0 (+https://github.com/rasulovnazim-design/chem-dyshim)';
