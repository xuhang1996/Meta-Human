import type { NextConfig } from "next";

// 把 ffmpeg/ffprobe 注入 PATH。
// winget 安装的 ffmpeg 不一定出现在当前会话 PATH 中（需重登录才刷新系统 PATH），
// 因此通过 FFMPEG_BIN 环境变量显式指定其 bin 目录，启动时 prepend 到 PATH，
// 让所有 spawn("ffmpeg", ...) 调用都能找到。缺省回退到 winget 的标准安装位置。
const ffmpegBin =
  process.env.FFMPEG_BIN ||
  "C:/Users/xuhan/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin";
const separator = process.platform === "win32" ? ";" : ":";
process.env.PATH = `${ffmpegBin}${separator}${process.env.PATH || ""}`;

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
