import { useEffect, useState } from 'react';
import { ChevronRight, Copy, Layers3, Menu, Search } from 'lucide-react';
import { motion } from 'motion/react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@orbit/ui';
import { CommandPalette, Sidebar, ThemeControl, labSections } from '../components/LabNavigation';
import {
  ColorSection,
  FoundationIntro,
  OrbitArtwork,
  TypographySection,
  copyTokens,
} from '../components/FoundationSections';
import { ComponentSection, PatternSection } from '../components/ComponentDemos';
import { SystemStatus, useLiveness } from '../components/SystemStatus';
import { useUI } from '../state/ui';

export default function DesignLab() {
  const [active, setActive] = useState('overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const setCommandOpen = useUI((state) => state.setCommandOpen);
  const live = useLiveness();
  useEffect(() => {
    document.title = 'Design system · ORBIT';
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: '-15% 0px -65% 0px' },
    );
    for (const section of labSections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <div className="lab-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="desktop-sidebar">
        <Sidebar active={active} />
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
              <DialogTrigger asChild>
                <Button
                  className="mobile-menu"
                  variant="ghost"
                  size="icon"
                  aria-label="Open navigation"
                >
                  <Menu />
                </Button>
              </DialogTrigger>
              <DialogContent sheet className="navigation-sheet">
                <DialogTitle className="sr-only">Lab navigation</DialogTitle>
                <DialogDescription className="sr-only">
                  Jump to a design system section.
                </DialogDescription>
                <Sidebar active={active} navigate={() => setMobileOpen(false)} />
              </DialogContent>
            </Dialog>
            <Layers3 size={14} />
            <span>ORBIT</span>
            <ChevronRight size={13} />
            <strong>Design system</strong>
          </div>
          <div className="topbar-actions">
            <span className={`api-pill ${live.data ? 'alive' : ''}`}>
              <span />
              {live.data ? 'API online' : live.isPending ? 'Connecting' : 'API offline'}
            </span>
            <span className="topbar-divider" />
            <ThemeControl />
            <Button
              variant="ghost"
              size="icon"
              className="mobile-search"
              aria-label="Search the design system"
              onClick={() => setCommandOpen(true)}
            >
              <Search />
            </Button>
          </div>
        </header>
        <main id="main-content" className="lab-main">
          <motion.section
            id="overview"
            tabIndex={-1}
            className="overview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="page-heading">
              <div>
                <div className="page-eyebrow">
                  <span className="tiny-orbit" /> THE FOUNDATION OF FOCUSED WORK
                </div>
                <h1>
                  Design system<span>.</span>
                </h1>
                <p>A shared language for everything in your orbit.</p>
              </div>
              <Button variant="secondary" size="small" onClick={() => void copyTokens()}>
                <Copy /> Copy theme tokens
              </Button>
            </div>
            <div className="hero-panel">
              <div className="hero-copy">
                <Badge tone="violet">
                  <span className="badge-dot" /> ORBIT DESIGN LANGUAGE
                </Badge>
                <h2>
                  Built for clarity.
                  <br />
                  <span>Designed for momentum.</span>
                </h2>
                <p>
                  Thoughtful foundations for an intelligent work operating system. Explore the
                  details that make the difference.
                </p>
                <div className="hero-tags">
                  <span>
                    <span className="tag-dot violet" /> Theme-aware
                  </span>
                  <span>
                    <span className="tag-dot cyan" /> Accessible
                  </span>
                  <span>
                    <span className="tag-dot green" /> Responsive
                  </span>
                </div>
              </div>
              <OrbitArtwork />
            </div>
            <FoundationIntro />
          </motion.section>
          <ColorSection />
          <TypographySection />
          <ComponentSection />
          <PatternSection />
          <SystemStatus />
          <footer className="lab-footer">
            <span>
              <img src="/orbit.svg" alt="" width="17" height="17" /> A little structure. Infinite
              possibility.
            </span>
            <span>ORBIT · Phase 0 foundation</span>
          </footer>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
