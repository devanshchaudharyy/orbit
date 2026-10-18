import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Layers3,
  Menu,
  Play,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Accordion,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@orbit/ui';
import { ThemeControl } from '../components/ThemeControl';
import {
  ProductPreview,
  WorkflowIllustration,
  NotesIllustration,
} from '../components/ProductPreview';
import './marketing.css';

const plans = [
  {
    name: 'Free',
    monthly: 0,
    annual: 0,
    description: 'A little structure for your next big idea.',
    features: [
      'A personal workspace',
      'Projects and essential task views',
      'A thoughtful place to begin',
    ],
  },
  {
    name: 'Pro',
    monthly: 12,
    annual: 10,
    description: 'A shared rhythm for teams moving forward.',
    features: [
      'Everything in Free',
      'CSV exports and scheduled AI drafts',
      'Larger workspace and project limits',
    ],
  },
  {
    name: 'Business',
    monthly: 24,
    annual: 20,
    description: 'Clarity that grows with your organization.',
    features: [
      'Everything in Pro',
      'More workspaces and projects',
      'Higher scheduled workflow limits',
    ],
  },
];
const tour = [
  {
    title: 'Start with a shared direction.',
    text: 'Bring the idea, the project, and the milestone into the same conversation. The planned workspace keeps the why close to the work.',
    icon: Target,
  },
  {
    title: 'See work your way.',
    text: 'Try Board and List in the preview below. Filter to design tasks, then open a card to explore its sample details.',
    icon: Layers3,
  },
  {
    title: 'Make room for what’s next.',
    text: 'Create a verified account and an organization, then bring projects, planning, collaboration and documents into one place. Organization owners can configure test-mode subscriptions; production billing is not enabled.',
    icon: Sparkles,
  },
];
const navigation = [
  { label: 'Product', href: '#product' },
  { label: 'Why ORBIT', href: '#why-orbit' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQs', href: '#faq' },
];

export default function Marketing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [annual, setAnnual] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<(typeof plans)[number] | null>(null);
  const tourTrigger = useRef<HTMLElement | null>(null);
  const planTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    document.title = 'ORBIT — Make space for great work';
  }, []);
  const currentStep = tour[step]!;
  function openTour() {
    tourTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStep(0);
    setTourOpen(true);
  }
  return (
    <div className="marketing">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="marketing-header">
        <div className="marketing-nav-wrap">
          <a className="marketing-brand" href="/" aria-label="ORBIT home">
            <img src="/orbit.svg" alt="" width="30" height="30" />
            orbit<span>.</span>
          </a>
          <nav className="marketing-desktop-nav" aria-label="Main navigation">
            {navigation.map((item) => (
              <a href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="marketing-nav-actions">
            <ThemeControl />
            <a className="marketing-login-link" href="/auth/login">
              Sign in
            </a>
            <Button size="small" asChild>
              <a href="/auth/register">
                Create account <ArrowUpRight size={14} />
              </a>
            </Button>
            <button
              className="marketing-menu-toggle"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav
            id="mobile-navigation"
            className="marketing-mobile-nav"
            aria-label="Mobile navigation"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setMenuOpen(false);
                document.querySelector<HTMLButtonElement>('.marketing-menu-toggle')?.focus();
              }
            }}
          >
            {navigation.map((item) => (
              <a href={item.href} key={item.href} onClick={() => setMenuOpen(false)}>
                {item.label}
                <ArrowUpRight size={16} />
              </a>
            ))}
            <a href="/auth/login">
              Sign in <ArrowUpRight size={16} />
            </a>
          </nav>
        ) : null}
      </header>
      <main id="main-content" tabIndex={-1}>
        <section className="marketing-hero" aria-labelledby="hero-title">
          <div className="hero-orbits" aria-hidden="true">
            <i />
            <i />
            <i />
            <span />
          </div>
          <div className="marketing-container hero-copy">
            <a className="preview-announcement" href="#product">
              <span className="status-dot" /> Meet your next workspace{' '}
              <span className="announcement-label">PRODUCT PREVIEW</span>
              <ChevronRight size={13} />
            </a>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
            >
              <h1 id="hero-title">
                Make space for
                <br />
                <span>great work.</span>
              </h1>
              <p className="hero-description">
                Less scattered. More connected.
                <br />A calmer home for your projects, people, and plans.
              </p>
              <div className="hero-actions">
                <Button asChild>
                  <a href="/auth/register">
                    Create your account <ArrowRight size={16} />
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href="#product">
                    Explore ORBIT <ArrowRight size={16} />
                  </a>
                </Button>
                <Button variant="ghost" onClick={openTour}>
                  <Play size={14} /> Take the guided tour
                </Button>
              </div>
              <p className="hero-note">Free account setup. Product preview. No payment needed.</p>
            </motion.div>
          </div>
          <motion.div
            className="marketing-container hero-product"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.1 }}
            id="product"
            tabIndex={-1}
          >
            <ProductPreview />
          </motion.div>
        </section>
        <div className="marketing-container audience-strip">
          <span>FOR THE WAY YOU WORK</span>
          <p>
            Small teams.<span>Big ideas.</span>Shared ambition.
          </p>
          <div>
            <span>Independent minds</span>
            <span>Creative studios</span>
            <span>Growing teams</span>
          </div>
        </div>
        <section
          className="marketing-container marketing-features"
          id="why-orbit"
          tabIndex={-1}
          aria-labelledby="features-title"
        >
          <div className="section-heading">
            <span className="marketing-eyebrow">A CLEARER PICTURE</span>
            <h2 id="features-title">
              Bring it all
              <br />
              into orbit.
            </h2>
            <p>
              Great work needs more than another to-do list. We’re building a place where the
              details connect and the bigger picture stays in view.
            </p>
          </div>
          <div className="feature-composition">
            <article className="feature-wide">
              <div className="feature-copy">
                <span className="feature-number">01 / CONNECT THE DOTS</span>
                <h3>
                  From the first spark
                  <br />
                  to the finish line.
                </h3>
                <p>
                  A vision for projects, tasks, and milestones that move together. Less piecing
                  things together. More moving things forward.
                </p>
                <a href="#product">
                  Find your perspective <ArrowUpRight size={15} />
                </a>
              </div>
              <WorkflowIllustration />
            </article>
            <article className="feature-half">
              <span className="feature-number">02 / KEEP THE CONTEXT</span>
              <h3>
                The conversation
                <br />
                belongs with the work.
              </h3>
              <p>
                Planned comments and shared documents will give the ideas behind your decisions a
                home.
              </p>
              <NotesIllustration />
            </article>
            <article className="feature-half feature-focus">
              <span className="feature-number">03 / FIND YOUR FLOW</span>
              <h3>
                A workspace with
                <br />a little breathing room.
              </h3>
              <p>
                Thoughtful views. Clear priorities. An interface designed to help you focus on the
                next meaningful thing.
              </p>
              <div className="focus-illustration" aria-hidden="true">
                <div className="focus-orbit">
                  <img src="/orbit.svg" alt="" width="42" height="42" />
                </div>
                <span>
                  <span className="status-dot" /> Space to focus
                </span>
              </div>
            </article>
          </div>
        </section>
        <section className="marketing-manifesto">
          <div className="marketing-container">
            <span className="marketing-eyebrow">LESS NOISE. MORE MOMENTUM.</span>
            <h2>
              Your tools should
              <br />
              make room for <em>you.</em>
            </h2>
            <p>
              For the builders, the thinkers, the people who care about the details.
              <br />
              ORBIT is taking shape around a simple idea: work can feel clearer.
            </p>
            <a href="#pricing">
              Find the right starting point <ArrowRight size={15} />
            </a>
          </div>
        </section>
        <section
          className="marketing-container marketing-pricing"
          id="pricing"
          tabIndex={-1}
          aria-labelledby="pricing-title"
        >
          <div className="section-heading centered">
            <span className="marketing-eyebrow">ROOM TO GROW</span>
            <h2 id="pricing-title">Start small. Think big.</h2>
            <p>A first look at how ORBIT plans could grow with you.</p>
            <div className="billing-toggle" role="group" aria-label="Pricing period">
              <button aria-pressed={!annual} onClick={() => setAnnual(false)}>
                Monthly
              </button>
              <button aria-pressed={annual} onClick={() => setAnnual(true)}>
                Yearly <span>Save up to 17%</span>
              </button>
            </div>
            <p className="pricing-disclaimer">
              Illustrative pricing in USD. Actual Stripe sandbox prices and organization limits are
              shown in organization Billing. No live payments are enabled.
            </p>
          </div>
          <div className="pricing-grid">
            {plans.map((plan, index) => (
              <article className={`pricing-card ${index === 1 ? 'featured' : ''}`} key={plan.name}>
                {index === 1 ? <span className="plan-ribbon">FOR A SHARED RHYTHM</span> : null}
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
                <div className="plan-price">
                  <strong>${annual ? plan.annual : plan.monthly}</strong>
                  <span>{plan.monthly === 0 ? '/ forever' : '/ organization / month'}</span>
                </div>
                <p className="plan-billing">
                  {plan.monthly === 0
                    ? 'A proposed free starting point'
                    : annual
                      ? `$${plan.annual * 12} per organization, billed yearly`
                      : 'Billed monthly'}
                </p>
                <Button
                  variant={index === 1 ? 'primary' : 'outline'}
                  onClick={(event) => {
                    planTrigger.current = event.currentTarget;
                    setSelectedPlan(plan);
                  }}
                >
                  Explore {plan.name}
                  <ArrowUpRight size={14} />
                </Button>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <Check size={15} />
                      {feature}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
        <section
          className="marketing-container marketing-faq"
          id="faq"
          tabIndex={-1}
          aria-labelledby="faq-title"
        >
          <div>
            <span className="marketing-eyebrow">A FEW GOOD QUESTIONS</span>
            <h2 id="faq-title">A little more clarity.</h2>
            <p>Here’s where ORBIT stands today.</p>
          </div>
          <div className="faq-list">
            <Accordion title="Can I start using ORBIT today?">
              Create a verified account and an organization to manage real projects, planning,
              collaboration and documents. The workspace cards on this marketing page remain a
              labeled demonstration. Organization billing supports test-mode integration only.
            </Accordion>
            <Accordion title="Is the preview connected to my real work?">
              No. It uses clearly labeled sample content. View changes and filters only affect the
              demonstration; they don’t create projects or save business data.
            </Accordion>
            <Accordion title="Are these the final prices?">
              These illustrative USD prices are not checkout quotes. Actual configured test prices
              and limits appear in organization Billing. There is no checkout on this marketing page
              and no live charges are enabled.
            </Accordion>
            <Accordion title="Who is ORBIT being built for?">
              Independent builders, creative studios, and teams looking for a shared place to plan
              and organize work. Organization administration and explicit workspace membership
              protect access to your actual work.
            </Accordion>
          </div>
        </section>
        <section className="marketing-container final-cta">
          <div className="cta-star" aria-hidden="true">
            ✳
          </div>
          <span className="marketing-eyebrow">A NEW PERSPECTIVE ON WORK</span>
          <h2>
            Good things happen
            <br />
            with a little space.
          </h2>
          <p>See the direction we’re building toward.</p>
          <Button onClick={openTour}>
            Step inside ORBIT <ArrowRight size={16} />
          </Button>
        </section>
      </main>
      <footer className="marketing-container marketing-footer">
        <div className="marketing-footer-appearance">
          <ThemeControl />
        </div>
        <div>
          <a className="marketing-brand" href="/" aria-label="ORBIT home">
            <img src="/orbit.svg" alt="" width="27" height="27" />
            orbit<span>.</span>
          </a>
          <p>A little clarity. A lot of possibility.</p>
        </div>
        <nav aria-label="Footer navigation">
          {navigation.map((item) => (
            <a href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="footer-meta">
          <span>© {new Date().getFullYear()} ORBIT</span>
          <span>Product preview</span>
        </div>
      </footer>
      <Dialog open={tourOpen} onOpenChange={setTourOpen}>
        <DialogContent
          className="marketing-tour"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            tourTrigger.current?.focus({ preventScroll: true });
          }}
        >
          <span className="tour-step">GUIDED TOUR / {String(step + 1).padStart(2, '0')} OF 03</span>
          <span className="tour-icon">
            <currentStep.icon size={28} />
          </span>
          <DialogTitle>{currentStep.title}</DialogTitle>
          <DialogDescription>{currentStep.text}</DialogDescription>
          <div className="tour-progress" aria-hidden="true">
            {tour.map((item, index) => (
              <span className={index === step ? 'active' : ''} key={item.title} />
            ))}
          </div>
          <div className="tour-actions">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            {step < tour.length - 1 ? (
              <Button onClick={() => setStep(step + 1)}>
                Next <ArrowRight size={15} />
              </Button>
            ) : (
              <Button asChild>
                <a
                  href="#product"
                  onClick={() => {
                    tourTrigger.current = document.getElementById('product');
                    setTourOpen(false);
                  }}
                >
                  Try the preview <ArrowRight size={15} />
                </a>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={selectedPlan !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPlan(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            planTrigger.current?.focus({ preventScroll: true });
          }}
        >
          <DialogTitle>{selectedPlan?.name} plan preview</DialogTitle>
          <DialogDescription>{selectedPlan?.description}</DialogDescription>
          <div className="plan-modal-price">
            ${selectedPlan ? (annual ? selectedPlan.annual : selectedPlan.monthly) : 0}
            <span> {selectedPlan?.monthly === 0 ? '/ forever' : '/ organization / month'}</span>
          </div>
          <p className="plan-modal-note">
            {annual ? 'Yearly' : 'Monthly'} pricing preview. ORBIT is in development. Account setup
            is available. Owners manage test subscriptions from organization Billing. These
            illustrative prices do not start checkout or change a plan; no payment is collected from
            this preview.
          </p>
          <Button onClick={() => setSelectedPlan(null)}>Keep exploring</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
