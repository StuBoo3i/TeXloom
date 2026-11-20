import type { MouseEvent, ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpenText, Check, FileCode2, FileText, GitBranch, Github, LockKeyhole, MousePointer2, PanelRight, ShieldCheck } from 'lucide-react'
import './landing.css'

const workspaceUrl = '/?view=workspace'
const githubUrl = 'https://github.com/StuBoo3i/TeXloom'

const features = [
  { number: '01', icon: <FileCode2 size={24} strokeWidth={1.65} />, title: '为 LaTeX 而生的编辑体验', copy: '语法着色、文件树、全文搜索与常用插入工具，把复杂工程整理成清晰的写作空间。', accent: 'blue' },
  { number: '02', icon: <MousePointer2 size={24} strokeWidth={1.65} />, title: '源码与 PDF，双向抵达', copy: '编辑器与预览并排工作。通过 SyncTeX 在源码和成稿之间定位，修改不再靠翻页寻找。', accent: 'cyan' },
  { number: '03', icon: <LockKeyhole size={24} strokeWidth={1.65} />, title: '你的文件，留在你的电脑', copy: '选择自己的项目目录，用本地 Tectonic 编译。写作数据由你掌控，无需建立平台账户。', accent: 'sand' },
  { number: '04', icon: <GitBranch size={24} strokeWidth={1.65} />, title: '从独写到协作，自然衔接', copy: '连接 GitHub 私有仓库，在个人分支上写作、提交与审阅；AI 助手按需接入自己的 API。', accent: 'lavender' },
]

function WorkspaceLink({ children, className, onEnter }: { children: ReactNode; className: string; onEnter: () => void }) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      onEnter()
    }
  }
  return <a href={workspaceUrl} className={className} onClick={navigate}>{children}</a>
}

function ProductPreview() {
  return <div className="lp-preview-wrap">
    <div className="lp-preview-orbit lp-preview-orbit-one" /><div className="lp-preview-orbit lp-preview-orbit-two" />
    <div className="lp-preview" aria-label="TeXloom 编辑器与 PDF 预览界面示意">
      <div className="lp-preview-top"><div className="lp-window-dots"><i /><i /><i /></div><span className="lp-preview-brand"><img src="/icon.png" alt="" />TeXloom</span><span className="lp-preview-local"><i />本地工作空间</span></div>
      <div className="lp-preview-toolbar"><span className="lp-preview-crumb">研究论文 <b>/</b> main.tex</span><span className="lp-preview-compile"><Check size={12} /> 编译成功</span></div>
      <div className="lp-preview-body">
        <aside className="lp-preview-files"><span className="lp-preview-files-title">PROJECT FILES</span><span className="lp-preview-file active"><FileCode2 size={12} /> main.tex</span><span className="lp-preview-file"><FileText size={12} /> references.bib</span><span className="lp-preview-file"><FileText size={12} /> figures</span><span className="lp-preview-files-bottom">Tectonic 已就绪</span></aside>
        <div className="lp-preview-code"><div className="lp-preview-pane-title">源文件 <span>LaTeX</span></div><div className="lp-code-lines">
          <div><em>01</em><span className="lp-code-command">\documentclass</span><span>{'{article}'}</span></div>
          <div><em>02</em><span className="lp-code-command">\usepackage</span><span className="lp-code-brace">{'[UTF8]'}</span><span>{'{ctex}'}</span></div>
          <div><em>03</em><span className="lp-code-command">\begin</span><span>{'{document}'}</span></div>
          <div><em>04</em><span className="lp-code-command">\section</span><span>{'{研究背景}'}</span></div>
          <div><em>05</em><span className="lp-code-text">在这里，专注你的研究。</span></div>
          <div><em>06</em><span className="lp-code-command">\begin</span><span>{'{equation}'}</span></div>
          <div><em>07</em><span className="lp-code-math">E = mc^2</span></div>
          <div><em>08</em><span className="lp-code-command">\end</span><span>{'{equation}'}</span></div>
          <div><em>09</em><span className="lp-code-command">\end</span><span>{'{document}'}</span></div>
        </div></div>
        <div className="lp-preview-pdf"><div className="lp-preview-pane-title">PDF 预览 <span>1 / 1</span></div><div className="lp-paper"><small>研究论文 · 2026</small><h3>研究背景</h3><p>在这里，专注你的研究。</p><div className="lp-paper-equation">E = mc²</div><div className="lp-paper-rule" /><div className="lp-paper-lines"><i /><i /><i /><i /></div><span className="lp-paper-page">1</span></div></div>
      </div>
    </div>
    <div className="lp-preview-note"><span className="lp-preview-note-icon"><PanelRight size={17} /></span><span>从源码到成稿<br /><strong>始终在同一张工作台</strong></span></div>
    <span className="lp-preview-caption">WORKSPACE PREVIEW · 界面示意</span>
  </div>
}

export function Landing({ onEnter }: { onEnter: () => void }) {
  return <div className="landing-page">
    <header className="lp-header"><div className="lp-container lp-header-inner"><a className="lp-logo" href="/" aria-label="TeXloom 首页"><span><img src="/icon.png" alt="" /></span><strong>TeXloom</strong></a><nav aria-label="首页导航"><a href="#features">产品亮点</a><a href="#workflow">写作流程</a><a href="#open-source">开源与隐私</a></nav><WorkspaceLink className="lp-nav-cta" onEnter={onEnter}>打开工作台 <ArrowUpRight size={16} /></WorkspaceLink></div></header>

    <main>
      <section className="lp-hero"><div className="lp-container lp-hero-grid"><div className="lp-hero-copy"><div className="lp-kicker"><span className="lp-kicker-line" />本地 LaTeX 写作工作台<span className="lp-kicker-separator">/</span>免费开源</div><h1>让研究成为主角，<br /><em>让写作自然成形。</em></h1><p>从 LaTeX 源码到清晰 PDF，只需一张工作台。TeXloom 在本机编译，保留你的文件与目录，让写作、预览和审阅顺畅衔接。</p><div className="lp-hero-actions"><WorkspaceLink className="lp-button lp-button-primary" onEnter={onEnter}>打开工作台 <ArrowUpRight size={20} /></WorkspaceLink><a className="lp-button lp-button-text" href="#features">了解 TeXloom <ArrowDown size={17} /></a></div><div className="lp-hero-foot"><span><Check size={14} />核心功能免费开源</span><span><Check size={14} />无需平台账户</span><span><Check size={14} />源码保存在本机</span></div></div><ProductPreview /></div><div className="lp-hero-bottom"><div className="lp-container"><span>BUILT FOR THOUGHTFUL WRITING</span><span>WRITE <i /> COMPILE <i /> REVIEW</span></div></div></section>

      <section id="features" className="lp-features lp-container"><div className="lp-section-heading"><div><span className="lp-section-index">01 / THE ESSENTIALS</span><h2>一切围绕写作，<br />细节服务于思考。</h2></div><p>专业工具应当安静而可靠。TeXloom 将源码、成稿与项目组织放在你需要的位置。</p></div><div className="lp-feature-grid">{features.map(feature => <article className={`lp-feature lp-feature-${feature.accent}`} key={feature.number}><div className="lp-feature-top"><span className="lp-feature-icon">{feature.icon}</span><span className="lp-feature-number">{feature.number}</span></div><h3>{feature.title}</h3><p>{feature.copy}</p><span className="lp-feature-rule" /></article>)}</div></section>

      <section id="workflow" className="lp-workflow"><div className="lp-container lp-workflow-inner"><div className="lp-workflow-intro"><span className="lp-section-index">02 / THE FLOW</span><h2>从第一行源码，<br />到可以分享的论文。</h2><p>把工具切换留给 TeXloom，把注意力还给你的研究。</p><WorkspaceLink className="lp-workflow-link" onEnter={onEnter}>现在开始 <ArrowRight size={18} /></WorkspaceLink></div><div className="lp-workflow-steps"><div><span>01</span><i><FileCode2 size={24} /></i><h3>写</h3><p>在结构清晰的项目里编辑 LaTeX。</p></div><div><span>02</span><i><BookOpenText size={24} /></i><h3>编译</h3><p>本地 Tectonic 生成 PDF，随时对照。</p></div><div><span>03</span><i><GitBranch size={24} /></i><h3>协作</h3><p>用 GitHub 分支和审阅记录汇集意见。</p></div></div></div></section>

      <section id="open-source" className="lp-open-source lp-container"><div className="lp-open-source-mark"><ShieldCheck size={30} strokeWidth={1.5} /><span>YOUR WORK. YOUR SPACE.</span></div><div><span className="lp-section-index">03 / OPEN BY DESIGN</span><h2>你的论文，<br />始终由你掌控。</h2><p>TeXloom 免费开源。项目保存在你指定的本地目录，普通编辑与编译不需要云端账户。需要多人协作时，再连接你的 GitHub 仓库；AI 功能按需填写自己的 API Key。</p><div className="lp-open-source-actions"><WorkspaceLink className="lp-button lp-button-primary" onEnter={onEnter}>进入工作台 <ArrowUpRight size={19} /></WorkspaceLink><a href={githubUrl} target="_blank" rel="noopener noreferrer" className="lp-github-link"><Github size={18} /> 查看 GitHub 源码 <ArrowUpRight size={15} /></a></div></div></section>
    </main>

    <footer className="lp-footer"><div className="lp-container lp-footer-inner"><a className="lp-logo" href="/"><span><img src="/icon.png" alt="" /></span><strong>TeXloom</strong></a><p>为专注的研究与写作而造。</p><div><a href={githubUrl} target="_blank" rel="noopener noreferrer">GitHub <ArrowUpRight size={13} /></a><a href="#features">返回顶部 ↑</a></div></div></footer>
  </div>
}
