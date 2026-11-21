import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpenText, Check, Code2, FileCode2, FileText, GitBranch, Github, Image as ImageIcon, LockKeyhole, MousePointer2, PanelRight, Pencil, ShieldCheck, Sparkles, FolderOpen, MessageSquareText, WandSparkles } from 'lucide-react'
import './landing.css'

const githubUrl = 'https://github.com/StuBoo3i/TeXloom'
const publicSite = import.meta.env.MODE === 'pages'
const workspaceUrl = publicSite ? githubUrl : '/?view=workspace'
const homeUrl = import.meta.env.BASE_URL
const iconUrl = `${homeUrl}icon.png`

const features = [
  { number: '01', icon: <FileCode2 size={24} strokeWidth={1.65} />, title: '两种视图，一份 LaTeX 源码', copy: '在 Visual 中阅读、修改正文与公式；需要精确控制时切回 Code。两种模式共用保存、撤销和编译。', accent: 'blue' },
  { number: '02', icon: <MousePointer2 size={24} strokeWidth={1.65} />, title: '源码与 PDF，双向抵达', copy: '编辑器与预览并排工作。通过 SyncTeX 在源码和成稿之间定位，修改不再靠翻页寻找。', accent: 'cyan' },
  { number: '03', icon: <LockKeyhole size={24} strokeWidth={1.65} />, title: '你的文件，留在你的电脑', copy: '选择自己的项目目录，用本地 Tectonic 编译。写作数据由你掌控，无需建立平台账户。', accent: 'sand' },
  { number: '04', icon: <Sparkles size={24} strokeWidth={1.65} />, title: '多家智能助手，接力完善文章', copy: '按需切换 Agent CLI 与 AI API；项目对话可共享近期上下文，文件修改先看差异再应用。', accent: 'lavender' },
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

function VisualShowcase({ onEnter }: { onEnter: () => void }) {
  return <section id="visual" className="lp-visual"><div className="lp-container lp-visual-inner">
    <div className="lp-visual-copy lp-reveal"><span className="lp-section-index">01 / VISUAL WRITING</span><h2>看见文章的样子，<br /><em>仍握住源码的力量。</em></h2><p>Visual 将 LaTeX 变成清晰的阅读与编辑界面：点击文字直接修改，公式就地预览，图片和表格以卡片呈现。排版结果始终由右侧 PDF 告诉你。</p><div className="lp-visual-points"><div><Pencil size={18} /><span><strong>所见即改</strong>正文、标题与公式在当前位置编辑</span></div><div><Code2 size={18} /><span><strong>随时切换</strong>Code / Visual 共用同一份源码</span></div><div><ImageIcon size={18} /><span><strong>图表成卡</strong>预览、评论或单独编译</span></div></div><WorkspaceLink className="lp-workflow-link" onEnter={onEnter}>{publicSite ? '了解 Visual 用法' : '体验可视化编辑'} <ArrowRight size={18} /></WorkspaceLink></div>
    <div className="lp-visual-stage lp-reveal" aria-label="Visual 编辑模式与 PDF 并排预览示意"><div className="lp-visual-window"><div className="lp-visual-window-top"><span>论文草稿 <b>›</b> main.tex</span><span className="lp-visual-saved"><Check size={13} /> 已保存</span></div><div className="lp-visual-window-body"><div className="lp-visual-document"><div className="lp-visual-document-head"><span>源文件</span><div className="lp-visual-switch"><span>Code</span><strong>Visual</strong></div></div><div className="lp-visual-tools">↶ &nbsp; ↷ &nbsp; H &nbsp; B &nbsp; 𝑰 &nbsp; ∑ &nbsp; Ω &nbsp; ↗ &nbsp; ▦</div><div className="lp-visual-page"><span className="lp-visual-eyebrow">可视化编辑 · 点击正文直接修改</span><h3>研究背景</h3><p>在这里组织思路，让文字、公式和图表自然地连成一篇文章。<Pencil size={11} /></p><div className="lp-visual-equation">E = mc² <Pencil size={11} /></div><div className="lp-visual-media"><div><ImageIcon size={14} /> 图表卡片 <span>查看预览 · 评论 · 单独编译</span></div><div className="lp-visual-media-art"><i /><i /><i /></div><small>图 1 · 一个清晰的示意图</small></div></div></div><div className="lp-visual-pdf"><div>PDF 预览 <span>完整编译结果</span></div><article><small>研究论文</small><h3>研究背景</h3><p>在这里组织思路，让文字、公式和图表自然地连成一篇文章。</p><strong>E = mc²</strong><div className="lp-visual-pdf-figure"><i /><i /><i /></div><small>图 1 · 一个清晰的示意图</small></article></div></div></div><span className="lp-visual-caption">VISUAL + PDF · 界面示意</span></div>
  </div></section>
}

function CollaborationShowcase({ onEnter }: { onEnter: () => void }) {
  return <section id="collaboration" className="lp-story lp-story-collab"><div className="lp-container lp-story-grid">
    <div className="lp-story-copy lp-reveal"><span className="lp-section-index">02 / SHARED THINKING</span><span className="lp-story-name">共识空间 · Shared Thinking</span><h2>好的研究，<br /><em>值得一起打磨。</em></h2><p>每个人在自己的 GitHub 分支上写作，远程分支可以只读查看。评论、回复与修改建议跟着审阅记录走，让讨论始终贴近文章。</p><ul><li><Check size={16} />个人分支提交，借助 Pull Request 汇合成果</li><li><Check size={16} />主分支禁止应用内直推，先审阅再合并</li><li><Check size={16} />接受建议前核对原文，减少误改</li></ul><WorkspaceLink className="lp-story-link" onEnter={onEnter}>{publicSite ? '了解协作方式' : '进入协作工作台'} <ArrowRight size={18} /></WorkspaceLink></div>
    <div className="lp-scene lp-scene-collab lp-reveal" aria-label="GitHub 分支与审阅讨论界面示意"><div className="lp-scene-top"><GitBranch size={17} /> 项目协作 <span>feature/method</span></div><div className="lp-branch-line"><span>main</span><i /><span>feature/method</span><strong>待审阅</strong></div><div className="lp-review-card"><div className="lp-review-quote">“这一段的定义可以再明确一些。”</div><div className="lp-review-author"><span>A</span><strong>研究成员 A</strong><small>第 3 节 · 修改建议</small></div></div><div className="lp-review-card lp-review-card-reply"><div className="lp-review-quote">“已补充边界条件，欢迎继续核对。”</div><div className="lp-review-author"><span>B</span><strong>研究成员 B</strong><small>已回复</small></div></div><div className="lp-scene-note"><MessageSquareText size={17} /> 从分支到讨论，每一步都有上下文</div></div>
  </div></section>
}

function LocalShowcase({ onEnter }: { onEnter: () => void }) {
  return <section id="local" className="lp-story lp-story-local"><div className="lp-container lp-story-grid">
    <div className="lp-scene lp-scene-local lp-reveal" aria-label="本地项目分类与文件夹管理界面示意"><div className="lp-scene-top"><FolderOpen size={17} /> 本地工作空间 <span>仅保存在此电脑</span></div><div className="lp-local-layout"><aside><strong>项目空间</strong><span className="active">所有项目 <b>03</b></span><span>个人项目 <b>02</b></span><span>共享项目 <b>01</b></span><span>归档 <b>00</b></span><small>我的标签</small><span>论文 · 2026</span></aside><div><div className="lp-local-search">⌕ &nbsp; 搜索项目、标签与文件</div><div className="lp-local-cards"><article><FileText size={21} /><strong>研究论文</strong><small>main.tex</small><span>论文 · 2026</span></article><article><FileText size={21} /><strong>实验报告</strong><small>report.tex</small><span>个人项目</span></article></div></div></div><div className="lp-scene-note"><ShieldCheck size={17} /> 项目目录由你选择，整理也在本机完成</div></div>
    <div className="lp-story-copy lp-reveal"><span className="lp-section-index">03 / YOUR SPACE</span><span className="lp-story-name">有序之所 · Your Space</span><h2>项目井然有序，<br /><em>文件自在本地。</em></h2><p>从新建、ZIP 或文件夹导入开始，用分类、标签和搜索找到每一份工作。项目根目录由你决定，批量导出也保留清晰的文件结构。</p><ul><li><Check size={16} />自选本地根目录，已有项目仍可打开</li><li><Check size={16} />按个人、共享、归档和标签整理项目</li><li><Check size={16} />批量导入导出，适合迁移与备份</li></ul><WorkspaceLink className="lp-story-link" onEnter={onEnter}>{publicSite ? '了解本地管理' : '整理我的项目'} <ArrowRight size={18} /></WorkspaceLink></div>
  </div></section>
}

function AiShowcase({ onEnter }: { onEnter: () => void }) {
  return <section id="ai" className="lp-story lp-story-ai"><div className="lp-container lp-story-grid">
    <div className="lp-story-copy lp-reveal"><span className="lp-section-index">04 / CONNECTED INTELLIGENCE</span><span className="lp-story-name">多家智能 · 同一篇论文</span><h2>让不同的智能，<br /><em>接续你的思考。</em></h2><p>选定项目文件，向 Codex、Gemini、Claude Code 或豆包 CLI 提问。切换服务商或账号时，近期项目对话可作为下一位助手的背景；每位助手仍保留自己的会话。</p><div className="lp-ai-provider-line"><span>Agent CLI</span><b>Codex</b><b>Gemini</b><b>Claude Code</b><b>豆包</b></div><div className="lp-ai-provider-line lp-ai-provider-line-api"><span>AI API</span><b>DeepSeek</b><b>火山引擎</b><b>阿里云百炼</b><b>OpenAI</b><b>Claude</b></div><ul><li><Check size={16} />按任务选模型、账号与智能程度，继续同一项目讨论</li><li><Check size={16} />对照文件差异，确认后才将 Agent 修改写入项目</li><li><Check size={16} />AI API 快捷工具另行支持翻译、润色、公式与宏包建议</li></ul><WorkspaceLink className="lp-story-link" onEnter={onEnter}>{publicSite ? '了解多服务商 AI' : '打开 Agent CLI'} <ArrowRight size={18} /></WorkspaceLink></div>
    <div className="lp-scene lp-scene-ai lp-reveal" aria-label="多服务商 Agent CLI 项目会话与修改预览界面示意"><div className="lp-scene-top"><Sparkles size={17} /> Agent CLI · 项目会话 <span>界面示意</span></div><div className="lp-ai-switch"><span className="active">Codex CLI</span><span>Gemini CLI</span><span>Claude Code</span><span>豆包 CLI</span></div><div className="lp-ai-context"><FileText size={14} /><span>main.tex</span><span>references.bib</span><small>所选项目文件</small></div><div className="lp-ai-thread"><div><small>你 · 研究论文</small><p>检查这段证明的条件，并提出更清晰的表达。</p></div><div><small>Codex CLI · 结构分析</small><p>建议补充边界条件，并将结论前移。</p></div><div className="lp-ai-thread-next"><small>Gemini CLI · 切换后继续</small><p>参考已有讨论，核对公式引用并给出改写。</p></div></div><div className="lp-ai-review"><div><span><ShieldCheck size={14} /> 修改待审阅</span><small>main.tex · 先看差异</small></div><p><del>由此可以得到结论。</del><br /><ins>在上述边界条件下，结论成立。</ins></p><strong>确认后应用修改 <ArrowRight size={13} /></strong></div><div className="lp-ai-api-note"><WandSparkles size={14} /><span>AI API 快捷工具 · 翻译 / 润色 / 公式 / 表格 / 宏包建议</span></div></div>
  </div></section>
}

function ProductPreview() {
  return <div className="lp-preview-wrap">
    <div className="lp-preview-orbit lp-preview-orbit-one" /><div className="lp-preview-orbit lp-preview-orbit-two" />
    <div className="lp-preview" aria-label="TeXloom 编辑器与 PDF 预览界面示意">
      <div className="lp-preview-top"><div className="lp-window-dots"><i /><i /><i /></div><span className="lp-preview-brand"><img src={iconUrl} alt="" />TeXloom</span><span className="lp-preview-local"><i />本地工作空间</span></div>
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
  const pageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const roots = [document.documentElement, document.body, document.getElementById('root')]
    roots.forEach(root => root?.classList.add('landing-scroll-enabled'))
    return () => roots.forEach(root => root?.classList.remove('landing-scroll-enabled'))
  }, [])
  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sections = [...page.querySelectorAll<HTMLElement>('main > section')]
    const header = page.querySelector<HTMLElement>('.lp-header')
    let gateTarget = -1
    let gateDirection = 0
    let gateDistance = 0
    let lockedUntil = 0

    const resetGate = () => {
      gateTarget = -1
      gateDirection = 0
      gateDistance = 0
    }

    const onWheel = (event: WheelEvent) => {
      if (reducedMotion.matches || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1
      const delta = event.deltaY * unit
      if (!delta) return
      const now = performance.now()
      if (now < lockedUntil) {
        event.preventDefault()
        return
      }

      const headerHeight = header?.getBoundingClientRect().height ?? 0
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      const positions = sections.map(section => Math.min(maxScroll, Math.max(0, section.getBoundingClientRect().top + window.scrollY - headerHeight)))
      let current = positions.length - 1
      while (current > 0 && positions[current] > window.scrollY + 2) current--
      const direction = Math.sign(delta)
      const destination = direction > 0 ? positions[current + 1] : positions[current - 1]
      const edgeDistance = direction > 0 ? destination - window.scrollY : window.scrollY - positions[current]
      if (destination === undefined || edgeDistance > 180 || edgeDistance < -2) {
        resetGate()
        return
      }

      event.preventDefault()
      if (gateTarget !== destination || gateDirection !== direction) {
        gateDistance = 0
      }
      gateTarget = destination
      gateDirection = direction
      gateDistance += Math.min(Math.abs(delta), 120)
      if (gateDistance < 140) return

      resetGate()
      lockedUntil = now + 420
      window.scrollTo({ top: destination, behavior: 'smooth' })
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    const clear = () => { resetGate(); lockedUntil = 0 }
    window.addEventListener('pointerdown', clear)
    window.addEventListener('keydown', clear)
    window.addEventListener('hashchange', clear)
    reducedMotion.addEventListener('change', clear)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerdown', clear)
      window.removeEventListener('keydown', clear)
      window.removeEventListener('hashchange', clear)
      reducedMotion.removeEventListener('change', clear)
    }
  }, [])
  useEffect(() => {
    const page = pageRef.current
    if (!page || !('IntersectionObserver' in window)) return
    const items = [...page.querySelectorAll<HTMLElement>('.lp-reveal')]
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      entry.target.classList.toggle('is-visible', entry.isIntersecting)
    }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    items.forEach(item => observer.observe(item))
    page.classList.add('lp-motion-ready')
    return () => observer.disconnect()
  }, [])
  return <div className="landing-page" id="top" ref={pageRef}>
    <header className="lp-header"><div className="lp-container lp-header-inner"><a className="lp-logo" href={homeUrl} aria-label="TeXloom 首页"><span><img src={iconUrl} alt="" /></span><strong>TeXloom</strong></a><nav aria-label="首页导航"><a href="#visual">Visual 编辑</a><a href="#collaboration">多人协作</a><a href="#local">本地管理</a><a href="#ai">多服务商 AI</a></nav><WorkspaceLink className="lp-nav-cta" onEnter={onEnter}>{publicSite ? '获取 TeXloom' : '打开工作台'} <ArrowUpRight size={16} /></WorkspaceLink></div></header>

    <main>
      <section className="lp-hero"><div className="lp-container lp-hero-grid"><div className="lp-hero-copy"><div className="lp-kicker"><span className="lp-kicker-line" />本地 LaTeX 写作工作台<span className="lp-kicker-separator">/</span>免费开源</div><h1>让研究成为主角，<br /><em>让写作自然成形。</em></h1><p>在优雅的 Visual 模式中直接写作，随时切回 LaTeX 源码精确控制；右侧 PDF 同步呈现本地编译结果。你的文件与目录始终由你掌控。</p><div className="lp-hero-actions"><WorkspaceLink className="lp-button lp-button-primary" onEnter={onEnter}>{publicSite ? '获取 TeXloom' : '打开工作台'} <ArrowUpRight size={20} /></WorkspaceLink><a className="lp-button lp-button-text" href="#visual">探索 Visual 编辑 <ArrowDown size={17} /></a></div><div className="lp-hero-foot"><span><Check size={14} />Visual 与 Code 自由切换</span><span><Check size={14} />本机编译 PDF</span><span><Check size={14} />源码保存在本机</span></div></div><ProductPreview /></div><div className="lp-hero-bottom"><div className="lp-container"><span>BUILT FOR THOUGHTFUL WRITING</span><span>WRITE <i /> COMPILE <i /> REVIEW</span></div></div></section>

      <VisualShowcase onEnter={onEnter} />

      <CollaborationShowcase onEnter={onEnter} />
      <LocalShowcase onEnter={onEnter} />
      <AiShowcase onEnter={onEnter} />

      <section id="features" className="lp-features lp-container"><div className="lp-section-heading lp-reveal"><div><span className="lp-section-index">05 / THE ESSENTIALS</span><h2>一切围绕写作，<br />细节服务于思考。</h2></div><p>专业工具应当安静而可靠。TeXloom 将源码、成稿与项目组织放在你需要的位置。</p></div><div className="lp-feature-grid">{features.map(feature => <article className={`lp-feature lp-feature-${feature.accent} lp-reveal`} key={feature.number}><div className="lp-feature-top"><span className="lp-feature-icon">{feature.icon}</span><span className="lp-feature-number">{feature.number}</span></div><h3>{feature.title}</h3><p>{feature.copy}</p><span className="lp-feature-rule" /></article>)}</div></section>

      <section id="workflow" className="lp-workflow"><div className="lp-container lp-workflow-inner"><div className="lp-workflow-intro lp-reveal"><span className="lp-section-index">06 / THE FLOW</span><h2>从眼前的文字，<br />到可以分享的论文。</h2><p>Visual 帮你专注内容，Code 让每一处细节可控；TeXloom 在本机编译正式 PDF。</p><WorkspaceLink className="lp-workflow-link" onEnter={onEnter}>{publicSite ? '查看项目源码' : '现在开始'} <ArrowRight size={18} /></WorkspaceLink></div><div className="lp-workflow-steps lp-reveal"><div><span>01</span><i><FileCode2 size={24} /></i><h3>写</h3><p>在 Visual 或 Code 中编辑同一份 LaTeX。</p></div><div><span>02</span><i><BookOpenText size={24} /></i><h3>编译</h3><p>本地 Tectonic 生成 PDF，随时对照。</p></div><div><span>03</span><i><GitBranch size={24} /></i><h3>协作</h3><p>用 GitHub 分支和审阅记录汇集意见。</p></div></div></div></section>

      <section id="open-source" className="lp-open-source lp-container"><div className="lp-open-source-mark lp-reveal"><ShieldCheck size={30} strokeWidth={1.5} /><span>YOUR WORK. YOUR SPACE.</span></div><div><span className="lp-section-index">07 / OPEN BY DESIGN</span><h2>你的论文，<br />始终由你掌控。</h2><p>TeXloom 免费开源。项目保存在你指定的本地目录，普通编辑与编译不需要云端账户。需要多人协作时，再连接你的 GitHub 仓库；需要 AI 时，选择自己的 API 或已登录的 CLI。</p><div className="lp-open-source-actions"><WorkspaceLink className="lp-button lp-button-primary" onEnter={onEnter}>{publicSite ? '获取 TeXloom' : '进入工作台'} <ArrowUpRight size={19} /></WorkspaceLink><a href={githubUrl} target="_blank" rel="noopener noreferrer" className="lp-github-link"><Github size={18} /> 查看 GitHub 源码 <ArrowUpRight size={15} /></a></div></div></section>
    </main>

    <footer className="lp-footer"><div className="lp-container lp-footer-inner"><a className="lp-logo" href={homeUrl}><span><img src={iconUrl} alt="" /></span><strong>TeXloom</strong></a><p>为专注的研究与写作而造。</p><div><a href={githubUrl} target="_blank" rel="noopener noreferrer">GitHub <ArrowUpRight size={13} /></a><a href="#top">返回顶部 ↑</a></div></div></footer>
  </div>
}
