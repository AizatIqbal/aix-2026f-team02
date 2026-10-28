//React hooks manage UI state and timed effects; the types describe form events and JSX children
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

type IconProps = { children: ReactNode }

// Shared SVG wrapper: keeps the size and stroke style consistent across the app
function Icon({ children }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      {children}
    </svg>
  )
}

// Reusable PointNull logo used in the landing page, dashboard, and loading screen
function Logo() {
  return (
    <a href="#" className="logo" aria-label="PointNull home">
      <span className="logo-mark" aria-hidden="true">
        <span />
      </span>
      PointNull
    </a>
  )
}

// Static dashboard mockup shown on the landing page to preview the product visually
// Dummy data only for now
function DashboardPreview() {
  return (
    <div className="dashboard-shell" aria-label="PointNull dashboard preview">
      <aside className="dashboard-sidebar">
        <div className="mini-logo">
          <span />
        </div>
        <div className="sidebar-links">
          <span className="active" />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="avatar">AM</div>
      </aside>

      <div className="dashboard-main">
        <div className="dashboard-top">
          <div>
            <p className="eyebrow">TUESDAY, 12 MARCH</p>
            <h2>Good morning, Alex.</h2>
          </div>
          <button className="new-button">+ New invoice</button>
        </div>

        <div className="metric-grid">
          <div className="metric">
            <span>Revenue</span>
            <strong>$24,850</strong>
            <small className="positive">↗ 12.4%</small>
          </div>
          <div className="metric">
            <span>Expenses</span>
            <strong>$8,420</strong>
            <small>↘ 3.1%</small>
          </div>
          <div className="metric">
            <span>Outstanding</span>
            <strong>$5,200</strong>
            <small>4 invoices</small>
          </div>
        </div>

        <div className="dashboard-lower">
          <div className="chart-card">
            <div className="card-heading">
              <div>
                <span>Cash flow</span>
                <strong>$16,430</strong>
              </div>
              <small>Last 6 months</small>
            </div>
            <div className="chart">
              <div className="chart-grid"><i /><i /><i /></div>
              <svg viewBox="0 0 500 150" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity=".28" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0 118 C60 105 76 55 135 71 C190 86 220 30 275 55 C335 82 360 22 420 37 C455 45 474 22 500 14 L500 150 L0 150 Z"
                  fill="url(#area)"
                />
                <path
                  d="M0 118 C60 105 76 55 135 71 C190 86 220 30 275 55 C335 82 360 22 420 37 C455 45 474 22 500 14"
                  stroke="#3b82f6"
                  strokeWidth="4"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <div className="chart-labels">
                <span>Oct</span><span>Nov</span><span>Dec</span><span>Jan</span><span>Feb</span><span>Mar</span>
              </div>
            </div>
          </div>

          <div className="activity-card">
            <div className="card-heading">
              <span>Recent activity</span>
              <button>View all</button>
            </div>
            <div className="activity-list">
              <div><b className="activity-icon green">✓</b><p><strong>Invoice paid</strong><small>North & Co · $1,240</small></p></div>
              <div><b className="activity-icon blue">↗</b><p><strong>Invoice sent</strong><small>Studio Frame · $840</small></p></div>
              <div><b className="activity-icon yellow">$</b><p><strong>Expense added</strong><small>Software · $49</small></p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Main dashboard layout. Most values and invoice rows below are currently sample data
function FullDashboard() {
  return (
    <div className="app-dashboard">
      <aside className="app-sidebar">
        <Logo />
        <nav className="app-nav" aria-label="Dashboard navigation">
          <a className="selected" href="/dashboard"><Icon><path d="M3 11.5 12 4l9 7.5V20H3Z" /><path d="M9 20v-6h6v6" /></Icon><span>Overview</span></a>
          <a href="#"><Icon><path d="M5 3h12l2 2v16H5Z" /><path d="M8 9h8M8 13h8M8 17h5" /></Icon><span>Invoices</span></a>
          <a href="#"><Icon><path d="M4 6h16v13H4Z" /><path d="M4 10h16M8 15h3" /></Icon><span>Expenses</span></a>
          <a href="#"><Icon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></Icon><span>Customers</span></a>
          <a href="#"><Icon><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></Icon><span>Reports</span></a>
        </nav>
        <div className="sidebar-bottom">
          <a href="#"><Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></Icon><span>Settings</span></a>
          <div className="user-card"><span>AM</span><p><strong>Alex Morgan</strong><small>alex@pointnull.co</small></p><b>•••</b></div>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-topbar">
          <div><p>OVERVIEW</p><h1>Good morning, Alex.</h1></div>
          <div className="top-actions">
            <button className="notification" aria-label="Notifications"><Icon><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></Icon><span /></button>
            <button className="button button-accent">+ New invoice</button>
          </div>
        </header>

        {/* Summary cards use placeholder figures until real API/database data is connected. */}
        <section className="dashboard-stats" aria-label="Business summary">
          <article><div className="stat-label"><span>Revenue</span><b className="stat-icon blue">↗</b></div><strong>$24,850</strong><p><em>+12.4%</em> from last month</p></article>
          <article><div className="stat-label"><span>Expenses</span><b className="stat-icon violet">↘</b></div><strong>$8,420</strong><p><em>−3.1%</em> from last month</p></article>
          <article><div className="stat-label"><span>Outstanding</span><b className="stat-icon amber">$</b></div><strong>$5,200</strong><p>Across 4 invoices</p></article>
          <article><div className="stat-label"><span>Customers</span><b className="stat-icon green">+</b></div><strong>128</strong><p><em>+8</em> this month</p></article>
        </section>

        {/* Charts and quick actions are visual prototypes; the buttons do not yet perform CRUD actions. */}
        <section className="dashboard-content">
          <article className="panel cash-panel">
            <div className="panel-title"><div><h2>Cash flow</h2><p>Money in and out over time</p></div><button>Last 6 months⌄</button></div>
            <div className="cash-summary"><div><span>Net cash flow</span><strong>$16,430</strong></div><p><i className="in-dot" /> Income <b>$24.8k</b><i className="out-dot" /> Expenses <b>$8.4k</b></p></div>
            <div className="full-chart">
              <div className="y-labels"><span>$30k</span><span>$20k</span><span>$10k</span><span>$0</span></div>
              <div className="chart-stage">
                <i /><i /><i /><i />
                <svg viewBox="0 0 700 210" preserveAspectRatio="none" aria-hidden="true">
                  <defs><linearGradient id="fullArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity=".24" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></linearGradient></defs>
                  <path d="M0 160 C70 145 90 90 150 110 C220 135 255 55 325 80 C390 104 435 45 495 62 C555 79 610 35 700 24 L700 210 L0 210Z" fill="url(#fullArea)" />
                  <path d="M0 160 C70 145 90 90 150 110 C220 135 255 55 325 80 C390 104 435 45 495 62 C555 79 610 35 700 24" fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" />
                </svg>
                <div className="x-labels"><span>Oct</span><span>Nov</span><span>Dec</span><span>Jan</span><span>Feb</span><span>Mar</span></div>
              </div>
            </div>
          </article>

          <article className="panel action-panel">
            <div className="panel-title"><div><h2>Quick actions</h2><p>Common tasks, one click away</p></div></div>
            <div className="quick-actions">
              <button><b className="blue"><Icon><path d="M12 5v14M5 12h14" /></Icon></b><span><strong>Create invoice</strong><small>Bill a customer</small></span><em>→</em></button>
              <button><b className="violet"><Icon><path d="M4 6h16v13H4Z" /><path d="M4 10h16" /></Icon></b><span><strong>Add expense</strong><small>Record a purchase</small></span><em>→</em></button>
              <button><b className="green"><Icon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></Icon></b><span><strong>Add customer</strong><small>Grow your list</small></span><em>→</em></button>
            </div>
          </article>
        </section>

        {/* Example invoice rows for layout testing; replace with records from the backend later. */}
        <section className="panel invoices-panel">
          <div className="panel-title"><div><h2>Recent invoices</h2><p>Your latest customer billing</p></div><button>View all invoices →</button></div>
          <div className="invoice-table">
            <div className="table-row table-head"><span>INVOICE</span><span>CUSTOMER</span><span>DATE</span><span>AMOUNT</span><span>STATUS</span><span /></div>
            <div className="table-row"><strong>#PN-1048</strong><span>North & Co.</span><span>Mar 12, 2025</span><strong>$1,240.00</strong><span><i className="status paid">Paid</i></span><b>•••</b></div>
            <div className="table-row"><strong>#PN-1047</strong><span>Studio Frame</span><span>Mar 10, 2025</span><strong>$840.00</strong><span><i className="status sent">Sent</i></span><b>•••</b></div>
            <div className="table-row"><strong>#PN-1046</strong><span>Willow Goods</span><span>Mar 8, 2025</span><strong>$2,100.00</strong><span><i className="status overdue">Overdue</i></span><b>•••</b></div>
          </div>
        </section>
      </main>
    </div>
  )
}

// Brief transition screen displayed after the demo login form is submitted
function MoneyLoadingScreen() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.href = '/dashboard'
    }, 3200)

    return () => window.clearTimeout(timer)
  }, [])

  return (
    <main className="money-loader">
      <div className="loader-glow glow-one" />
      <div className="loader-glow glow-two" />
      <section className="loader-content">
        <Logo />
        <div className="loader-message">
          <p>YOUR WORKSPACE IS READY</p>
          <h1>Let’s make money,<br /><em>boss.</em></h1>
          <span>Crunching the numbers and preparing your dashboard.</span>
        </div>
        <div className="growth-loader" aria-label="Loading dashboard">
          <div className="growth-grid"><i /><i /><i /><i /></div>
          <svg viewBox="0 0 620 230" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="loaderArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity=".3" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
              <clipPath id="loaderReveal">
                <rect className="chart-reveal" x="0" y="0" width="620" height="230" />
              </clipPath>
            </defs>
            <g clipPath="url(#loaderReveal)">
              <path className="loader-area" d="M0 201 C62 194 75 170 125 177 C182 185 202 127 257 143 C318 160 337 92 395 111 C444 126 476 73 520 81 C559 88 586 40 620 25 L620 230 L0 230Z" fill="url(#loaderArea)" />
              <path className="loader-line" d="M0 201 C62 194 75 170 125 177 C182 185 202 127 257 143 C318 160 337 92 395 111 C444 126 476 73 520 81 C559 88 586 40 620 25" />
            </g>
            <circle className="loader-point" cx="620" cy="25" r="7" />
          </svg>
          <div className="loader-values"><span>Starting up</span><strong>Growing your business</strong></div>
        </div>
        <div className="loader-progress"><span /></div>
      </section>
    </main>
  )
}
// Root component: chooses which screen to render based on the current URL path
function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)


  // Demo-only login
  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    window.location.href = '/loading'
  }

  if (window.location.pathname === '/loading') {
    return <MoneyLoadingScreen />
  }

  if (window.location.pathname === '/dashboard' || window.location.pathname === '/login') {
    return <FullDashboard />
  }

  return (
    <div className="site">
      <header className="nav-wrap">
        <nav className="nav" aria-label="Main navigation">
          <Logo />
          <div className={`nav-links ${menuOpen ? 'open' : ''}`}>
            <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
            <a href="#resources" onClick={() => setMenuOpen(false)}>Resources</a>
          </div>
          <div className="nav-actions">
            <button className="login-link" onClick={() => setLoginOpen(true)}>Log in</button>
            <a className="button button-dark button-small" href="/signup">
              Sign up <span aria-hidden="true">↗</span>
            </a>
          </div>
          <button
            className="menu-button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            <span /><span />
          </button>
        </nav>
      </header>

      <main>
        {/* Public landing page: marketing copy and a visual preview of the dashboard. */}
        <section className="hero">
          <div className="hero-copy">
            <h1>Run your business.<br /><em>Skip the busywork.</em></h1>
            <p>
              Invoices, customers, expenses, and insights—all in one calm,
              simple workspace built to help you move forward.
            </p>
            <div className="hero-actions">
              <a className="button button-accent" href="/signup">
                Start for free <span aria-hidden="true">↗</span>
              </a>
              <a className="text-link" href="#how-it-works">
                See how it works <span aria-hidden="true">↓</span>
              </a>
            </div>
            <div className="trust-row">
              <div className="avatar-stack"><span>JL</span><span>AR</span><span>MK</span></div>
              <small><strong>Join 2,000+ founders</strong><br />No credit card required</small>
            </div>
          </div>

          <div className="hero-visual">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-note note-income"><span>↗</span><small>Income this month</small><strong>+$8,420</strong></div>
            <div className="floating-note note-paid"><span>✓</span><p><strong>Invoice paid</strong><small>Right on time</small></p></div>
            <DashboardPreview />
          </div>
        </section>

        <section className="proof">
          <p>THE SIMPLE WAY TO STAY ON TOP OF</p>
          <div className="proof-items">
            <span>Customers</span><i>✦</i><span>Invoices</span><i>✦</i><span>Expenses</span><i>✦</i><span>Cash flow</span>
          </div>
        </section>

        <section className="features" id="features">
          <div className="section-label">01 — WHAT YOU GET</div>
          <div className="section-intro">
            <h2>Less admin.<br /><em>More momentum.</em></h2>
            <p>PointNull brings the essentials together, so you always know what needs your attention—and what doesn’t.</p>
          </div>
          <div className="feature-grid">
            <article className="feature-card feature-accent">
              <div className="feature-icon">
                <Icon><path d="M7 3h8l4 4v14H5V3h2Z" /><path d="M14 3v5h5M8 13h8M8 17h5" /></Icon>
              </div>
              <span>01</span>
              <h3>Get paid without the chase.</h3>
              <p>Create polished invoices, send reminders, and know exactly what’s been paid.</p>
            </article>
            <article className="feature-card feature-cream">
              <div className="feature-icon">
                <Icon><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" /><path d="M12 7v5l3 2" /></Icon>
              </div>
              <span>02</span>
              <h3>See where your money goes.</h3>
              <p>Track expenses in seconds and keep your cash flow clear without a spreadsheet.</p>
            </article>
            <article className="feature-card feature-navy">
              <div className="feature-icon">
                <Icon><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></Icon>
              </div>
              <span>03</span>
              <h3>Make decisions with confidence.</h3>
              <p>Friendly reports turn your numbers into a clear view of how your business is doing.</p>
            </article>
          </div>
        </section>

        <section className="final-cta" id="pricing">
          <span className="section-label">READY WHEN YOU ARE</span>
          <h2>Your business starts here.</h2>
          <p>Set up your workspace in minutes. Keep it simple from day one.</p>
          <a className="button button-accent" href="/signup">Create your free account <span>↗</span></a>
          <small>Free to start · No credit card needed</small>
        </section>
      </main>

      <footer>
        <Logo />
        <p>Simple business management for people building something meaningful.</p>
        <div><button onClick={() => setLoginOpen(true)}>Log in</button><a href="/signup">Sign up</a></div>
      </footer>

      {loginOpen && (
        <div className="login-overlay" role="presentation" onMouseDown={() => setLoginOpen(false)}>
          <section
            className="login-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setLoginOpen(false)} aria-label="Close login">
              ×
            </button>
            <span className="modal-logo"><span /></span>
            <p className="modal-kicker">WELCOME BACK</p>
            <h2 id="login-title">Log in to PointNull</h2>
            <p className="modal-copy">Enter your details to continue to your workspace.</p>
            <form onSubmit={handleLogin}>
              <label>
                Email address
                <input type="email" name="email" placeholder="you@company.com" autoComplete="email" required autoFocus />
              </label>
              <label>
                <span>Password <a href="#">Forgot password?</a></span>
                <input type="password" name="password" placeholder="Enter your password" autoComplete="current-password" minLength={6} required />
              </label>
              <button className="button button-accent login-submit" type="submit">
                Log in <span aria-hidden="true">→</span>
              </button>
            </form>
            <p className="signup-prompt">New to PointNull? <a href="/signup">Create an account</a></p>
          </section>
        </div>
      )}
    </div>
  )
}

// Makes App available to the Vite entry point (main.tsx)
export default App
