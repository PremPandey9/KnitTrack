export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 text-slate-900 selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              KT
            </div>
            <span className="font-semibold text-xl tracking-tight text-slate-900">
              KnitTrack
            </span>
          </div>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
            <span className="w-2 h-2 mr-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            System Initialized
          </span>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 flex flex-col items-center justify-center text-center">
        <div className="max-w-3xl space-y-6">
          <div className="inline-block px-3.5 py-1.5 rounded-full text-sm font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/60 mb-2">
            Next.js App Router • TypeScript • Tailwind CSS
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-tight">
            KnitTrack – Production Tracking System
          </h1>

          <p className="text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto">
            A specialized tracking and management platform designed for textile
            and garment manufacturing workflows.
          </p>

          {/* Status and Architecture Cards */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
            <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="text-indigo-600 font-semibold text-sm mb-1">Architecture</div>
              <div className="text-slate-900 font-medium">Next.js App Router</div>
              <p className="text-xs text-slate-500 mt-1">Modern React Server Components ready.</p>
            </div>

            <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="text-indigo-600 font-semibold text-sm mb-1">Type Safety</div>
              <div className="text-slate-900 font-medium">TypeScript</div>
              <p className="text-xs text-slate-500 mt-1">Strict type checking configured.</p>
            </div>

            <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="text-indigo-600 font-semibold text-sm mb-1">Styling</div>
              <div className="text-slate-900 font-medium">Tailwind CSS</div>
              <p className="text-xs text-slate-500 mt-1">Responsive utility-first classes.</p>
            </div>

            <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="text-indigo-600 font-semibold text-sm mb-1">Code Quality</div>
              <div className="text-slate-900 font-medium">ESLint</div>
              <p className="text-xs text-slate-500 mt-1">Standardized linting & code standards.</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-slate-500">
          © 2026 KnitTrack. Project initialized successfully.
        </div>
      </footer>
    </div>
  );
}
