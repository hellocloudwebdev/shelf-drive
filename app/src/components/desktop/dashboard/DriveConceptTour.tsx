import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Files, FolderLock, HardDrive, X } from 'lucide-react';
import { useModalFocus } from '../../../hooks/useModalFocus';

const introductionSteps = [
  {
    id: 'drive',
    label: 'Your storage',
    icon: HardDrive,
    title: 'Telegram becomes your cloud',
    body: 'Your Saved Messages becomes your personal storage. Shelf Drive turns it into a clean, organized drive for all your files.',
  },
  {
    id: 'folders',
    label: 'Your folders',
    icon: FolderLock,
    title: 'Private folders, built in',
    body: 'Shelf Drive uses private Telegram channels to keep your folders organized and accessible only to you.',
  },
  {
    id: 'files',
    label: 'Your files',
    icon: Files,
    title: 'Everything in one place',
    body: 'Photos, videos, documents, and more — organized, searchable, and available wherever you use Shelf Drive.',
  },
];

interface DriveConceptTourProps {
  onFinish: () => void;
  onOpenHelp: () => void;
}

export function DriveConceptTour({ onFinish, onOpenHelp }: DriveConceptTourProps) {
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, onFinish);
  const reduceMotion = useReducedMotion();
  const steps = introductionSteps;
  const step = steps[index];
  const Icon = step.icon;
  const isLastStep = index === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-app-overlay p-4 backdrop-blur-sm">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="drive-tour-title" tabIndex={-1} className="quiet-raised w-[min(480px,calc(100vw-2rem))] overflow-hidden">
        <header className="flex items-center justify-between border-b border-app-border-subtle px-6 py-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-app-accent">{step.label}</span>
          <button type="button" onClick={onFinish} className="quiet-control p-1.5 text-app-text-tertiary hover:text-app-text" aria-label="Skip drive introduction"><X className="h-4 w-4" /></button>
        </header>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step.id}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="px-8 pb-8 pt-9 text-center"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-container bg-app-selected text-app-accent"><Icon className="h-7 w-7" /></div>
            <h2 id="drive-tour-title" className="mt-7 text-[1.375rem] font-semibold leading-snug tracking-[-0.01em] text-app-text">{step.title}</h2>
            <p className="mx-auto mt-3 max-w-[26rem] text-[0.9375rem] leading-[1.7] text-app-text-secondary">{step.body}</p>
          </motion.div>
        </AnimatePresence>
        <div className="flex justify-center gap-1.5 pb-7" aria-label="Introduction progress">{steps.map((_, stepIndex) => <span key={stepIndex} className={`h-1 rounded-full transition-all motion-reduce:transition-none ${stepIndex === index ? 'w-6 bg-app-accent' : 'w-1 bg-app-border'}`} />)}</div>
        <footer className="flex items-center justify-between border-t border-app-border-subtle px-6 py-4">
          <button type="button" onClick={onOpenHelp} className="quiet-control px-3 py-2 text-xs font-medium text-app-text-secondary">Open Help & FAQ</button>
          <button type="button" onClick={() => isLastStep ? onFinish() : setIndex(value => value + 1)} className="quiet-control flex items-center gap-1.5 rounded-full bg-app-accent py-2 pe-4 ps-5 text-sm font-semibold text-app-accent-contrast">{isLastStep ? 'Finish' : 'Next'}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></button>
        </footer>
      </div>
    </div>
  );
}
