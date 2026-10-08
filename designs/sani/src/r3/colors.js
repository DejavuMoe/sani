window.SANI_COLOR_PRESETS = [
  ['#5872a5', '雾蓝', 'Blue'], ['#588c98', '湖蓝', 'Cyan'],
  ['#56877e', '青绿', 'Teal'], ['#74896a', '苔绿', 'Sage'],
  ['#91885d', '橄榄', 'Olive'], ['#b18b54', '麦金', 'Ochre'],
  ['#b17c5e', '陶土', 'Terracotta'], ['#ad7070', '砖红', 'Brick'],
  ['#a96f89', '玫瑰', 'Rose'], ['#9679a5', '灰紫', 'Mauve'],
  ['#797ba1', '鸢尾', 'Iris'], ['#808481', '石灰', 'Stone'],
];
window.normalizeTagColor = function (input) {
  const value = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return '#' + [...value.slice(1)].map(c => c + c).join('');
  const number = '(\\d+(?:\\.\\d+)?)';
  const rgb = value.match(new RegExp('^rgb\\(\\s*' + number + '\\s*,\\s*' + number + '\\s*,\\s*' + number + '\\s*\\)$'));
  let channels;
  if (rgb) {
    channels = rgb.slice(1).map(Number);
    if (channels.some(n => n > 255)) return null;
  } else {
    const hsl = value.match(new RegExp('^hsl\\(\\s*' + number + '(?:deg)?\\s*,\\s*' + number + '%\\s*,\\s*' + number + '%\\s*\\)$'));
    if (!hsl) return null;
    const [h, s, l] = hsl.slice(1).map(Number);
    if (h > 360 || s > 100 || l > 100) return null;
    const light = l / 100, a = s / 100 * Math.min(light, 1 - light);
    channels = [0, 8, 4].map(n => {
      const k = (n + h / 30) % 12;
      return 255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    });
  }
  return '#' + channels.map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
};
