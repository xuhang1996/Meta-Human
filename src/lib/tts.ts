import { VoiceOption } from "./types";
import { runCommand } from "./render-process";

// Edge-TTS 是一个 Python 包。我们通过可配置的 Python 解释器调用它，
// 避免 macOS 原生 `say` 命令依赖。解释器路径由 EDGE_TTS_PYTHON 指定，
// 未配置时回退到 `python`（依赖系统 PATH）。
function edgeTtsPython() {
  return process.env.EDGE_TTS_PYTHON || "python";
}

// 调用 `python -m edge_tts --list-voices`，解析输出为 VoiceOption[]。
// 输出形如：
//   Name                              Gender   Type                   Locale
//   zh-CN-XiaoxiaoNeural              Female   General                zh-CN
// 我们只保留中文/英文音色，供前端下拉框使用。
export async function listEdgeTtsVoices() {
  const output = await runCommand(edgeTtsPython(), [
    "-m",
    "edge_tts",
    "--list-voices",
  ]);

  const voices = output
    .split("\n")
    .slice(1) // 跳过表头
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // 列之间是多个空格分隔；前两列是 Name、Gender。
      const cols = line.split(/\s{2,}/);
      const name = cols[0];
      const gender = cols[1] ?? "General";

      if (!name) {
        return null;
      }

      // 从音色名推断 locale，如 zh-CN-XiaoxiaoNeural → zh_CN。
      const match = name.match(/^([a-z]{2})-([A-Z]{2})-/);
      const locale = match
        ? `${match[1]}_${match[2]}`
        : name.includes("-")
          ? name.split("-").slice(0, 2).join("_")
          : name;

      return {
        name,
        locale,
        sample: gender,
      } satisfies VoiceOption;
    })
    .filter((voice): voice is VoiceOption => Boolean(voice))
    .filter((voice) => /^(zh|en)_/.test(voice.locale));

  return voices;
}

// 用 Edge-TTS 把文案合成成音频。输出为 speech.mp3，写入 cwd（jobDir）。
// Edge-TTS 模块名是 edge_tts（下划线）。
// Edge-TTS 走微软云服务，偶发 NoAudioReceived（网络抖动/服务端限流/token 失效），
// 因此做指数退避重试，避免单次失败直接中断整个渲染管线。
export async function synthesizeEdgeTtsSpeech(
  cwd: string,
  voice: string,
  script: string,
  outputFileName = "speech.mp3",
) {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runCommand(
        edgeTtsPython(),
        [
          "-m",
          "edge_tts",
          "--voice",
          voice,
          "--text",
          script,
          "--write-media",
          outputFileName,
        ],
        { cwd },
      );
      return outputFileName;
    } catch (error) {
      lastError = error;
      // 未到最大次数则退避后重试（1s、2s）。
      if (attempt < maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * attempt),
        );
      }
    }
  }

  throw lastError;
}
