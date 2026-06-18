import { StudioClient } from "@/components/studio-client";
import { PIPELINE_STEPS } from "@/lib/constants";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">本地优先视频工作流</p>
          <h1>数字人视频工作台</h1>
          <p className="hero-text">
            上传一张头像，输入一段文案，就能用本机渲染生成讲解视频。这一版先把低成本、本地化和可扩展的工作流跑通，后续再接更强的口型驱动模型。
          </p>
        </div>

        <div className="hero-metrics">
          <div className="metric">
            <span>当前能力</span>
            <strong>`Edge-TTS` + `ffmpeg`</strong>
          </div>
          <div className="metric">
            <span>升级方向</span>
            <strong>CosyVoice / SadTalker / MuseTalk</strong>
          </div>
          <div className="metric">
            <span>交付方式</span>
            <strong>异步本地任务队列</strong>
          </div>
        </div>
      </section>

      <StudioClient />

      <section className="pipeline-band">
        {PIPELINE_STEPS.map((step, index) => (
          <article className="pipeline-step" key={step}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <p>{step}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
