export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatRelativeTime(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.max(1, Math.round(diff / 1000));

  if (seconds < 60) {
    return `${seconds}秒前`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}分钟前`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours}小时前`;
  }

  const days = Math.round(hours / 24);
  return `${days}天前`;
}

export function formatDuration(seconds?: number) {
  if (!seconds || Number.isNaN(seconds)) {
    return "--";
  }

  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function slugifyFileExtension(name: string) {
  // 支持 MuseTalk 引擎上传的视频底片（mp4/mov/webm/m4v）。
  const match = name
    .toLowerCase()
    .match(/\.(png|jpg|jpeg|webp|mp4|mov|webm|m4v)$/);
  return match?.[0] ?? ".png";
}
