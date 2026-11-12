import { MAX_AVATAR_DATA_URL_LENGTH } from "@party/shared";

/** 昵称和头像保存在本机浏览器，下次打开、进房间、断线重连都用它 */

const NAME_KEY = "party.name";
const AVATAR_KEY = "party.avatar";
const AVATAR_SIZE = 96;

export function savedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim());
}

export function savedAvatar(): string | null {
  return localStorage.getItem(AVATAR_KEY);
}

export function saveAvatar(dataUrl: string | null): void {
  if (dataUrl) localStorage.setItem(AVATAR_KEY, dataUrl);
  else localStorage.removeItem(AVATAR_KEY);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("这张图片打不开，换一张试试"));
    };
    img.src = url;
  });
}

/** 居中裁成正方形，缩到 96×96 再转 JPEG，手机拍的大图也只剩几 KB */
export async function compressAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择一张图片");
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d")!;
  // 透明 PNG 转 JPEG 时背景会变黑，先铺白底
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  for (const quality of [0.85, 0.7, 0.5, 0.3]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_AVATAR_DATA_URL_LENGTH) return url;
  }
  throw new Error("这张图片压缩不下来，换一张试试");
}
