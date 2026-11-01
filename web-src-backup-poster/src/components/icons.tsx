// Hand-drawn line icons in the spirit of SF Symbols (24px grid, 1.8 stroke).
type P = { className?: string };
const S = ({ children, className = "h-5 w-5" }: { children: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>{children}</svg>
);

export const IconToday = (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></S>;
export const IconWeek = (p: P) => <S {...p}><rect x="3" y="4.5" width="18" height="16" rx="4" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /><path d="M7.5 13.5h3M13.5 13.5h3M7.5 17h3" /></S>;
export const IconSpark = (p: P) => <S {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></S>;
export const IconChat = (p: P) => <S {...p}><path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 20.5 12z" /><path d="M8.5 11h7M8.5 14h4" /></S>;
export const IconSwap = (p: P) => <S {...p}><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></S>;
export const IconPen = (p: P) => <S {...p}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></S>;
export const IconPulse = (p: P) => <S {...p}><path d="M2.5 12h4l2.5-6 4 12 2.5-6h6" /></S>;
export const IconBox = (p: P) => <S {...p}><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" /></S>;
export const IconBook = (p: P) => <S {...p}><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7.5h6" /></S>;
export const IconSearch = (p: P) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></S>;
export const IconArrow = (p: P) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
export const IconCheck = (p: P) => <S {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></S>;
export const IconX = (p: P) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IconRefresh = (p: P) => <S {...p}><path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5" /><path d="M5 3v4h4M19 21v-4h-4" /></S>;
export const IconOut = (p: P) => <S {...p}><path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16l4-4-4-4M14 12H4" /></S>;
export const IconShield = (p: P) => <S {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></S>;
